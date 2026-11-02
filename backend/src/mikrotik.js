import crypto from 'node:crypto';
import { config } from './config.js';

// Character pool excluding ambiguous characters (0, O, 1, I, L)
const CHAR_POOL = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/**
 * Generate a random alphanumeric voucher code.
 */
export function generateVoucherCode(length = 6) {
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += CHAR_POOL[bytes[i] % CHAR_POOL.length];
  }
  return result;
}

/**
 * Build RouterOS /ip/hotspot/user payload.
 */
export function createHotspotUserPayload({
  username,
  password = username,
  profile = 'default',
  uptimeLimit = '1h',
  comment = 'QRIS voucher'
}) {
  return {
    name: username,
    password: password,
    profile: profile,
    'limit-uptime': uptimeLimit,
    comment: comment
  };
}

/**
 * Provision user in MikroTik RouterOS via RouterOS REST API (ROS v7).
 * Gracefully falls back to mock mode if router is unconfigured or unreachable.
 */
export function getRouterOsAuthHeader(user, password) {
  return 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
}

export async function provisionHotspotUser(voucher, mkConfig = config.mikrotik) {
  if (!mkConfig || !mkConfig.host) {
    // Mock / standalone mode (local vouchers only)
    return {
      success: true,
      mode: 'mock',
      message: 'MikroTik router not configured; voucher recorded in database only.'
    };
  }

  const payload = createHotspotUserPayload(voucher);
  const protocol = mkConfig.useHttps ? 'https' : 'http';
  const url = `${protocol}://${mkConfig.host}:${mkConfig.port}/rest/ip/hotspot/user`;

  try {
    const auth = getRouterOsAuthHeader(mkConfig.user, mkConfig.password);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': auth
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      return {
        success: true,
        mode: 'rest',
        data
      };
    }

    const errText = await response.text().catch(() => response.statusText);
    return {
      success: false,
      mode: 'rest',
      status: response.status,
      error: `RouterOS returned HTTP ${response.status}: ${errText}`
    };
  } catch (err) {
    return {
      success: false,
      mode: 'rest',
      error: `Failed to connect to MikroTik at ${mkConfig.host}:${mkConfig.port} (${err.message})`
    };
  }
}
