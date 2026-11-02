import { describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { verifySignature, buildChargePayload, parseQrisResponse } from '../src/midtrans.js';

describe('Midtrans QRIS helpers', () => {
  it('correctly verifies valid SHA512 signature', () => {
    const serverKey = 'SB-Mid-server-TESTKEY123';
    const orderId = 'ORDER-12345';
    const statusCode = '200';
    const grossAmount = '5000.00';
    const raw = `${orderId}${statusCode}${grossAmount}${serverKey}`;
    const signature = crypto.createHash('sha512').update(raw).digest('hex');

    const isValid = verifySignature({ orderId, statusCode, grossAmount, signature, serverKey });
    assert.strictEqual(isValid, true);
  });

  it('rejects invalid or tampered signature', () => {
    const serverKey = 'SB-Mid-server-TESTKEY123';
    const isValid = verifySignature({
      orderId: 'ORDER-12345',
      statusCode: '200',
      grossAmount: '5000.00',
      signature: 'bad-signature',
      serverKey
    });
    assert.strictEqual(isValid, false);
  });

  it('builds valid QRIS charge payload', () => {
    const payload = buildChargePayload({
      orderId: 'ORDER-123',
      amount: 5000,
      packageName: '3 Jam Hotspot',
      customerPhone: '08123456789'
    });
    assert.strictEqual(payload.payment_type, 'qris');
    assert.strictEqual(payload.transaction_details.gross_amount, 5000);
    assert.strictEqual(payload.transaction_details.order_id, 'ORDER-123');
    assert.strictEqual(payload.item_details[0].name, '3 Jam Hotspot');
  });

  it('parses QR code string and actions from Midtrans response', () => {
    const midtransRes = {
      status_code: '201',
      transaction_id: 'TRX-9988',
      qr_string: '00020101021226540014ID.LINKAJA.WWW0118936009110022301980',
      actions: [
        {
          name: 'generate-qr-code',
          method: 'GET',
          url: 'https://api.sandbox.midtrans.com/v2/qris/TRX-9988/qr-code'
        }
      ]
    };
    const parsed = parseQrisResponse(midtransRes);
    assert.strictEqual(parsed.qrString, '00020101021226540014ID.LINKAJA.WWW0118936009110022301980');
    assert.strictEqual(parsed.qrUrl, 'https://api.sandbox.midtrans.com/v2/qris/TRX-9988/qr-code');
  });
});
