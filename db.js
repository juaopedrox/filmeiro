'use strict';

/**
 * db.js — Camada de persistência usando SQLite (arquivo local, zero configuração).
 *
 * Usa `better-sqlite3`: rápido, síncrono e sem servidor. O banco inteiro é um
 * único arquivo (financas.db) que fica junto do bot. Cada usuário do Telegram é
 * isolado pelo seu chatId.
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'financas.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL'); // melhor concorrência/segurança

// ---------------------------------------------------------------------------
// Esquema
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id     TEXT NOT NULL,
    type        TEXT NOT NULL,            -- 'income' | 'expense'
    amount      REAL NOT NULL,
    category_id TEXT NOT NULL,
    category_name TEXT NOT NULL,
    emoji       TEXT,
    description TEXT,
    created_at  TEXT NOT NULL             -- ISO timestamp
  );

  CREATE INDEX IF NOT EXISTS idx_tx_chat ON transactions(chat_id);
  CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(chat_id, created_at);

  CREATE TABLE IF NOT EXISTS goals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id     TEXT NOT NULL,
    name        TEXT NOT NULL,
    target      REAL NOT NULL,
    saved       REAL NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS limits (
    chat_id     TEXT NOT NULL,
    category_id TEXT NOT NULL,
    monthly_cap REAL NOT NULL,
    PRIMARY KEY (chat_id, category_id)
  );

  CREATE TABLE IF NOT EXISTS users (
    chat_id     TEXT PRIMARY KEY,
    name        TEXT,
    created_at  TEXT NOT NULL,
    last_seen   TEXT
  );
`);

// ---------------------------------------------------------------------------
// Statements preparados
// ---------------------------------------------------------------------------
const stmts = {
  insertTx: db.prepare(`INSERT INTO transactions
    (chat_id, type, amount, category_id, category_name, emoji, description, created_at)
    VALUES (@chat_id, @type, @amount, @category_id, @category_name, @emoji, @description, @created_at)`),

  txByPeriod: db.prepare(`SELECT * FROM transactions
    WHERE chat_id = ? AND created_at >= ? ORDER BY created_at DESC`),

  allTx: db.prepare(`SELECT * FROM transactions WHERE chat_id = ? ORDER BY created_at DESC`),

  sumByType: db.prepare(`SELECT type, SUM(amount) AS total FROM transactions
    WHERE chat_id = ? GROUP BY type`),

  sumByTypePeriod: db.prepare(`SELECT type, SUM(amount) AS total FROM transactions
    WHERE chat_id = ? AND created_at >= ? GROUP BY type`),

  byCategoryPeriod: db.prepare(`SELECT category_id, category_name, emoji,
    SUM(amount) AS total, COUNT(*) AS n FROM transactions
    WHERE chat_id = ? AND type = 'expense' AND created_at >= ?
    GROUP BY category_id ORDER BY total DESC`),

  catSpentThisMonth: db.prepare(`SELECT SUM(amount) AS total FROM transactions
    WHERE chat_id = ? AND type = 'expense' AND category_id = ? AND created_at >= ?`),

  lastTx: db.prepare(`SELECT * FROM transactions WHERE chat_id = ? ORDER BY id DESC LIMIT 1`),
  deleteTx: db.prepare(`DELETE FROM transactions WHERE id = ? AND chat_id = ?`),

  insertGoal: db.prepare(`INSERT INTO goals (chat_id, name, target, saved, created_at)
    VALUES (?, ?, ?, 0, ?)`),
  listGoals: db.prepare(`SELECT * FROM goals WHERE chat_id = ? ORDER BY id`),
  addToGoal: db.prepare(`UPDATE goals SET saved = saved + ? WHERE id = ? AND chat_id = ?`),
  deleteGoal: db.prepare(`DELETE FROM goals WHERE id = ? AND chat_id = ?`),

  setLimit: db.prepare(`INSERT INTO limits (chat_id, category_id, monthly_cap)
    VALUES (?, ?, ?) ON CONFLICT(chat_id, category_id) DO UPDATE SET monthly_cap = excluded.monthly_cap`),
  getLimit: db.prepare(`SELECT monthly_cap FROM limits WHERE chat_id = ? AND category_id = ?`),
  listLimits: db.prepare(`SELECT * FROM limits WHERE chat_id = ?`),

  upsertUser: db.prepare(`INSERT INTO users (chat_id, name, created_at, last_seen)
    VALUES (?, ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET last_seen = excluded.last_seen`),
};

// ---------------------------------------------------------------------------
// Helpers de data
// ---------------------------------------------------------------------------
function startOfToday() { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString(); }
function startOfWeek() {
  const d = new Date(); d.setHours(0,0,0,0);
  const day = (d.getDay() + 6) % 7; // segunda = 0
  d.setDate(d.getDate() - day);
  return d.toISOString();
}
function startOfMonth() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString(); }
function periodStart(period) {
  if (period === 'hoje') return startOfToday();
  if (period === 'semana') return startOfWeek();
  return startOfMonth();
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------
module.exports = {
  raw: db,

  touchUser(chatId, name) {
    const now = new Date().toISOString();
    stmts.upsertUser.run(String(chatId), name || null, now, now);
  },

  addTransaction(chatId, tx) {
    // O parser entrega a intenção com o campo `kind` ('income'|'expense').
    // Aceitamos tanto `type` quanto `kind` para evitar divergência de schema.
    const type = tx.type || tx.kind;
    const row = {
      chat_id: String(chatId),
      type,
      amount: tx.amount,
      category_id: tx.category.id,
      category_name: tx.category.name,
      emoji: tx.category.emoji || '',
      description: tx.description || null,
      created_at: new Date().toISOString(),
    };
    const info = stmts.insertTx.run(row);
    return { id: info.lastInsertRowid, ...row };
  },

  /** Saldo total (todas as entradas - todas as saídas) */
  balance(chatId) {
    const rows = stmts.sumByType.all(String(chatId));
    let income = 0, expense = 0;
    for (const r of rows) {
      if (r.type === 'income') income = r.total || 0;
      else if (r.type === 'expense') expense = r.total || 0;
    }
    return { income, expense, balance: round2(income - expense) };
  },

  /** Resumo de um período: total in/out + ranking por categoria */
  summary(chatId, period) {
    const start = periodStart(period);
    const sums = stmts.sumByTypePeriod.all(String(chatId), start);
    let income = 0, expense = 0;
    for (const r of sums) {
      if (r.type === 'income') income = r.total || 0;
      else if (r.type === 'expense') expense = r.total || 0;
    }
    const categories = stmts.byCategoryPeriod.all(String(chatId), start)
      .map(c => ({ ...c, total: round2(c.total) }));
    return {
      period,
      income: round2(income),
      expense: round2(expense),
      saving: round2(income - expense),
      categories,
    };
  },

  /** Quanto já foi gasto numa categoria neste mês (pra alertas de limite) */
  spentInCategoryThisMonth(chatId, categoryId) {
    const r = stmts.catSpentThisMonth.get(String(chatId), categoryId, startOfMonth());
    return round2((r && r.total) || 0);
  },

  getLimit(chatId, categoryId) {
    const r = stmts.getLimit.get(String(chatId), categoryId);
    return r ? r.monthly_cap : null;
  },
  setLimit(chatId, categoryId, cap) {
    stmts.setLimit.run(String(chatId), categoryId, cap);
  },
  listLimits(chatId) { return stmts.listLimits.all(String(chatId)); },

  lastTransaction(chatId) { return stmts.lastTx.get(String(chatId)); },
  deleteTransaction(id, chatId) { return stmts.deleteTx.run(id, String(chatId)).changes > 0; },

  /** Todas as transações do usuário, mais antigas primeiro (para exportação CSV). */
  allTransactions(chatId) {
    return stmts.allTx.all(String(chatId)).slice().reverse();
  },

  addGoal(chatId, name, target) {
    const info = stmts.insertGoal.run(String(chatId), name, target, new Date().toISOString());
    return info.lastInsertRowid;
  },
  listGoals(chatId) { return stmts.listGoals.all(String(chatId)); },
  addToGoal(chatId, goalId, amount) { return stmts.addToGoal.run(amount, goalId, String(chatId)).changes > 0; },
  deleteGoal(chatId, goalId) { return stmts.deleteGoal.run(goalId, String(chatId)).changes > 0; },
};

function round2(n) { return Math.round((n || 0) * 100) / 100; }
