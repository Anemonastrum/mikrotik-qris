import { describe, it } from 'node:test';
import assert from 'node:assert';
import { initDb, createOrder, getOrder, updateOrderStatus, attachVoucher, getPackages } from '../src/db.js';

describe('Database and config operations', () => {
  it('initializes tables and retrieves default packages', () => {
    const db = initDb(':memory:');
    const packages = getPackages(db);
    assert.ok(packages.length > 0);
    assert.strictEqual(typeof packages[0].price, 'number');
  });

  it('creates order, updates status and attaches voucher', () => {
    const db = initDb(':memory:');
    const order = createOrder(db, {
      orderId: 'ORDER-TEST-001',
      packageId: '1h',
      packageName: '1 Jam',
      amount: 2000,
      customerPhone: '081234567890'
    });
    assert.strictEqual(order.order_id, 'ORDER-TEST-001');
    assert.strictEqual(order.status, 'pending');

    updateOrderStatus(db, 'ORDER-TEST-001', 'settlement', { transactionId: 'TRX-123' });
    attachVoucher(db, 'ORDER-TEST-001', {
      username: 'usr123',
      password: 'pwd123',
      profile: '1-hour',
      uptimeLimit: '1h'
    });

    const updated = getOrder(db, 'ORDER-TEST-001');
    assert.strictEqual(updated.status, 'settlement');
    assert.strictEqual(updated.voucher_username, 'usr123');
    assert.strictEqual(updated.voucher_password, 'pwd123');
  });
});
