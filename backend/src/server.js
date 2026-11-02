import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();

app.listen(config.port, '0.0.0.0', () => {
  console.log(`MikroTik QRIS Backend running on port ${config.port}`);
  console.log(`Environment: ${config.midtrans.isProduction ? 'PRODUCTION' : 'SANDBOX'}`);
  console.log(`MikroTik Router: ${config.mikrotik.host ? config.mikrotik.host : 'Standalone / Mock mode'}`);
});
