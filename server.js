require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const packageJson = require('./package.json');
const { db, initDb, scheduleDbBackup } = require('./src/db');
const { signToken, authenticate, requireAdmin } = require('./src/auth');

const app = express();
const port = Number(process.env.PORT || 4000);
const buildVersion =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.RAILWAY_GIT_COMMIT_SHA ||
  process.env.RENDER_GIT_COMMIT ||
  packageJson.version;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

function normalizeMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100) / 100;
}

function generateTempPassword(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function localDateISO(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveDateRange(query, role) {
  const includeArchive = role === 'admin' && String(query.includeArchive || '0') === '1';
  let from = query.from ? String(query.from).trim() : '';
  let to = query.to ? String(query.to).trim() : '';

  if (!includeArchive && !from && !to) {
    const today = localDateISO();
    from = today;
    to = today;
  }

  return { from, to, includeArchive };
}

function ensureSessionUserRow(sessionUser) {
  const existing = db
    .prepare('SELECT id, name, username, role, active FROM users WHERE id = ? LIMIT 1')
    .get(sessionUser.id);

  if (existing && existing.active) return existing;

  const wasDeleted = db.prepare('SELECT user_id FROM deleted_users WHERE user_id = ? LIMIT 1').get(sessionUser.id);
  if (wasDeleted) return null;

  const fallbackHash = bcrypt.hashSync(`session-${sessionUser.id}-${sessionUser.username}`, 10);
  db.prepare(
    `INSERT OR REPLACE INTO users (id, name, username, password_hash, role, active)
     VALUES (?, ?, ?, ?, ?, 1)`
  ).run(sessionUser.id, sessionUser.name, String(sessionUser.username).toLowerCase(), fallbackHash, sessionUser.role);
  scheduleDbBackup();

  return db
    .prepare('SELECT id, name, username, role, active FROM users WHERE id = ? LIMIT 1')
    .get(sessionUser.id);
}

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = db
    .prepare(`SELECT id, name, username, password_hash, role, active FROM users WHERE username = ? LIMIT 1`)
    .get(String(username).trim().toLowerCase());

  if (!user || !user.active) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const isValid = bcrypt.compareSync(password, user.password_hash);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const safeUser = {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role
  };

  const token = signToken(safeUser);
  return res.json({ token, user: safeUser });
});

app.get('/api/auth/me', authenticate, (req, res) => {
  const recovered = ensureSessionUserRow(req.user);
  if (!recovered) {
    return res.status(401).json({ error: 'Session is invalid. Please log in again.' });
  }

  const user = db
    .prepare('SELECT id, name, username, role, active, created_at FROM users WHERE id = ? LIMIT 1')
    .get(req.user.id);

  if (!user || !user.active) {
    return res.status(401).json({ error: 'User not found or inactive' });
  }

  return res.json({ user });
});

app.get('/api/users', authenticate, requireAdmin, (req, res) => {
  const users = db
    .prepare('SELECT id, name, username, role, active, created_at FROM users WHERE active = 1 ORDER BY id DESC')
    .all();
  return res.json({ users });
});

app.post('/api/users', authenticate, requireAdmin, (req, res) => {
  const { name, username, password, role } = req.body || {};

  if (!name || !username || !password || !role) {
    return res.status(400).json({ error: 'name, username, password and role are required' });
  }

  if (!['admin', 'staff'].includes(role)) {
    return res.status(400).json({ error: 'role must be admin or staff' });
  }

  const normalizedUsername = String(username).trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE username = ? LIMIT 1').get(normalizedUsername);
  if (existing) {
    return res.status(409).json({ error: 'Username already exists' });
  }

  const passwordHash = bcrypt.hashSync(String(password), 10);
  const result = db
    .prepare('INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(String(name).trim(), normalizedUsername, passwordHash, role);
  scheduleDbBackup();

  const createdUser = db
    .prepare('SELECT id, name, username, role, active, created_at FROM users WHERE id = ?')
    .get(result.lastInsertRowid);

  return res.status(201).json({ user: createdUser });
});

app.post('/api/users/:id/reset-password', authenticate, requireAdmin, (req, res) => {
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return res.status(400).json({ error: 'Invalid user id' });
  }

  const target = db
    .prepare('SELECT id, name, username, role, active FROM users WHERE id = ? LIMIT 1')
    .get(targetId);

  if (!target || !target.active) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (target.role !== 'staff') {
    return res.status(400).json({ error: 'Only staff passwords can be reset here' });
  }

  const requested = req.body && typeof req.body.newPassword === 'string' ? req.body.newPassword.trim() : '';
  const temporaryPassword = requested || generateTempPassword(10);

  if (temporaryPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const passwordHash = bcrypt.hashSync(temporaryPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, target.id);
  scheduleDbBackup();

  return res.json({
    user: {
      id: target.id,
      name: target.name,
      username: target.username,
      role: target.role
    },
    temporaryPassword
  });
});

app.put('/api/users/:id', authenticate, requireAdmin, (req, res) => {
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return res.status(400).json({ error: 'Invalid user id' });
  }

  const target = db
    .prepare('SELECT id, name, username, role, active FROM users WHERE id = ? AND active = 1 LIMIT 1')
    .get(targetId);

  if (!target) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (target.role !== 'staff') {
    return res.status(400).json({ error: 'Only staff users can be edited here' });
  }

  const payload = req.body || {};
  const updates = [];
  const params = [];

  if (payload.name !== undefined) {
    const value = String(payload.name || '').trim();
    if (!value) return res.status(400).json({ error: 'name cannot be empty' });
    updates.push('name = ?');
    params.push(value);
  }

  if (payload.username !== undefined) {
    const value = String(payload.username || '').trim().toLowerCase();
    if (!value) return res.status(400).json({ error: 'username cannot be empty' });
    const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ? LIMIT 1').get(value, target.id);
    if (existing) return res.status(409).json({ error: 'Username already exists' });
    updates.push('username = ?');
    params.push(value);
  }

  if (payload.active !== undefined) {
    updates.push('active = ?');
    params.push(payload.active ? 1 : 0);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  params.push(target.id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  scheduleDbBackup();

  const updated = db
    .prepare('SELECT id, name, username, role, active, created_at FROM users WHERE id = ? LIMIT 1')
    .get(target.id);
  return res.json({ user: updated });
});

app.delete('/api/users/:id', authenticate, requireAdmin, (req, res) => {
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return res.status(400).json({ error: 'Invalid user id' });
  }

  const target = db
    .prepare('SELECT id, role, active FROM users WHERE id = ? AND active = 1 LIMIT 1')
    .get(targetId);

  if (!target) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (target.role !== 'staff') {
    return res.status(400).json({ error: 'Only staff users can be removed here' });
  }

  const runDelete = db.transaction(() => {
    // Keep historical transactions accessible even after removing staff.
    db.prepare('UPDATE transactions SET user_id = ? WHERE user_id = ?').run(req.user.id, target.id);
    db.prepare('UPDATE transactions SET created_by = ? WHERE created_by = ?').run(req.user.id, target.id);
    db.prepare('INSERT OR REPLACE INTO deleted_users (user_id, username) VALUES (?, ?)').run(target.id, null);
    db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  });
  runDelete();
  scheduleDbBackup();

  return res.json({ ok: true });
});

app.get('/api/categories', authenticate, (req, res) => {
  const { type } = req.query;

  let rows;
  if (type && ['income', 'expense'].includes(type)) {
    rows = db.prepare('SELECT id, name, type, created_at FROM categories WHERE type = ? ORDER BY name ASC').all(type);
  } else {
    rows = db.prepare('SELECT id, name, type, created_at FROM categories ORDER BY type ASC, name ASC').all();
  }

  return res.json({ categories: rows });
});

app.post('/api/categories', authenticate, requireAdmin, (req, res) => {
  const { name, type } = req.body || {};
  if (!name || !type) {
    return res.status(400).json({ error: 'name and type are required' });
  }

  if (!['income', 'expense'].includes(type)) {
    return res.status(400).json({ error: 'type must be income or expense' });
  }

  const result = db.prepare('INSERT INTO categories (name, type) VALUES (?, ?)').run(String(name).trim(), type);
  scheduleDbBackup();
  const category = db
    .prepare('SELECT id, name, type, created_at FROM categories WHERE id = ? LIMIT 1')
    .get(result.lastInsertRowid);

  return res.status(201).json({ category });
});

app.post('/api/transactions', authenticate, (req, res) => {
  const {
    type,
    itemType,
    categoryId,
    description,
    quantity,
    unitPrice,
    amount,
    receiptNo,
    transactionDate,
    userId
  } = req.body || {};

  if (!['income', 'expense'].includes(type)) {
    return res.status(400).json({ error: 'type must be income or expense' });
  }

  if (!['spare', 'service', 'other_expense', 'other_income'].includes(itemType)) {
    return res.status(400).json({ error: 'Invalid itemType' });
  }

  const category = db.prepare('SELECT id, type FROM categories WHERE id = ? LIMIT 1').get(Number(categoryId));
  if (!category) {
    return res.status(400).json({ error: 'Invalid category' });
  }

  if (category.type !== type) {
    return res.status(400).json({ error: 'Category type must match transaction type' });
  }

  const parsedQuantity = quantity === null || quantity === undefined || quantity === '' ? null : Number(quantity);
  const parsedUnitPrice = unitPrice === null || unitPrice === undefined || unitPrice === '' ? null : Number(unitPrice);

  const normalizedAmount = normalizeMoney(amount);
  if (normalizedAmount === null || normalizedAmount <= 0) {
    return res.status(400).json({ error: 'amount must be greater than 0' });
  }

  const effectiveUserId = req.user.role === 'admin' && userId ? Number(userId) : req.user.id;
  if (effectiveUserId === req.user.id) {
    const recovered = ensureSessionUserRow(req.user);
    if (!recovered) {
      return res.status(401).json({ error: 'Session is invalid. Please log in again.' });
    }
  } else {
    const userExists = db.prepare('SELECT id FROM users WHERE id = ? LIMIT 1').get(effectiveUserId);
    if (!userExists) {
      return res.status(400).json({ error: 'Selected user does not exist' });
    }
  }

  const safeReceiptNo = String(receiptNo || '').trim() || `RCPT-${Date.now()}`;
  const safeDate = String(transactionDate || '').trim() || new Date().toISOString().slice(0, 10);

  const result = db
    .prepare(`
      INSERT INTO transactions (
        user_id,
        created_by,
        type,
        item_type,
        category_id,
        description,
        quantity,
        unit_price,
        amount,
        receipt_no,
        transaction_date
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      effectiveUserId,
      req.user.id,
      type,
      itemType,
      Number(categoryId),
      String(description || '').trim(),
      Number.isFinite(parsedQuantity) ? parsedQuantity : null,
      Number.isFinite(parsedUnitPrice) ? parsedUnitPrice : null,
      normalizedAmount,
      safeReceiptNo,
      safeDate
    );
  scheduleDbBackup();

  const transaction = db
    .prepare(`
      SELECT t.*, c.name as category_name, u.name as user_name
      FROM transactions t
      JOIN categories c ON c.id = t.category_id
      JOIN users u ON u.id = t.user_id
      WHERE t.id = ?
    `)
    .get(result.lastInsertRowid);

  return res.status(201).json({ transaction });
});

app.get('/api/transactions', authenticate, (req, res) => {
  const { type, categoryId, userId, search } = req.query;
  const { from, to } = resolveDateRange(req.query, req.user.role);

  const where = [];
  const params = [];

  if (req.user.role !== 'admin') {
    where.push('t.user_id = ?');
    params.push(req.user.id);
  } else if (userId) {
    where.push('t.user_id = ?');
    params.push(Number(userId));
  }

  if (type && ['income', 'expense'].includes(type)) {
    where.push('t.type = ?');
    params.push(type);
  }

  if (categoryId) {
    where.push('t.category_id = ?');
    params.push(Number(categoryId));
  }

  if (from) {
    where.push('date(t.transaction_date) >= date(?)');
    params.push(from);
  }

  if (to) {
    where.push('date(t.transaction_date) <= date(?)');
    params.push(to);
  }

  if (search) {
    where.push('(t.description LIKE ? OR t.receipt_no LIKE ?)');
    const pattern = `%${String(search).trim()}%`;
    params.push(pattern, pattern);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db
    .prepare(`
      SELECT
        t.id,
        t.type,
        t.item_type,
        t.description,
        t.quantity,
        t.unit_price,
        t.amount,
        t.receipt_no,
        t.transaction_date,
        t.created_at,
        c.id as category_id,
        c.name as category_name,
        u.id as user_id,
        u.name as user_name,
        u.username as user_username
      FROM transactions t
      JOIN categories c ON c.id = t.category_id
      JOIN users u ON u.id = t.user_id
      ${whereSql}
      ORDER BY date(t.transaction_date) DESC, t.id DESC
      LIMIT 1000
    `)
    .all(...params);

  return res.json({ transactions: rows });
});

app.get('/api/reports/summary', authenticate, (req, res) => {
  const { userId } = req.query;
  const { from, to } = resolveDateRange(req.query, req.user.role);

  const where = [];
  const params = [];

  if (req.user.role !== 'admin') {
    where.push('t.user_id = ?');
    params.push(req.user.id);
  } else if (userId) {
    where.push('t.user_id = ?');
    params.push(Number(userId));
  }

  if (from) {
    where.push('date(t.transaction_date) >= date(?)');
    params.push(from);
  }

  if (to) {
    where.push('date(t.transaction_date) <= date(?)');
    params.push(to);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totals = db
    .prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount END), 0) AS total_income,
        COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount END), 0) AS total_expense
      FROM transactions t
      ${whereSql}
    `)
    .get(...params);

  const byCategory = db
    .prepare(`
      SELECT
        c.type,
        c.name,
        COALESCE(SUM(t.amount), 0) AS total
      FROM categories c
      LEFT JOIN transactions t ON t.category_id = c.id ${where.length ? `AND ${where.join(' AND ')}` : ''}
      GROUP BY c.id, c.type, c.name
      ORDER BY c.type, total DESC, c.name ASC
    `)
    .all(...params);

  return res.json({
    totals: {
      income: Number(totals.total_income || 0),
      expense: Number(totals.total_expense || 0),
      balance: Number((totals.total_income || 0) - (totals.total_expense || 0))
    },
    byCategory
  });
});

app.put('/api/transactions/:id', authenticate, requireAdmin, (req, res) => {
  const transactionId = Number(req.params.id);
  if (!Number.isInteger(transactionId) || transactionId <= 0) {
    return res.status(400).json({ error: 'Invalid transaction id' });
  }

  const existing = db.prepare('SELECT id FROM transactions WHERE id = ? LIMIT 1').get(transactionId);
  if (!existing) {
    return res.status(404).json({ error: 'Transaction not found' });
  }

  const { type, itemType, categoryId, description, quantity, unitPrice, amount, receiptNo, transactionDate } = req.body || {};

  if (!['income', 'expense'].includes(type)) {
    return res.status(400).json({ error: 'type must be income or expense' });
  }

  if (!['spare', 'service', 'other_expense', 'other_income'].includes(itemType)) {
    return res.status(400).json({ error: 'Invalid itemType' });
  }

  const category = db.prepare('SELECT id, type FROM categories WHERE id = ? LIMIT 1').get(Number(categoryId));
  if (!category) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  if (category.type !== type) {
    return res.status(400).json({ error: 'Category type must match transaction type' });
  }

  const parsedQuantity = quantity === null || quantity === undefined || quantity === '' ? null : Number(quantity);
  const parsedUnitPrice = unitPrice === null || unitPrice === undefined || unitPrice === '' ? null : Number(unitPrice);

  const normalizedAmount = normalizeMoney(amount);
  if (normalizedAmount === null || normalizedAmount <= 0) {
    return res.status(400).json({ error: 'amount must be greater than 0' });
  }

  const safeReceiptNo = String(receiptNo || '').trim() || `RCPT-${Date.now()}`;
  const safeDate = String(transactionDate || '').trim() || localDateISO();

  db.prepare(
    `UPDATE transactions
     SET type = ?, item_type = ?, category_id = ?, description = ?, quantity = ?, unit_price = ?, amount = ?, receipt_no = ?, transaction_date = ?
     WHERE id = ?`
  ).run(
    type,
    itemType,
    Number(categoryId),
    String(description || '').trim(),
    Number.isFinite(parsedQuantity) ? parsedQuantity : null,
    Number.isFinite(parsedUnitPrice) ? parsedUnitPrice : null,
    normalizedAmount,
    safeReceiptNo,
    safeDate,
    transactionId
  );
  scheduleDbBackup();

  const transaction = db
    .prepare(
      `SELECT
         t.id,
         t.type,
         t.item_type,
         t.description,
         t.quantity,
         t.unit_price,
         t.amount,
         t.receipt_no,
         t.transaction_date,
         t.created_at,
         c.id as category_id,
         c.name as category_name,
         u.id as user_id,
         u.name as user_name,
         u.username as user_username
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
       JOIN users u ON u.id = t.user_id
       WHERE t.id = ?`
    )
    .get(transactionId);

  return res.json({ transaction });
});

app.get('/api/health', (_req, res) => {
  return res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/api/version', (_req, res) => {
  return res.json({
    version: buildVersion,
    app: packageJson.name
  });
});

app.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function startServer() {
  await initDb();
  app.listen(port, () => {
    console.log(`POS system running on http://localhost:${port}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
