import express from 'express';
import { initDb, getPackages, getPackageById, createOrder, getOrder, updateOrderStatus, attachVoucher } from './db.js';
import { verifySignature, createQrisCharge, checkTransactionStatus } from './midtrans.js';
import { generateVoucherCode, provisionHotspotUser } from './mikrotik.js';
import { config } from './config.js';

export function createApp(options = {}) {
  const db = options.db || initDb();
  const serverKey = options.midtransServerKey || config.midtrans.serverKey;
  const mockMidtrans = options.mockMidtrans ?? false;
  const mockMikrotik = options.mockMikrotik ?? false;

  const app = express();

  // CORS middleware - allows requests from MikroTik captive portal
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  app.use(express.json());

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Get active voucher packages
  app.get('/api/packages', (req, res) => {
    try {
      const packages = getPackages(db);
      res.json({ packages });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch packages', details: err.message });
    }
  });

  // Create QRIS order
  app.post('/api/payment/create-qris', async (req, res) => {
    try {
      const { packageId, phone } = req.body || {};
      if (!packageId) {
        return res.status(400).json({ error: 'packageId is required' });
      }

      const pkg = getPackageById(db, packageId);
      if (!pkg || !pkg.is_active) {
        return res.status(400).json({ error: 'Invalid or inactive package' });
      }

      // Generate unique order ID
      const timestamp = Date.now().toString(36).toUpperCase();
      const randomPart = Math.floor(1000 + Math.random() * 9000).toString(36).toUpperCase();
      const orderId = `QRIS-${timestamp}-${randomPart}`;

      let qrString = '';
      let qrUrl = '';
      let transactionId = '';

      if (mockMidtrans) {
        qrString = `00020101021226540014ID.MOCK.TEST0118936009110022301980520458125303360540${pkg.price}5802ID5911MIKROTIK-HOTSPOT6007JAKARTA`;
        qrUrl = `https://api.sandbox.midtrans.com/v2/qris/mock-${orderId}/qr-code`;
      } else {
        const midtransRes = await createQrisCharge({
          orderId,
          amount: pkg.price,
          packageName: `${pkg.name} Hotspot`,
          customerPhone: phone
        }, { serverKey });

        qrString = midtransRes.qrString;
        qrUrl = midtransRes.qrUrl;
        transactionId = midtransRes.transactionId;
      }

      const order = createOrder(db, {
        orderId,
        packageId: pkg.id,
        packageName: pkg.name,
        amount: pkg.price,
        customerPhone: phone || '',
        qrString,
        qrUrl
      });

      if (transactionId) {
        updateOrderStatus(db, orderId, 'pending', { transactionId });
      }

      res.status(201).json({
        orderId: order.order_id,
        packageName: order.package_name,
        amount: order.amount,
        status: order.status,
        qrString: order.qr_string,
        qrUrl: order.qr_url,
        createdAt: order.created_at
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to create QRIS payment', details: err.message });
    }
  });

  // Query order status & voucher code
  app.get('/api/payment/status/:orderId', async (req, res) => {
    try {
      const { orderId } = req.params;
      let order = getOrder(db, orderId);

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      // If pending and not in mock mode, optionally poll Midtrans directly as fallback
      if (order.status === 'pending' && !mockMidtrans) {
        try {
          const statusRes = await checkTransactionStatus(orderId, { serverKey });
          const txStatus = statusRes.transaction_status;
          if (txStatus === 'settlement' || txStatus === 'capture') {
            await handleSettlement(db, order, statusRes.transaction_id, mockMikrotik);
            order = getOrder(db, orderId);
          } else if (txStatus === 'expire' || txStatus === 'cancel') {
            updateOrderStatus(db, orderId, txStatus);
            order = getOrder(db, orderId);
          }
        } catch {
          // Midtrans poll check can fail silently if not yet registered; retain pending
        }
      }

      res.json({
        orderId: order.order_id,
        status: order.status,
        amount: order.amount,
        packageName: order.package_name,
        qrString: order.qr_string,
        qrUrl: order.qr_url,
        voucher: order.voucher_username ? {
          username: order.voucher_username,
          password: order.voucher_password,
          profile: order.voucher_profile,
          uptimeLimit: order.voucher_uptime_limit
        } : null
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch status', details: err.message });
    }
  });

  // Midtrans payment notification webhook
  app.post('/api/payment/webhook', async (req, res) => {
    try {
      const {
        order_id: orderId,
        status_code: statusCode,
        gross_amount: grossAmount,
        signature_key: signature,
        transaction_status: txStatus,
        transaction_id: transactionId
      } = req.body || {};

      if (!orderId || !statusCode || !grossAmount || !signature) {
        return res.status(400).json({ error: 'Missing required webhook fields' });
      }

      const isValid = verifySignature({
        orderId,
        statusCode,
        grossAmount,
        signature,
        serverKey
      });

      if (!isValid) {
        return res.status(401).json({ error: 'Invalid signature' });
      }

      const order = getOrder(db, orderId);
      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      if (txStatus === 'settlement' || txStatus === 'capture') {
        await handleSettlement(db, order, transactionId, mockMikrotik);
      } else if (txStatus === 'expire' || txStatus === 'cancel' || txStatus === 'deny') {
        updateOrderStatus(db, orderId, txStatus, { transactionId });
      }

      res.json({ message: 'Webhook processed' });
    } catch (err) {
      res.status(500).json({ error: 'Webhook processing error', details: err.message });
    }
  });

  return app;
}

/**
 * Handle successful payment settlement: provisions voucher on MikroTik and stores in DB.
 */
async function handleSettlement(db, order, transactionId, mockMikrotik) {
  // Idempotency: if already settled or has voucher, do not create duplicate
  if (order.voucher_username) {
    return;
  }

  updateOrderStatus(db, order.order_id, 'settlement', { transactionId });

  const pkg = getPackageById(db, order.package_id) || {
    profile: config.mikrotik.defaultProfile,
    uptimeLimit: '1h'
  };

  const voucherCode = generateVoucherCode(6);
  const voucher = {
    username: voucherCode,
    password: voucherCode,
    profile: pkg.profile,
    uptimeLimit: pkg.uptime_limit,
    comment: `QRIS order ${order.order_id}`
  };

  if (!mockMikrotik) {
    await provisionHotspotUser(voucher, config.mikrotik);
  }

  attachVoucher(db, order.order_id, voucher);
}
