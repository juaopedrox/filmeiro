'use strict';

/**
 * db.js — Camada de persistência usando um arquivo JSON com escrita atômica.
 *
 * Por que JSON e não SQLite? Para um bot pessoal (alguns lançamentos por dia),
 * isto é mais que suficiente e tem uma vantagem enorme: NÃO precisa compilar
 * nada nativo. Funciona em qualquer versão de Node e em qualquer hospedagem,
 * sem depender de Python/build (que foi exatamente o que travou o deploy).
 *
 * A API pública é idêntica à versão SQLite anterior, então nenhum outro arquivo
 * do projeto precisou mudar.
 *
 * Escrita atômica: gravamos num arquivo temporário e renomeamos por cima. Assim,
 * se o processo cair no meio de uma gravação, o arquivo principal nunca corrompe.
 */

const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'financas.json');

// Estrutura em memória, carregada do disco no boot.
let data = { transactions: [], goals: [], limits: {}, users: {}, seq: { tx: 1, goal: 1 } };

function load() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf8');
      if (raw.trim()) {
        const parsed = JSON.parse(raw);
        data = Object.assign({ transactions: [], goals: [], limits: {}, users: {}, seq: { tx: 1, goal: 1 } }, parsed);
      }
    }
  } catch (e) {
    console.error('⚠️ Não consegui ler o banco, começando vazio:', e.message);
  }
}
load();

let saveTimer = null;
function save() {
  // Escrita atômica: grava em arquivo temporário e renomeia por cima.
  try {
    const tmp = DB_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, DB_PATH);
  } catch (e) {
    console.error('⚠️ Erro ao salvar o banco:', e.message);
  }
}
// Salva de forma "debounced": agrupa gravações próximas para não escrever a cada microssegundo.
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; save(); }, 150);
}

function round2(n) { return Math.round((n || 0) * 100) / 100; }

// ---- Helpers de data (idênticos à versão anterior) ----
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); }
function startOfWeek() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
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

function txOf(chatId) {
  const id = String(chatId);
  return data.transactions.filter(t => t.chat_id === id);
}

module.exports = {
  _path: DB_PATH,

  touchUser(chatId, name) {
    const id = String(chatId);
    const now = new Date().toISOString();
    if (!data.users[id]) data.users[id] = { name: name || null, created_at: now, last_seen: now };
    else { data.users[id].last_seen = now; if (name) data.users[id].name = name; }
    scheduleSave();
  },

  addTransaction(chatId, tx) {
    // O parser entrega a intenção com o campo `kind` ('income'|'expense').
    // Aceitamos tanto `type` quanto `kind` para evitar divergência de schema.
    const type = tx.type || tx.kind;
    const row = {
      id: data.seq.tx++,
      chat_id: String(chatId),
      type,
      amount: tx.amount,
      category_id: tx.category.id,
      category_name: tx.category.name,
      emoji: tx.category.emoji || '',
      description: tx.description || null,
      created_at: new Date().toISOString(),
    };
    data.transactions.push(row);
    scheduleSave();
    return row;
  },

  balance(chatId) {
    let income = 0, expense = 0;
    for (const t of txOf(chatId)) {
      if (t.type === 'income') income += t.amount;
      else expense += t.amount;
    }
    return { income: round2(income), expense: round2(expense), balance: round2(income - expense) };
  },

  summary(chatId, period) {
    const start = periodStart(period);
    const sel = txOf(chatId).filter(t => t.created_at >= start);
    let income = 0, expense = 0;
    const byCat = {};
    for (const t of sel) {
      if (t.type === 'income') { income += t.amount; continue; }
      expense += t.amount;
      if (!byCat[t.category_id]) {
        byCat[t.category_id] = { category_id: t.category_id, category_name: t.category_name, emoji: t.emoji, total: 0, n: 0 };
      }
      byCat[t.category_id].total += t.amount;
      byCat[t.category_id].n++;
    }
    const categories = Object.values(byCat)
      .map(c => ({ ...c, total: round2(c.total) }))
      .sort((a, b) => b.total - a.total);
    return { period, income: round2(income), expense: round2(expense), saving: round2(income - expense), categories };
  },

  spentInCategoryThisMonth(chatId, categoryId) {
    const start = startOfMonth();
    const total = txOf(chatId)
      .filter(t => t.type === 'expense' && t.category_id === categoryId && t.created_at >= start)
      .reduce((s, t) => s + t.amount, 0);
    return round2(total);
  },

  getLimit(chatId, categoryId) {
    const key = String(chatId) + ':' + categoryId;
    return data.limits[key] != null ? data.limits[key] : null;
  },
  setLimit(chatId, categoryId, cap) {
    data.limits[String(chatId) + ':' + categoryId] = cap;
    scheduleSave();
  },
  listLimits(chatId) {
    const prefix = String(chatId) + ':';
    return Object.entries(data.limits)
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, v]) => ({ category_id: k.slice(prefix.length), monthly_cap: v }));
  },

  lastTransaction(chatId) {
    const arr = txOf(chatId);
    return arr.length ? arr[arr.length - 1] : null;
  },
  deleteTransaction(id, chatId) {
    const cid = String(chatId);
    const idx = data.transactions.findIndex(t => t.id === id && t.chat_id === cid);
    if (idx >= 0) { data.transactions.splice(idx, 1); scheduleSave(); return true; }
    return false;
  },

  /** Todas as transações do usuário, mais antigas primeiro (para exportação CSV). */
  allTransactions(chatId) {
    return txOf(chatId).slice();
  },

  addGoal(chatId, name, target) {
    const goal = { id: data.seq.goal++, chat_id: String(chatId), name, target, saved: 0, created_at: new Date().toISOString() };
    data.goals.push(goal);
    scheduleSave();
    return goal.id;
  },
  listGoals(chatId) {
    const id = String(chatId);
    return data.goals.filter(g => g.chat_id === id);
  },
  addToGoal(chatId, goalId, amount) {
    const cid = String(chatId);
    const g = data.goals.find(x => x.id === goalId && x.chat_id === cid);
    if (g) { g.saved += amount; scheduleSave(); return true; }
    return false;
  },
  deleteGoal(chatId, goalId) {
    const cid = String(chatId);
    const idx = data.goals.findIndex(g => g.id === goalId && g.chat_id === cid);
    if (idx >= 0) { data.goals.splice(idx, 1); scheduleSave(); return true; }
    return false;
  },

  // Força gravação imediata (usado no encerramento do processo).
  flush() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; } save(); },
};
