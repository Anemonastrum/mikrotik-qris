import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { initDb } from '../src/db.js';

describe('Express API Endpoints', () => {
  let app;
  let server;
  let baseUrl;
  let testDb;
  const testServerKey = 'SB-Mid-server-test-secret-1234';

  before(async () => {
    testDb = initDb(':memory:');
    app = createApp({
      db: testDb,
      midtransServerKey: testServerKey,
      mockMidtrans: true,
      mockMikrotik: true
    });

    await new Promise(resolve => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  it('GET /api/health returns status ok', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
  });

  it('GET /api/packages returns active packages', async () => {
    const res = await fetch(`${baseUrl}/api/packages`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.packages));
    assert.ok(body.packages.length > 0);
    assert.strictEqual(body.packages[0].id, '1h');
  });

  it('POST /api/payment/create-qris creates pending order and returns QR data', async () => {
    const res = await fetch(`${baseUrl}/api/payment/create-qris`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId: '1h', phone: '08123456789' })
    });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.ok(body.orderId);
    assert.strictEqual(body.amount, 2000);
    assert.strictEqual(body.status, 'pending');
    assert.ok(body.qrString || body.qrUrl);
  });

  it('POST /api/payment/create-qris rejects invalid packageId', async () => {
    const res = await fetch(`${baseUrl}/api/payment/create-qris`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId: 'invalid-id' })
    });
    assert.strictEqual(res.status, 400);
  });

  it('handles webhook with valid signature and provisions voucher', async () => {
    // 1. Create an order first
    const createRes = await fetch(`${baseUrl}/api/payment/create-qris`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId: '3h', phone: '089999999' })
    });
    const order = await createRes.json();
    const orderId = order.orderId;
    const statusCode = '200';
    const grossAmount = '5000.00';

    // 2. Generate valid signature
    const signature = crypto
      .createHash('sha512')
      .update(`${orderId}${statusCode}${grossAmount}${testServerKey}`)
      .digest('hex');

    // 3. Post webhook notification
    const hookRes = await fetch(`${baseUrl}/api/payment/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: orderId,
        status_code: statusCode,
        gross_amount: grossAmount,
        transaction_status: 'settlement',
        transaction_id: 'TRX-WEBHOOK-123',
        signature_key: signature
      })
    });
    assert.strictEqual(hookRes.status, 200);

    // 4. Poll status and verify voucher is present
    const statusRes = await fetch(`${baseUrl}/api/payment/status/${orderId}`);
    assert.strictEqual(statusRes.status, 200);
    const statusBody = await statusRes.json();
    assert.strictEqual(statusBody.status, 'settlement');
    assert.ok(statusBody.voucher);
    assert.ok(statusBody.voucher.username);
    assert.ok(statusBody.voucher.password);
  });

  it('rejects webhook with invalid signature', async () => {
    const hookRes = await fetch(`${baseUrl}/api/payment/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: 'ANY-ORDER',
        status_code: '200',
        gross_amount: '5000.00',
        transaction_status: 'settlement',
        signature_key: 'invalid-sig'
      })
    });
    assert.strictEqual(hookRes.status, 401);
  });
});
