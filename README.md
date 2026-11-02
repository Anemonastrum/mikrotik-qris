# MikroTik Hotspot QRIS Voucher Gateway

Production-grade captive portal template and backend integration for MikroTik RouterOS and Midtrans QRIS payment gateway. Users can authenticate with vouchers, access free trials, or purchase hotspot vouchers in-portal using standard Indonesian QRIS (GoPay, OVO, DANA, ShopeePay, BCA, Livin' Mandiri, and other mobile banking applications).

---

## Architecture

```
+------------------------------------------------------------------+
|                     Client Device (Mobile / PC)                  |
+------------------------------------------------------------------+
                                 │
           1. Connect to WiFi / Captive Portal Trigger
                                 ▼
+------------------------------------------------------------------+
|               MikroTik RouterOS (Hotspot Server)                 |
|  - Serves static /hotspot template with MUIX design system       |
|  - Walled Garden: Permits unauthenticated access to backend & QR |
|  - Supports native Free Trial activation                         |
+------------------------------------------------------------------+
                                 │
           2. Buy Voucher via In-Page Modal (API Calls)
                                 ▼
+------------------------------------------------------------------+
|           Express.js Backend Service (Docker on Linux)           |
|  - Initiates QRIS charges with Midtrans Core API                 |
|  - Validates webhook signatures (SHA-512)                        |
|  - Provisions users via RouterOS v7 REST API                     |
|  - Persists state in local SQLite with WAL mode                  |
+------------------------------------------------------------------+
                 │                                  │
       3. POST /v2/charge                 4. Webhook Notification
                 ▼                                  ▲
+------------------------------------------------------------------+
|                  Midtrans Payment Gateway (QRIS)                 |
+------------------------------------------------------------------+
```

---

## Features

- In-Page QRIS Checkout: Users complete payment inside the captive portal browser without navigating away.
- MUIX Design System: Modern UI inspired by compose-miuix-ui and HyperOS, featuring squircle cards, segmented controls, and Heroicons.
- Dynamic Dark and Light Theme: Automatic system theme detection with manual toggle and persistence via localStorage.
- Free Trial Integration: Supports MikroTik native trial login (`$(trial == 'yes')`) for instant connection testing.
- SHA-512 Signature Verification: Cryptographic verification of all Midtrans webhook payloads preventing tampering.
- Auto-Login: Automatically fills credentials and triggers CHAP MD5 authentication upon payment confirmation.
- RouterOS Provisioning: Provisions hotspot users dynamically via the RouterOS v7 REST API (`/rest/ip/hotspot/user`) with standalone fallback.
- Polling Fallback: Client-side polling queries backend status every 3 seconds to recover transactions when webhooks are delayed by NAT.
- Zero External Frontend Build Tools: Hotspot template uses standard HTML5, CSS3, and vanilla JavaScript compatible with RouterOS storage limits.
- Containerized Backend: Packaged with Docker and Docker Compose using Node.js 22 Alpine and native `node:sqlite`.

---

## Repository Structure

```
.
├── backend/
│   ├── Dockerfile             # Node.js 22 Alpine production container
│   ├── package.json           # Dependencies and test runner script
│   ├── .env.example           # Environment variable template
│   ├── src/
│   │   ├── config.js          # Application, Midtrans, and RouterOS settings
│   │   ├── db.js              # SQLite database layer (WAL mode)
│   │   ├── midtrans.js        # Midtrans QRIS client & SHA-512 verification
│   │   ├── mikrotik.js        # Voucher generator & RouterOS REST API client
│   │   ├── app.js             # Express application & route handlers
│   │   └── server.js          # HTTP service entrypoint
│   └── tests/                 # Node.js native test suite
├── hotspot/                   # MikroTik Hotspot directory
│   ├── login.html             # Login page with MUIX design & QRIS modal
│   ├── status.html            # Connection status page
│   ├── logout.html            # Session termination page
│   ├── alogin.html            # Post-login redirect handler
│   ├── rlogin.html            # Fallback redirect handler
│   ├── errors.txt             # RouterOS localized error mappings
│   ├── md5.js                 # RFC 1321 MD5 hash implementation for CHAP
│   ├── css/style.css          # MUIX theme styles (dark/light support)
│   └── js/app.js              # Theme switcher, QRIS checkout & auto-login
├── docker-compose.yml         # Container deployment configuration
├── mikrotik-setup.rsc         # RouterOS walled garden and profile setup script
└── README.md
```

---

## Setup and Deployment

### 1. Deploy the Backend on Linux

1. Clone the repository:
   ```bash
   git clone https://github.com/Anemonastrum/mikrotik-qris.git
   cd mikrotik-qris
   ```

2. Copy the sample environment file and configure variables:
   ```bash
   cp backend/.env.example backend/.env
   nano backend/.env
   ```

3. Set your keys and network addresses:
   ```env
   PORT=3000
   NODE_ENV=production
   DB_PATH=/app/data/mikrotik-qris.db

   # Midtrans API credentials (from https://dashboard.midtrans.com/)
   MIDTRANS_SERVER_KEY=SB-Mid-server-your-server-key
   MIDTRANS_CLIENT_KEY=SB-Mid-client-your-client-key
   MIDTRANS_IS_PRODUCTION=false

   # MikroTik RouterOS v7 REST API
   MIKROTIK_HOST=192.168.88.1
   MIKROTIK_PORT=80
   MIKROTIK_USER=admin
   MIKROTIK_PASSWORD=your-router-password
   MIKROTIK_USE_HTTPS=false
   MIKROTIK_DEFAULT_PROFILE=default
   ```

4. Launch the container:
   ```bash
   docker compose up -d --build
   ```

5. Confirm health status:
   ```bash
   curl http://localhost:3000/api/health
   # Returns: {"status":"ok","timestamp":"..."}
   ```

---

### 2. Configure MikroTik RouterOS

1. Open RouterOS terminal or Winbox.
2. Add Walled Garden rules allowing clients to reach the backend host and Midtrans hosts before authentication (replace `192.168.88.2` with your backend server IP):
   ```routeros
   # Permit access to Express backend
   /ip hotspot walled-garden ip
   add action=accept dst-address=192.168.88.2 comment="QRIS-Backend-Server"

   # Permit access to Midtrans and QR code endpoints
   /ip hotspot walled-garden
   add action=allow dst-host=api.midtrans.com comment="Midtrans Production API"
   add action=allow dst-host=api.sandbox.midtrans.com comment="Midtrans Sandbox API"
   add action=allow dst-host=app.midtrans.com comment="Midtrans App Production"
   add action=allow dst-host=app.sandbox.midtrans.com comment="Midtrans App Sandbox"
   add action=allow dst-host=api.qrserver.com comment="QR Generator CDN"

   # Enable RouterOS REST API (port 80 or 443)
   /ip service set www disabled=no port=80
   ```

3. (Optional) Configure Free Trial access in RouterOS Hotspot Server Profile:
   ```routeros
   /ip hotspot profile
   set [find default=yes] login-by=http-chap,trial trial-uptime-limit=30m trial-uptime-reset=1d
   ```

---

### 3. Install Hotspot Files on RouterOS

1. If the backend is running on a dedicated host different from the default gateway, specify the backend URL in `hotspot/login.html`:
   ```html
   <meta name="backend-url" content="http://192.168.88.2:3000" />
   ```
2. Upload the `hotspot/` directory to your MikroTik storage (`Files` in Winbox or via SFTP).
3. Set the HTML directory in `/ip hotspot profile` to point to the uploaded folder.

---

### 4. Midtrans Webhook Configuration

1. Log in to [Midtrans Dashboard](https://dashboard.midtrans.com/).
2. Navigate to **Settings** > **Configuration**.
3. Set the **Payment Notification URL** to:
   ```
   https://your-public-backend-domain.com/api/payment/webhook
   ```
4. If running locally without a public IP, use Cloudflare Tunnel or an equivalent reverse proxy to expose port 3000.

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service health status check |
| `GET` | `/api/packages` | Retrieves active hotspot voucher packages |
| `POST` | `/api/payment/create-qris` | Creates an order and requests a Midtrans QRIS charge |
| `GET` | `/api/payment/status/:orderId` | Retrieves payment status and generated voucher credentials |
| `POST` | `/api/payment/webhook` | Receives payment callbacks from Midtrans |

---

## Testing

Run the automated test suite using Node.js native test runner:

```bash
cd backend
npm test
```

Test coverage includes:
- SQLite schema generation and order-voucher CRUD operations
- Midtrans QRIS payload builder and SHA-512 signature validation
- RouterOS user payload formatting and voucher code generation
- API endpoints, webhook handling, and status reconciliation

---

## License

MIT License.
