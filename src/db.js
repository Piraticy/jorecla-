const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const dataDir = process.env.VERCEL === '1' ? '/tmp' : path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'pos.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

function initDb() {
  db.exec(`
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

  const adminExists = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!adminExists) {
    const passwordHash = bcrypt.hashSync('admin123', 10);
    db.prepare(`
      INSERT INTO users (name, username, password_hash, role)
      VALUES (?, ?, ?, 'admin')
    `).run('System Admin', 'admin', passwordHash);
  }

  const categoryCount = db.prepare('SELECT COUNT(*) as count FROM categories').get().count;
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

    const insertCategory = db.prepare('INSERT INTO categories (name, type) VALUES (?, ?)');
    const insertMany = db.transaction((rows) => {
      for (const row of rows) {
        insertCategory.run(row[0], row[1]);
      }
    });
    insertMany(defaultCategories);
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
  const renameStmt = db.prepare('UPDATE categories SET name = ? WHERE name = ?');
  for (const [oldName, newName] of renameMap) {
    renameStmt.run(newName, oldName);
  }
}

module.exports = {
  db,
  initDb
};
