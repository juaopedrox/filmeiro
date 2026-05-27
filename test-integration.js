'use strict';
/**
 * test-integration.js — Simula uma conversa real de ponta a ponta.
 * Usa um shim de banco em memória com a MESMA API pública do src/db.js, para
 * isolar e testar puramente a lógica de parsing + respostas + fluxo de conversa.
 * (A persistência real em JSON é validada separadamente em test-db-real.js.)
 */

const parser = require('./src/parser');
const r = require('./src/responder');

// ---- Shim de banco em memória (mesma API pública do src/db.js) ----
function makeDB() {
  let txs = [], goals = [], limits = {}, idc = 1, gidc = 1;
  const round2 = n => Math.round((n || 0) * 100) / 100;
  const startOfMonth = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const startOfWeek = () => { const d=new Date(); d.setHours(0,0,0,0); const day=(d.getDay()+6)%7; d.setDate(d.getDate()-day); return d.toISOString(); };
  const startOfToday = () => { const d=new Date(); d.setHours(0,0,0,0); return d.toISOString(); };
  const pstart = p => p==='hoje'?startOfToday():p==='semana'?startOfWeek():startOfMonth();
  return {
    touchUser(){},
    addTransaction(chatId, tx) {
      const row = { id: idc++, chat_id:String(chatId), type:(tx.type||tx.kind), amount:tx.amount,
        category_id:tx.category.id, category_name:tx.category.name, emoji:tx.category.emoji||'',
        description:tx.description||null, created_at:new Date().toISOString() };
      txs.push(row); return row;
    },
    balance(chatId) {
      let income=0, expense=0;
      txs.filter(t=>t.chat_id===String(chatId)).forEach(t=>{ if(t.type==='income') income+=t.amount; else expense+=t.amount; });
      return { income:round2(income), expense:round2(expense), balance:round2(income-expense) };
    },
    summary(chatId, period) {
      const start = pstart(period);
      const sel = txs.filter(t=>t.chat_id===String(chatId) && t.created_at>=start);
      let income=0, expense=0; const byCat={};
      sel.forEach(t=>{ if(t.type==='income') income+=t.amount; else { expense+=t.amount;
        if(!byCat[t.category_id]) byCat[t.category_id]={category_id:t.category_id,category_name:t.category_name,emoji:t.emoji,total:0,n:0};
        byCat[t.category_id].total+=t.amount; byCat[t.category_id].n++; }});
      const categories = Object.values(byCat).map(c=>({...c,total:round2(c.total)})).sort((a,b)=>b.total-a.total);
      return { period, income:round2(income), expense:round2(expense), saving:round2(income-expense), categories };
    },
    spentInCategoryThisMonth(chatId, catId) {
      const start = startOfMonth();
      return round2(txs.filter(t=>t.chat_id===String(chatId)&&t.type==='expense'&&t.category_id===catId&&t.created_at>=start)
        .reduce((s,t)=>s+t.amount,0));
    },
    getLimit(chatId, catId){ return limits[String(chatId)+':'+catId] ?? null; },
    setLimit(chatId, catId, cap){ limits[String(chatId)+':'+catId]=cap; },
    listLimits(chatId){ return Object.entries(limits).filter(([k])=>k.startsWith(String(chatId)+':')).map(([k,v])=>({category_id:k.split(':')[1],monthly_cap:v})); },
    lastTransaction(chatId){ const f=txs.filter(t=>t.chat_id===String(chatId)); return f[f.length-1]||null; },
    deleteTransaction(id, chatId){ const i=txs.findIndex(t=>t.id===id&&t.chat_id===String(chatId)); if(i>=0){txs.splice(i,1);return true;} return false; },
    addGoal(chatId,name,target){ const g={id:gidc++,chat_id:String(chatId),name,target,saved:0}; goals.push(g); return g.id; },
    listGoals(chatId){ return goals.filter(g=>g.chat_id===String(chatId)); },
    addToGoal(chatId,gid,amt){ const g=goals.find(x=>x.id===gid&&x.chat_id===String(chatId)); if(g){g.saved+=amt;return true;} return false; },
  };
}

// ---- Simulador de uma "conversa": passa o texto pelo mesmo fluxo do bot.js ----
function handle(db, chatId, text) {
  const intent = parser.interpret(text);
  switch (intent.kind) {
    case 'expense': {
      const tx = db.addTransaction(chatId, intent);
      const bal = db.balance(chatId);
      const cap = db.getLimit(chatId, intent.category.id);
      let alert = null;
      if (cap) alert = r.limitAlert(intent.category.name, db.spentInCategoryThisMonth(chatId, intent.category.id), cap);
      return r.confirmExpense(tx, bal, alert);
    }
    case 'income': { const tx=db.addTransaction(chatId,intent); return r.confirmIncome(tx, db.balance(chatId)); }
    case 'report': return r.report(db.summary(chatId, intent.period));
    case 'balance': return r.balance(db.balance(chatId));
    case 'installment_query': return r.installmentAdvice(intent.amount, intent.installments, db.summary(chatId,'mes'));
    case 'goal_set': { const n=intent.description||'Minha meta'; db.addGoal(chatId,n,intent.amount); return r.goalCreated(n,intent.amount); }
    default: return r.notUnderstood();
  }
}

// ---- Roteiro de conversa ----
let pass=0, fail=0;
function expect(label, output, cond) {
  const ok = cond(output);
  console.log(`${ok?'✓':'✗'} ${label}`);
  if (!ok) { console.log('   --- saída: ---\n   ' + output.replace(/\n/g,'\n   ')); fail++; } else pass++;
}

const db = makeDB();
const CHAT = 12345;

console.log('=== CONVERSA SIMULADA ===\n');

let out;
out = handle(db, CHAT, 'recebi 5000 de salário');
console.log('👤 recebi 5000 de salário\n🤖 ' + out + '\n');
expect('receita registrada + saldo 5000', out, o => /5\.000,00/.test(o) && /Saldo estimado/.test(o));

out = handle(db, CHAT, 'gastei 120 no ifood');
console.log('👤 gastei 120 no ifood\n🤖 ' + out + '\n');
expect('despesa delivery + saldo 4880', out, o => /120,00/.test(o) && /Delivery/.test(o) && /4\.880,00/.test(o));

out = handle(db, CHAT, 'paguei 350 no mercado');
console.log('👤 paguei 350 no mercado\n🤖 ' + out + '\n');
expect('despesa mercado', out, o => /Mercado/.test(o) && /350,00/.test(o));

// define limite e estoura
out = (db.setLimit(CHAT, 'delivery', 200), 'ok');
out = handle(db, CHAT, 'gastei 150 de ifood de novo');
console.log('👤 gastei 150 de ifood de novo (limite delivery = 200)\n🤖 ' + out + '\n');
expect('alerta de limite estourado (270 de 200)', out, o => /limite/i.test(o) && /Delivery/.test(o));

out = handle(db, CHAT, 'quanto gastei esse mês?');
console.log('👤 quanto gastei esse mês?\n🤖 ' + out + '\n');
expect('relatório mensal com categorias', out, o => /resumo/i.test(o) && /Delivery/.test(o) && /Mercado/.test(o));

out = handle(db, CHAT, 'qual meu saldo?');
console.log('👤 qual meu saldo?\n🤖 ' + out + '\n');
expect('saldo correto (5000 - 620 = 4380)', out, o => /4\.380,00/.test(o));

out = handle(db, CHAT, 'vale a pena parcelar um notebook de 3600 em 12x?');
console.log('👤 vale a pena parcelar um notebook de 3600 em 12x?\n🤖 ' + out + '\n');
expect('simulação 12x de 300', out, o => /300,00/.test(o) && /12x/.test(o));

out = handle(db, CHAT, 'quero juntar 10 mil de reserva de emergência');
console.log('👤 quero juntar 10 mil de reserva de emergência\n🤖 ' + out + '\n');
expect('meta criada de 10000', out, o => /Meta criada/i.test(o) && /10\.000,00/.test(o));

out = handle(db, CHAT, 'asdfghjkl');
console.log('👤 asdfghjkl\n🤖 ' + out + '\n');
expect('mensagem incompreensível tratada', out, o => /não consegui entender|ajuda/i.test(o));

// Verifica que não vaza NaN/undefined em nenhuma resposta
const allOutputs = [
  handle(db, CHAT, 'recebi 2 mil de freela'),
  handle(db, CHAT, 'gastei 45,90 na farmacia'),
  handle(db, CHAT, 'resumo da semana'),
  handle(db, CHAT, 'quanto gastei hoje'),
  r.welcome('João'), r.help(),
];
expect('nenhuma resposta com NaN/undefined', allOutputs.join('|'), o => !/NaN|undefined/.test(o));

console.log(`\n=== RESULTADO: ${pass} passou, ${fail} falhou ===`);
process.exit(fail>0?1:0);
