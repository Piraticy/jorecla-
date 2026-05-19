const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const isVercel = process.env.VERCEL === '1';
const dataDir = isVercel ? '/tmp' : path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'pos.db');

const blobEnabled = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const blobPathname = process.env.BLOB_DB_PATH || 'jorecla/pos.db';
const blobAccess = process.env.BLOB_ACCESS === 'public' ? 'public' : 'private';

let dbInstance = null;
let backupTimer = null;
let backupInFlight = null;
const storageStatus = {
  blobEnabled,
  blobPathname,
  blobAccess,
  restoredFromBlob: false,
  lastRestoreAt: '',
  lastBackupAt: '',
  lastBackupOk: false,
  lastError: ''
};

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

async function restoreDbFromBlob() {
  if (!blobEnabled) return false;

  try {
    const { get } = require('@vercel/blob');
    const result = await get(blobPathname, { access: blobAccess });
    if (!result || !result.stream) return false;

    const response = new Response(result.stream);
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(dbPath, buffer);
    storageStatus.restoredFromBlob = true;
    storageStatus.lastRestoreAt = new Date().toISOString();
    storageStatus.lastError = '';
    return true;
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    storageStatus.lastError = `restore: ${message}`;
    console.warn('[db] Blob restore skipped:', message);
    return false;
  }
}

async function persistDbNow() {
  if (!blobEnabled || !dbInstance) return false;
  if (!fs.existsSync(dbPath)) return false;

  try {
    const { put } = require('@vercel/blob');

    // Ensure WAL pages are merged into the main DB file before upload.
    dbInstance.pragma('wal_checkpoint(TRUNCATE)');

    const data = fs.readFileSync(dbPath);
    await put(blobPathname, data, {
      access: blobAccess,
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/octet-stream'
    });
    storageStatus.lastBackupOk = true;
    storageStatus.lastBackupAt = new Date().toISOString();
    storageStatus.lastError = '';
    return true;
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    storageStatus.lastBackupOk = false;
    storageStatus.lastError = `backup: ${message}`;
    console.warn('[db] Blob backup failed:', message);
    return false;
  }
}

function scheduleDbBackup() {
  if (!blobEnabled || !dbInstance) return;

  if (backupTimer) return;
  backupTimer = setTimeout(() => {
    backupTimer = null;
    if (backupInFlight) return;

    backupInFlight = persistDbNow()
      .catch(() => false)
      .finally(() => {
        backupInFlight = null;
      });
  }, 500);
}

function openDb() {
  if (dbInstance) return dbInstance;
  dbInstance = new Database(dbPath);
  dbInstance.pragma('journal_mode = WAL');
  return dbInstance;
}

function getDb() {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return dbInstance;
}

const db = new Proxy(
  {},
  {
    get(_target, prop) {
      const instance = getDb();
      const value = instance[prop];
      return typeof value === 'function' ? value.bind(instance) : value;
    }
  }
);

async function initDb() {
  await restoreDbFromBlob();
  const instance = openDb();

  instance.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'staff')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      created_by INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
      item_type TEXT NOT NULL CHECK(item_type IN ('spare', 'service', 'other_expense', 'other_income')),
      category_id INTEGER NOT NULL,
      description TEXT,
      quantity REAL,
      unit_price REAL,
      amount REAL NOT NULL CHECK(amount >= 0),
      receipt_no TEXT NOT NULL,
      transaction_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(created_by) REFERENCES users(id),
      FOREIGN KEY(category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS deleted_users (
      user_id INTEGER PRIMARY KEY,
      username TEXT,
      deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date);
    CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
    CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
  `);

  let seeded = false;

  const adminExists = instance.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!adminExists) {
    const passwordHash = bcrypt.hashSync('admin123', 10);
    instance
      .prepare(`
        INSERT INTO users (name, username, password_hash, role)
        VALUES (?, ?, ?, 'admin')
      `)
      .run('System Admin', 'admin', passwordHash);
    seeded = true;
  }

  const categoryCount = instance.prepare('SELECT COUNT(*) as count FROM categories').get().count;
  if (categoryCount === 0) {
    const defaultCategories = [
      ['Spare Sales', 'income'],
      ['Service Charges', 'income'],
      ['Other Income', 'income'],
      ['Purchase of Spares', 'expense'],
      ['Rent', 'expense'],
      ['Utilities', 'expense'],
      ['Transport', 'expense'],
      ['Salaries', 'expense'],
      ['Other Expense', 'expense']
    ];

    const insertCategory = instance.prepare('INSERT INTO categories (name, type) VALUES (?, ?)');
    const insertMany = instance.transaction((rows) => {
      for (const row of rows) {
        insertCategory.run(row[0], row[1]);
      }
    });
    insertMany(defaultCategories);
    seeded = true;
  }

  const renameMap = [
    ['Mauzo ya Spare', 'Spare Sales'],
    ['Malipo ya Huduma', 'Service Charges'],
    ['Mapato Mengine', 'Other Income'],
    ['Ununuzi wa Spare', 'Purchase of Spares'],
    ['Kodi', 'Rent'],
    ['Huduma (Maji/Umeme)', 'Utilities'],
    ['Usafiri', 'Transport'],
    ['Mishahara', 'Salaries'],
    ['Matumizi Mengine', 'Other Expense']
  ];
  const renameStmt = instance.prepare('UPDATE categories SET name = ? WHERE name = ?');
  for (const [oldName, newName] of renameMap) {
    renameStmt.run(newName, oldName);
  }

  if (seeded) {
    await persistDbNow();
  }
}

module.exports = {
  db,
  initDb,
  scheduleDbBackup,
  persistDbNow,
  getStorageStatus: () => ({ ...storageStatus })
};
