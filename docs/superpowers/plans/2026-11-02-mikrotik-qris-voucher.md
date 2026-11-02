# MikroTik Hotspot QRIS Voucher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete MikroTik Hotspot login template and Dockerized Express.js backend for buying hotspot vouchers directly on the captive portal using Midtrans QRIS.

**Architecture:** MikroTik captive portal serves client-side login & payment UI in `hotspot/`. Express.js backend in `backend/` handles Midtrans Core API QRIS charge creation, webhook verification (SHA512), polling reconciliation, MikroTik RouterOS user provisioning (RouterOS v7 REST API & RouterOS API with fallback), and SQLite transaction persistence.

**Tech Stack:** Node.js 22 LTS, Express 4, native `node:sqlite`, Docker & Docker Compose, HTML5/CSS3/Vanilla JS (MikroTik Hotspot template), Midtrans Core API.

**Spec:** Direct user specification for MikroTik hotspot login page with Midtrans QRIS payment and Express.js Docker backend.

## Global Constraints

- No JavaScript floating point math for monetary amounts; all prices in integer Indonesian Rupiah (IDR).
- Webhook signature verification MUST validate SHA-512 `hash(order_id + status_code + gross_amount + server_key)` before marking orders as paid.
- Midtrans QRIS Charge API (`POST /v2/charge`) used for embedded captive portal payments; return `qr_string` and QR data URL so clients do not depend on external Midtrans CDN in walled-garden.
- RouterOS integration must support both RouterOS v7 REST API (`/rest/ip/hotspot/user`) and local voucher pool/mock mode when router is unreachable.
- Zero external build dependencies for the hotspot template: vanilla HTML/CSS/JS compatible with standard MikroTik RouterOS variables (`$(link-login-only)`, `$(link-orig)`, `$(error)`, `$(chap-id)`, `$(chap-challenge)`).
- Secrets and tokens must never be hardcoded or committed to git. All credentials passed via environment variables (`.env.example` provided).
- Git repository: `https://github.com/Anemonastrum/mikrotik-qris`, committed using PAT from `/home/hermes/vault/pat.txt` without embedding PAT in URLs or configs.

## Review Focus

- Midtrans webhook delivered more than once (idempotency): duplicate notification must not create duplicate vouchers or reset order status.
- Webhook delayed or unreachable behind NAT: frontend polling triggers on-demand Midtrans status check and provisions voucher reliably.
- RouterOS unreachable during payment confirmation: voucher is persisted locally in database and queued/recoverable so customer payment is never lost.
- Walled-garden isolation: QRIS code rendered as SVG/Data-URL locally so captive portal user can scan QR without needing full Internet access.
- Malformed or tampered webhook signature: rejected with HTTP 401/400 without state change.

---

### Task 1: Project Scaffolding, Configuration, and Database

**Files:**
- Create: `backend/package.json`
- Create: `backend/src/config.js`
- Create: `backend/src/db.js`
- Create: `backend/tests/db.test.js`

**Interfaces:**
- Consumes: Node.js stdlib `node:sqlite`, `node:crypto`, `node:path`, `node:fs`
- Produces: `config` object (`port`, `midtrans`, `mikrotik`, `dbPath`, `packages`), `db` helper (`initDb()`, `createOrder()`, `getOrder()`, `updateOrderStatus()`, `attachVoucher()`, `getPackages()`)

- [ ] **Step 1: Write failing test for database and config**

```javascript
// backend/tests/db.test.js
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
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/tests/db.test.js`
Expected: FAIL with `Cannot find module '../src/db.js'`

- [ ] **Step 3: Implement `package.json`, `config.js`, and `db.js`**

Implement SQLite tables (`orders`, `packages`, `vouchers`) using `node:sqlite` with WAL mode, parameterized statements, and automatic seeding of default packages.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/tests/db.test.js`
Expected: PASS (2 tests pass)

- [ ] **Step 5: Commit**

```bash
git add backend/package.json backend/src/config.js backend/src/db.js backend/tests/db.test.js
git commit -m "feat(backend): initialize project config and sqlite database"
```

---

### Task 2: Midtrans QRIS Integration & Webhook Verification

**Files:**
- Create: `backend/src/midtrans.js`
- Create: `backend/tests/midtrans.test.js`

**Interfaces:**
- Consumes: `config.midtrans`, `node:crypto`
- Produces: `createQrisCharge(orderData)`, `verifySignature(orderId, statusCode, grossAmount, signatureKey)`, `checkTransactionStatus(orderId)`

- [ ] **Step 1: Write failing test for Midtrans signature verification and payload builders**

```javascript
// backend/tests/midtrans.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { verifySignature, buildChargePayload } from '../src/midtrans.js';
import crypto from 'node:crypto';

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
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/tests/midtrans.test.js`
Expected: FAIL with `Cannot find module '../src/midtrans.js'`

- [ ] **Step 3: Implement `backend/src/midtrans.js`**

Implement `verifySignature`, `buildChargePayload`, `createQrisCharge` via native `fetch`, and `checkTransactionStatus` via native `fetch`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/tests/midtrans.test.js`
Expected: PASS (3 tests pass)

- [ ] **Step 5: Commit**

```bash
git add backend/src/midtrans.js backend/tests/midtrans.test.js
git commit -m "feat(backend): add midtrans qris charge and signature verification"
```

---

### Task 3: MikroTik Provisioning & Voucher Generation

**Files:**
- Create: `backend/src/mikrotik.js`
- Create: `backend/tests/mikrotik.test.js`

**Interfaces:**
- Consumes: `config.mikrotik`, `node:crypto`
- Produces: `generateVoucherCode(length)`, `provisionHotspotUser(voucher, config)`

- [ ] **Step 1: Write failing test for voucher generation and router provisioning logic**

```javascript
// backend/tests/mikrotik.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateVoucherCode, createHotspotUserPayload } from '../src/mikrotik.js';

describe('MikroTik voucher and provisioning', () => {
  it('generates random alphanumeric voucher codes without ambiguous characters', () => {
    const code = generateVoucherCode(6);
    assert.strictEqual(code.length, 6);
    assert.match(code, /^[2-9A-HJ-NP-Z]+$/); // skips 0, 1, I, O
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
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/tests/mikrotik.test.js`
Expected: FAIL with `Cannot find module '../src/mikrotik.js'`

- [ ] **Step 3: Implement `backend/src/mikrotik.js`**

Implement `generateVoucherCode`, `createHotspotUserPayload`, and `provisionHotspotUser` supporting:
1. RouterOS v7 REST API (`POST https://<host>:<port>/rest/ip/hotspot/user`) with Basic Auth
2. RouterOS API (port 8728) fallback / dry-run mode when in development or router unreachable.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/tests/mikrotik.test.js`
Expected: PASS (2 tests pass)

- [ ] **Step 5: Commit**

```bash
git add backend/src/mikrotik.js backend/tests/mikrotik.test.js
git commit -m "feat(backend): add mikrotik voucher generator and routeros client"
```

---

### Task 4: Express API Server & Webhook Handler

**Files:**
- Create: `backend/src/app.js`
- Create: `backend/src/server.js`
- Create: `backend/tests/api.test.js`

**Interfaces:**
- Consumes: `db.js`, `midtrans.js`, `mikrotik.js`, `config.js`
- Produces: Express API routes:
  - `GET /api/packages`: list packages
  - `POST /api/payment/create-qris`: initiate order & get QR
  - `GET /api/payment/status/:orderId`: poll status
  - `POST /api/payment/webhook`: Midtrans webhook notification
  - `GET /api/health`: service health check

- [ ] **Step 1: Write integration tests for API endpoints**

```javascript
// backend/tests/api.test.js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createApp } from '../src/app.js';
import { initDb } from '../src/db.js';

describe('Express API Endpoints', () => {
  let app;
  let server;
  let baseUrl;

  before(async () => {
    const db = initDb(':memory:');
    app = createApp({ db, mockMidtrans: true, mockMikrotik: true });
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

  it('GET /api/packages returns active packages', async () => {
    const res = await fetch(`${baseUrl}/api/packages`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.packages.length > 0);
  });

  it('POST /api/payment/create-qris returns order details and QR code', async () => {
    const res = await fetch(`${baseUrl}/api/payment/create-qris`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId: '1h', phone: '08123456789' })
    });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.ok(body.orderId);
    assert.ok(body.qrString || body.qrUrl);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/tests/api.test.js`
Expected: FAIL with `Cannot find module '../src/app.js'`

- [ ] **Step 3: Implement `backend/src/app.js` and `backend/src/server.js`**

Implement Express app with CORS, JSON body parser, QR code generation helper (SVG / data URL), routes, idempotency handling, and error middleware.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/tests/api.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/app.js backend/src/server.js backend/tests/api.test.js
git commit -m "feat(backend): implement express api server and webhook handler"
```

---

### Task 5: Docker & Deployment Configuration

**Files:**
- Create: `backend/Dockerfile`
- Create: `docker-compose.yml`
- Create: `backend/.env.example`
- Create: `.dockerignore`

**Interfaces:**
- Consumes: Node 22 Alpine, Docker Compose
- Produces: Production Docker container for the Express backend with volume persistence for SQLite.

- [ ] **Step 1: Create Dockerfile, docker-compose.yml, and .env.example**
- [ ] **Step 2: Validate Docker configuration syntax and buildability**
- [ ] **Step 3: Commit**

```bash
git add backend/Dockerfile docker-compose.yml backend/.env.example .dockerignore
git commit -m "feat(docker): add dockerfile and docker-compose deployment"
```

---

### Task 6: MikroTik Hotspot Login Page & QRIS UI

**Files:**
- Create: `hotspot/login.html`
- Create: `hotspot/status.html`
- Create: `hotspot/logout.html`
- Create: `hotspot/alogin.html`
- Create: `hotspot/rlogin.html`
- Create: `hotspot/errors.txt`
- Create: `hotspot/md5.js`
- Create: `hotspot/css/style.css`
- Create: `hotspot/js/app.js`

**Interfaces:**
- Consumes: Backend API (`/api/packages`, `/api/payment/create-qris`, `/api/payment/status/:orderId`)
- Produces: Complete MikroTik hotspot package with modern responsive UI:
  - Standard voucher code / user login form
  - Modal / section for instant QRIS purchase
  - QRIS display with countdown timer
  - Auto-polling for payment confirmation
  - One-click auto login after payment succeeds
  - Voucher reprint / recovery by Order ID

- [ ] **Step 1: Create standard MikroTik hotspot template files and md5.js**
- [ ] **Step 2: Implement responsive CSS and modern UI in `hotspot/css/style.css`**
- [ ] **Step 3: Implement client-side purchase flow, QR display, polling, and auto-login in `hotspot/js/app.js`**
- [ ] **Step 4: Test hotspot markup and client scripts**
- [ ] **Step 5: Commit**

```bash
git add hotspot/
git commit -m "feat(hotspot): add mikrotik hotspot login template with qris purchase modal"
```

---

### Task 7: Comprehensive Documentation & MikroTik Walled Garden Setup

**Files:**
- Create: `README.md`
- Create: `mikrotik-setup.rsc`

**Interfaces:**
- Consumes: Complete project components
- Produces: Step-by-step setup guide for RouterOS (Walled Garden, Hotspot profile, file upload), Midtrans Dashboard configuration, and Docker deployment.

- [ ] **Step 1: Create RouterOS script `mikrotik-setup.rsc` for walled garden rules**
- [ ] **Step 2: Write complete `README.md` with architecture diagram, installation guide, and API docs**
- [ ] **Step 3: Commit**

```bash
git add README.md mikrotik-setup.rsc
git commit -m "docs: add mikrotik setup script and complete deployment guide"
```

---

### Task 8: Verification & GitHub Push

- [ ] **Step 1: Run all tests to verify 100% pass**

Run: `npm test` in `backend/`
Expected: All tests pass

- [ ] **Step 2: Push commits to GitHub repository `Anemonastrum/mikrotik-qris` using PAT**

Run: `git push -u origin main`
Expected: Successfully pushed to `https://github.com/Anemonastrum/mikrotik-qris`
