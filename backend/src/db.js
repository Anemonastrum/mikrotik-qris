import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export function initDb(dbPath = config.dbPath) {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(dbPath);

  // Enable WAL mode for file-based databases
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }

  // Schema creation
  db.exec(`
    CREATE TABLE IF NOT EXISTS packages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price INTEGER NOT NULL,
      profile TEXT NOT NULL,
      uptime_limit TEXT NOT NULL,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS orders (
      order_id TEXT PRIMARY KEY,
      package_id TEXT NOT NULL,
      package_name TEXT NOT NULL,
      amount INTEGER NOT NULL,
      customer_phone TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      qr_string TEXT,
      qr_url TEXT,
      transaction_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vouchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT UNIQUE NOT NULL,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      profile TEXT NOT NULL,
      uptime_limit TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(order_id)
    );
  `);

  // Seed default packages if empty
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM packages');
  const countRow = countStmt.get();
  if (countRow.count === 0) {
    const insertPkg = db.prepare(`
      INSERT INTO packages (id, name, price, profile, uptime_limit, description, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `);
    for (const pkg of config.defaultPackages) {
      insertPkg.run(pkg.id, pkg.name, pkg.price, pkg.profile, pkg.uptimeLimit, pkg.description);
    }
  }

  return db;
}

export function getPackages(db) {
  const stmt = db.prepare('SELECT * FROM packages WHERE is_active = 1 ORDER BY price ASC');
  return stmt.all();
}

export function getPackageById(db, packageId) {
  const stmt = db.prepare('SELECT * FROM packages WHERE id = ?');
  return stmt.get(packageId);
}

export function createOrder(db, { orderId, packageId, packageName, amount, customerPhone, qrString = '', qrUrl = '' }) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO orders (order_id, package_id, package_name, amount, customer_phone, status, qr_string, qr_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
  `);
  stmt.run(orderId, packageId, packageName, amount, customerPhone || '', qrString, qrUrl, now, now);
  return getOrder(db, orderId);
}

export function getOrder(db, orderId) {
  const stmt = db.prepare(`
    SELECT o.*, v.username AS voucher_username, v.password AS voucher_password,
           v.profile AS voucher_profile, v.uptime_limit AS voucher_uptime_limit
    FROM orders o
    LEFT JOIN vouchers v ON o.order_id = v.order_id
    WHERE o.order_id = ?
  `);
  return stmt.get(orderId);
}

export function updateOrderStatus(db, orderId, status, { transactionId = null, qrString = null, qrUrl = null } = {}) {
  const now = new Date().toISOString();
  let query = 'UPDATE orders SET status = ?, updated_at = ?';
  const params = [status, now];

  if (transactionId !== null) {
    query += ', transaction_id = ?';
    params.push(transactionId);
  }
  if (qrString !== null) {
    query += ', qr_string = ?';
    params.push(qrString);
  }
  if (qrUrl !== null) {
    query += ', qr_url = ?';
    params.push(qrUrl);
  }

  query += ' WHERE order_id = ?';
  params.push(orderId);

  const stmt = db.prepare(query);
  stmt.run(...params);
  return getOrder(db, orderId);
}

export function attachVoucher(db, orderId, { username, password, profile, uptimeLimit }) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO vouchers (order_id, username, password, profile, uptime_limit, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(orderId, username, password, profile, uptimeLimit, now);
  return getOrder(db, orderId);
}
