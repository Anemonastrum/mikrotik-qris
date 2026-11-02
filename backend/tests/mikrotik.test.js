import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateVoucherCode, createHotspotUserPayload, provisionHotspotUser } from '../src/mikrotik.js';

describe('MikroTik voucher and provisioning', () => {
  it('generates random alphanumeric voucher codes without ambiguous characters', () => {
    const code = generateVoucherCode(6);
    assert.strictEqual(code.length, 6);
    assert.match(code, /^[2-9A-HJ-NP-Z]+$/); // skips 0, 1, I, O
  });

  it('generates distinct codes across successive calls', () => {
    const codeA = generateVoucherCode(8);
    const codeB = generateVoucherCode(8);
    assert.notStrictEqual(codeA, codeB);
  });

  it('builds valid RouterOS user payload', () => {
    const payload = createHotspotUserPayload({
      username: 'VIP-7788',
      password: 'PWD-7788',
      profile: '1-jam',
      uptimeLimit: '1h',
      comment: 'QRIS order ORDER-999'
    });
    assert.strictEqual(payload.name, 'VIP-7788');
    assert.strictEqual(payload.password, 'PWD-7788');
    assert.strictEqual(payload.profile, '1-jam');
    assert.strictEqual(payload['limit-uptime'], '1h');
    assert.strictEqual(payload.comment, 'QRIS order ORDER-999');
  });

  it('returns success in mock or disconnected mode without crashing', async () => {
    // When no host is configured, provisionHotspotUser should gracefully skip or succeed in mock mode
    const res = await provisionHotspotUser({
      username: 'TEST-USER',
      password: 'TEST-PASSWORD',
      profile: 'default',
      uptimeLimit: '1h',
      comment: 'test'
    }, { host: '' });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.mode, 'mock');
  });
});
