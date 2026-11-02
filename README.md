# MikroTik Hotspot QRIS Voucher System

Sistem halaman login MikroTik Hotspot terintegrasi payment gateway **Midtrans QRIS**. Pengguna dapat membeli kode voucher internet langsung dari captive portal secara instan menggunakan QRIS (BCA, GoPay, OVO, DANA, ShopeePay, LinkAja, Mobile Banking), dan langsung online via tombol **Login Otomatis**.

---

## 🏗️ Arsitektur Sistem

```
+------------------------------------------------------------------+
|                     Perangkat Klien (Smartphone/PC)              |
+------------------------------------------------------------------+
                                 │
           1. Terhubung WiFi Hotspot (Captive Portal)
                                 ▼
+------------------------------------------------------------------+
|               MikroTik RouterOS (Hotspot Server)                 |
|  - Menyajikan template /hotspot (login.html, status.html, dll)   |
|  - Walled Garden: Mengizinkan akses ke Express Backend & QRIS    |
+------------------------------------------------------------------+
                                 │
             2. Klik "Beli Voucher" -> Memanggil API Backend
                                 ▼
+------------------------------------------------------------------+
|           Express.js Backend Service (Docker di Linux)           |
|  - Membuat transaksi QRIS ke Midtrans Core API                  |
|  - Verifikasi Webhook Signature (SHA-512)                        |
|  - Generate kode voucher unik                                    |
|  - Menambahkan user ke MikroTik (/rest/ip/hotspot/user)          |
|  - Database transaksi lokal (SQLite WAL)                         |
+------------------------------------------------------------------+
                 │                                  │
      3. Charge QRIS via API             4. Webhook Notifikasi
                 ▼                                  ▲
+------------------------------------------------------------------+
|                  Midtrans Payment Gateway (QRIS)                 |
+------------------------------------------------------------------+
```

---

## ✨ Fitur Utama

- **In-Page QRIS Purchase**: Pengguna membeli voucher langsung di jendela captive portal tanpa dialihkan ke browser eksternal.
- **Midtrans Core API QRIS**: Mendukung semua e-wallet dan m-banking berstandar QRIS nasional (BCA Mobile, Livin' Mandiri, BRImo, GoPay, OVO, DANA, ShopeePay).
- **Auto-Login Satu Klik**: Setelah pembayaran terkonfirmasi, tombol login otomatis langsung mengotentikasi pengguna ke MikroTik tanpa perlu mengetik ulang kode.
- **Auto-Provisioning MikroTik**: Backend secara otomatis membuat user hotspot baru di router MikroTik melalui RouterOS v7 REST API.
- **Verifikasi Webhook Aman**: Validasi tanda tangan SHA-512 memastikan notifikasi pembayaran sah dan mencegah pemalsuan voucher.
- **Pengecekan Status Fallback**: Frontend melakukan polling berkala ke backend, memastikan voucher tetap terbit meskipun webhook terhambat NAT.
- **Cek / Cetak Ulang Voucher**: Pengguna dapat memasukkan Order ID untuk melihat kembali kode voucher yang sudah dibeli.
- **Docker Ready**: Backend Express dibungkus dalam Docker container ringan (Node 22 Alpine) dengan volume persistensi SQLite.

---

## 📁 Struktur Direktori

```
.
├── backend/
│   ├── Dockerfile             # Container image Node.js 22 Alpine
│   ├── package.json           # Dependensi Express
│   ├── .env.example           # Contoh konfigurasi environment
│   ├── src/
│   │   ├── config.js          # Pengaturan server, Midtrans, dan MikroTik
│   │   ├── db.js              # Database SQLite (packages, orders, vouchers)
│   │   ├── midtrans.js        # Integrasi QRIS & validasi SHA-512 signature
│   │   ├── mikrotik.js        # Generator voucher & RouterOS REST API client
│   │   ├── app.js             # Express app & route handlers
│   │   └── server.js          # Entry point server
│   └── tests/                 # Unit & integration test suite (16 tests)
├── hotspot/                   # Template MikroTik Hotspot
│   ├── login.html             # Halaman login & modal pembelian QRIS
│   ├── status.html            # Halaman status koneksi (uptime, kuota, logout)
│   ├── logout.html            # Halaman konfirmasi logout
│   ├── alogin.html            # Redirect otomatis pasca-login
│   ├── rlogin.html            # Redirect login
│   ├── errors.txt             # Pesan error berbahasa Indonesia
│   ├── md5.js                 # Algoritma CHAP MD5 MikroTik
│   ├── css/style.css          # Desain antarmuka modern & responsif
│   └── js/app.js              # Logika frontend QRIS, countdown & auto-login
├── docker-compose.yml         # Konfigurasi deployment Docker
├── mikrotik-setup.rsc         # Script konfigurasi Walled Garden & Profile MikroTik
└── README.md
```

---

## 🚀 Panduan Instalasi & Deployment

### Langkah 1: Jalankan Backend dengan Docker di Server Linux

1. Clone repositori ke server Linux Anda:
   ```bash
   git clone https://github.com/Anemonastrum/mikrotik-qris.git
   cd mikrotik-qris
   ```

2. Buat file konfigurasi `.env` dari `.env.example`:
   ```bash
   cp backend/.env.example backend/.env
   nano backend/.env
   ```

3. Sesuaikan parameter berikut:
   ```env
   PORT=3000
   NODE_ENV=production
   DB_PATH=/app/data/mikrotik-qris.db

   # Midtrans Server Key & Client Key (dari Dashboard Midtrans)
   MIDTRANS_SERVER_KEY=SB-Mid-server-xxxxxxxxxxxxxxxxx
   MIDTRANS_CLIENT_KEY=SB-Mid-client-xxxxxxxxxxxxxxxxx
   MIDTRANS_IS_PRODUCTION=false # Ubah ke true untuk live production

   # Koneksi ke MikroTik RouterOS (RouterOS v7 REST API)
   MIKROTIK_HOST=192.168.88.1
   MIKROTIK_PORT=80
   MIKROTIK_USER=admin
   MIKROTIK_PASSWORD=password_mikrotik_anda
   MIKROTIK_USE_HTTPS=false
   MIKROTIK_DEFAULT_PROFILE=default
   ```

4. Jalankan backend menggunakan Docker Compose:
   ```bash
   docker compose up -d --build
   ```

5. Verifikasi backend telah berjalan:
   ```bash
   curl http://localhost:3000/api/health
   # Respon: {"status":"ok","timestamp":"..."}
   ```

---

### Langkah 2: Konfigurasi Walled Garden di MikroTik RouterOS

Agar pengguna yang belum login dapat membuka QRIS dan berkomunikasi dengan backend, aturan Walled Garden harus dipasang.

1. Buka Winbox atau Terminal MikroTik.
2. Import script `mikrotik-setup.rsc` atau jalankan perintah berikut (ganti `192.168.88.2` dengan IP server backend Anda):

```routeros
# Izinkan akses ke server backend
/ip hotspot walled-garden ip
add action=accept dst-address=192.168.88.2 comment="QRIS-Backend-Server"

# Izinkan akses ke domain Midtrans
/ip hotspot walled-garden
add action=allow dst-host=api.midtrans.com comment="Midtrans Production API"
add action=allow dst-host=api.sandbox.midtrans.com comment="Midtrans Sandbox API"
add action=allow dst-host=app.midtrans.com comment="Midtrans App Production"
add action=allow dst-host=app.sandbox.midtrans.com comment="Midtrans App Sandbox"
add action=allow dst-host=api.qrserver.com comment="QR Code Generator CDN"

# Pastikan service REST API aktif (RouterOS v7)
/ip service set www disabled=no port=80
```

---

### Langkah 3: Upload Template Hotspot ke MikroTik

1. Buka folder `hotspot/` pada komputer Anda.
2. Edit baris meta `backend-url` pada `hotspot/login.html` jika IP backend berbeda dengan gateway hotspot:
   ```html
   <meta name="backend-url" content="http://192.168.88.2:3000" />
   ```
3. Buka **Winbox** -> menu **Files**.
4. Drag & drop seluruh isi folder `hotspot/` ke direktori hotspot router Anda (biasanya `flash/hotspot` atau `hotspot`).
5. Pada menu **IP** -> **Hotspot** -> tab **Server Profiles** -> buka profil hotspot Anda -> pastikan **HTML Directory** mengarah ke folder template yang baru di-upload.

---

### Langkah 4: Pengaturan Webhook di Dashboard Midtrans

1. Masuk ke [Dashboard Midtrans](https://dashboard.midtrans.com/).
2. Buka menu **Settings** -> **Configuration**.
3. Pada bagian **Payment Notification URL**, isi URL webhook backend Anda:
   ```
   https://domain-backend-anda.com/api/payment/webhook
   ```
   *(Jika server backend berada di jaringan lokal tanpa IP publik, Anda dapat menggunakan Cloudflare Tunnel atau reverse proxy untuk meneruskan notifikasi webhook ke port 3000).*

---

## 📡 Dokumentasi API Backend

| Method | Endpoint | Deskripsi |
|---|---|---|
| `GET` | `/api/health` | Healthcheck server status |
| `GET` | `/api/packages` | Mengambil daftar paket voucher aktif |
| `POST` | `/api/payment/create-qris` | Membuat order baru & menghasilkan QRIS Midtrans |
| `GET` | `/api/payment/status/:orderId` | Memeriksa status transaksi & mengambil kode voucher |
| `POST` | `/api/payment/webhook` | Endpoint penerima notifikasi callback dari Midtrans |

---

## 🧪 Menjalankan Test

Proyek ini dilengkapi dengan automated unit & integration test menggunakan native test runner Node.js (`node:test`):

```bash
cd backend
npm test
```

Semua 16 pengujian mencakup:
- Inisialisasi database SQLite dan operasi CRUD voucher.
- Pembuatan QRIS payload & validasi tanda tangan SHA-512 Midtrans.
- Generator kode acak voucher unik & payload RouterOS user.
- Endpoint API Express, penanganan webhook, serta fallback rekonsiliasi pembayaran.

---

## 📄 Lisensi

MIT License. Bebas digunakan dan dimodifikasi untuk kebutuhan jaringan RT/RW Net, kafe, kantor, atau hotspot komersial Anda.
