'use strict';
/**
 * test-db-real.js — Testa o db.js REAL (não o shim), exercitando a persistência
 * em JSON de ponta a ponta, incluindo recarregar do disco.
 */
const fs = require('fs');
const path = require('path');

// Usa um arquivo de banco temporário e isolado.
const TMP = path.join(__dirname, 'test-tmp.json');
process.env.DB_PATH = TMP;
try { fs.unlinkSync(TMP); } catch (_) {}

let pass = 0, fail = 0;
function check(label, cond) { console.log(`  ${cond ? '✓' : '✗'} ${label}`); cond ? pass++ : fail++; }

const db = require('./src/db');
const CHAT = 999;

console.log('=== DB REAL (persistência JSON) ===');

// Lançamentos
const t1 = db.addTransaction(CHAT, { kind: 'income', amount: 5000, category: { id: 'salario', name: 'Salário', emoji: '💼' }, description: 'Salário' });
const t2 = db.addTransaction(CHAT, { kind: 'expense', amount: 120, category: { id: 'delivery', name: 'Delivery', emoji: '🛵' }, description: 'iFood' });
const t3 = db.addTransaction(CHAT, { kind: 'expense', amount: 350, category: { id: 'mercado', name: 'Mercado', emoji: '🛒' }, description: 'Compras' });
check('addTransaction retorna id incremental', t1.id === 1 && t2.id === 2 && t3.id === 3);
check('income gravado como income (não expense!)', t1.type === 'income');

const bal = db.balance(CHAT);
check('saldo correto: 5000 - 470 = 4530', bal.balance === 4530);
check('income total 5000', bal.income === 5000);
check('expense total 470', bal.expense === 470);

const sum = db.summary(CHAT, 'mes');
check('resumo: top categoria é Mercado (350)', sum.categories[0].category_id === 'mercado' && sum.categories[0].total === 350);
check('resumo saving = 4530', sum.saving === 4530);

// Limites
db.setLimit(CHAT, 'delivery', 100);
check('getLimit retorna 100', db.getLimit(CHAT, 'delivery') === 100);
check('spentInCategoryThisMonth delivery = 120', db.spentInCategoryThisMonth(CHAT, 'delivery') === 120);
check('listLimits tem 1 item', db.listLimits(CHAT).length === 1);

// Metas
const gid = db.addGoal(CHAT, 'Reserva', 10000);
db.addToGoal(CHAT, gid, 500);
const goals = db.listGoals(CHAT);
check('meta criada com saved=500', goals.length === 1 && goals[0].saved === 500);

// Exportação
check('allTransactions retorna 3, mais antiga primeiro', db.allTransactions(CHAT).length === 3 && db.allTransactions(CHAT)[0].id === 1);

// Apagar
const last = db.lastTransaction(CHAT);
check('lastTransaction é a de mercado', last.category_id === 'mercado');
db.deleteTransaction(last.id, CHAT);
check('após apagar, saldo volta a 4880', db.balance(CHAT).balance === 4880);

// Isolamento entre usuários
db.addTransaction(888, { kind: 'expense', amount: 999, category: { id: 'outros', name: 'Outros', emoji: '📦' } });
check('usuário 888 não afeta saldo do 999', db.balance(CHAT).balance === 4880);
check('usuário 888 tem saldo próprio -999', db.balance(888).balance === -999);

// PERSISTÊNCIA: força gravação, limpa o módulo do cache e recarrega do disco
db.flush();
check('arquivo JSON foi criado no disco', fs.existsSync(TMP));
delete require.cache[require.resolve('./src/db')];
const db2 = require('./src/db');
check('após recarregar do disco: saldo 999 ainda é 4880', db2.balance(CHAT).balance === 4880);
check('após recarregar: meta Reserva ainda existe', db2.listGoals(CHAT).length === 1);
check('após recarregar: limite delivery ainda é 100', db2.getLimit(CHAT, 'delivery') === 100);

// Limpeza
try { fs.unlinkSync(TMP); } catch (_) {}

console.log(`\n=== RESULTADO: ${pass} passou, ${fail} falhou ===`);
process.exit(fail > 0 ? 1 : 0);
