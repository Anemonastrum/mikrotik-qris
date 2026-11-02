import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * Verify Midtrans Webhook SHA-512 signature.
 */
export function verifySignature({ orderId, statusCode, grossAmount, signature, serverKey = config.midtrans.serverKey }) {
  if (!orderId || !statusCode || !grossAmount || !signature || !serverKey) {
    return false;
  }
  const payload = `${orderId}${statusCode}${grossAmount}${serverKey}`;
  const calculated = crypto.createHash('sha512').update(payload).digest('hex');

  // Constant-time comparison to prevent timing attacks
  const bufA = Buffer.from(calculated, 'utf8');
  const bufB = Buffer.from(signature, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Build Midtrans QRIS charge payload.
 */
export function buildChargePayload({ orderId, amount, packageName, customerPhone = '' }) {
  return {
    payment_type: 'qris',
    transaction_details: {
      order_id: orderId,
      gross_amount: Math.round(amount)
    },
    item_details: [
      {
        id: orderId,
        price: Math.round(amount),
        quantity: 1,
        name: packageName
      }
    ],
    customer_details: {
      phone: customerPhone || undefined
    },
    qris: {
      acquirer: 'gopay'
    }
  };
}

/**
 * Parse QRIS details from Midtrans response.
 */
export function parseQrisResponse(res) {
  let qrUrl = '';
  if (Array.isArray(res.actions)) {
    const qrAction = res.actions.find(a => a.name === 'generate-qr-code');
    if (qrAction && qrAction.url) {
      qrUrl = qrAction.url;
    }
  }
  return {
    transactionId: res.transaction_id || '',
    statusCode: res.status_code || '',
    transactionStatus: res.transaction_status || 'pending',
    qrString: res.qr_string || '',
    qrUrl
  };
}

/**
 * Create QRIS Charge via Midtrans Core API.
 */
export function getAuthHeader(serverKey = config.midtrans.serverKey) {
  return 'Basic ' + Buffer.from(`${serverKey}:`).toString('base64');
}

export async function createQrisCharge(orderData, {
  serverKey = config.midtrans.serverKey,
  baseUrl = config.midtrans.baseUrl
} = {}) {
  const payload = buildChargePayload(orderData);
  const response = await fetch(`${baseUrl}/v2/charge`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': getAuthHeader(serverKey)
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    const errorMsg = data.status_message || (data.validation_messages && data.validation_messages.join(', ')) || 'Midtrans error';
    throw new Error(`Midtrans QRIS Charge failed: ${errorMsg}`);
  }

  return parseQrisResponse(data);
}

export async function checkTransactionStatus(orderId, {
  serverKey = config.midtrans.serverKey,
  baseUrl = config.midtrans.baseUrl
} = {}) {
  const response = await fetch(`${baseUrl}/v2/${orderId}/status`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': getAuthHeader(serverKey)
    }
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Midtrans status check failed: ${data.status_message || response.statusText}`);
  }
  return data;
}
