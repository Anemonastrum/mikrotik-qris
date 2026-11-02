import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  dbPath: process.env.DB_PATH || path.resolve(__dirname, '../../data/mikrotik-qris.db'),
  midtrans: {
    serverKey: process.env.MIDTRANS_SERVER_KEY || 'SB-Mid-server-demo-key',
    clientKey: process.env.MIDTRANS_CLIENT_KEY || 'SB-Mid-client-demo-key',
    isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
    get baseUrl() {
      return this.isProduction
        ? 'https://api.midtrans.com'
        : 'https://api.sandbox.midtrans.com';
    }
  },
  mikrotik: {
    host: process.env.MIKROTIK_HOST || '',
    port: parseInt(process.env.MIKROTIK_PORT || '80', 10),
    user: process.env.MIKROTIK_USER || 'admin',
    password: process.env.MIKROTIK_PASSWORD || '',
    useHttps: process.env.MIKROTIK_USE_HTTPS === 'true',
    defaultProfile: process.env.MIKROTIK_DEFAULT_PROFILE || 'default'
  },
  defaultPackages: [
    {
      id: '1h',
      name: '1 Jam',
      price: 2000,
      profile: '1-hour',
      uptimeLimit: '1h',
      description: 'Akses hotspot berkecepatan tinggi selama 1 jam'
    },
    {
      id: '3h',
      name: '3 Jam',
      price: 5000,
      profile: '3-hours',
      uptimeLimit: '3h',
      description: 'Akses hotspot berkecepatan tinggi selama 3 jam'
    },
    {
      id: '1d',
      name: '1 Hari',
      price: 10000,
      profile: '1-day',
      uptimeLimit: '1d',
      description: 'Akses hotspot berkecepatan tinggi 24 jam'
    },
    {
      id: '7d',
      name: '7 Hari',
      price: 35000,
      profile: '7-days',
      uptimeLimit: '7d',
      description: 'Akses hotspot tanpa batas selama 7 hari'
    }
  ]
};
