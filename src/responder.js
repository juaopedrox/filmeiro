'use strict';

/**
 * responder.js — Transforma dados financeiros em mensagens de WhatsApp/Telegram
 * humanizadas, no tom definido pelas instruções: parceiro estratégico, claro,
 * sem economês, sem julgamento. Usa emojis com parcimônia e Markdown do Telegram.
 */

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
function fmt(n) { return BRL.format(n || 0); }

const PERIOD_LABEL = { hoje: 'hoje', semana: 'esta semana', mes: 'este mês' };

// ---------------------------------------------------------------------------
// Confirmação de lançamento (despesa/receita)
// ---------------------------------------------------------------------------
function confirmExpense(tx, balanceInfo, limitAlert) {
  const desc = tx.description ? ` (${tx.description})` : '';
  let msg = `${tx.emoji || '📦'} Anotado! *${fmt(tx.amount)}* em *${tx.category_name}*${desc}.\n`;
  msg += `💰 Saldo estimado: *${fmt(balanceInfo.balance)}*`;
  if (limitAlert) msg += `\n\n${limitAlert}`;
  return msg;
}

function confirmIncome(tx, balanceInfo) {
  const desc = tx.description ? ` (${tx.description})` : '';
  let msg = `${tx.emoji || '✨'} Boa! Entrada de *${fmt(tx.amount)}* em *${tx.category_name}*${desc}.\n`;
  msg += `💰 Saldo estimado: *${fmt(balanceInfo.balance)}*`;
  return msg;
}

// ---------------------------------------------------------------------------
// Alerta de limite de categoria (preventivo, sem bronca)
// ---------------------------------------------------------------------------
function limitAlert(categoryName, spent, cap) {
  if (!cap || cap <= 0) return null;
  const pct = Math.round((spent / cap) * 100);
  if (pct >= 100) {
    return `🔴 Heads up: você já passou do seu limite de *${categoryName}* este mês ` +
      `(${fmt(spent)} de ${fmt(cap)}). Nada de pânico — só pra você decidir os próximos gastos com isso em mente.`;
  }
  if (pct >= 80) {
    return `🟠 Atenção tranquila: você já usou *${pct}%* do seu limite de *${categoryName}* ` +
      `(${fmt(spent)} de ${fmt(cap)}). Dá pra segurar o resto do mês com folga se quiser.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Relatório de período (resumo descomplicado)
// ---------------------------------------------------------------------------
function report(summary) {
  const label = PERIOD_LABEL[summary.period] || 'este mês';
  if (summary.income === 0 && summary.expense === 0) {
    return `📊 Por enquanto não tem nenhum lançamento ${label}. ` +
      `Manda algo tipo _"gastei 30 no almoço"_ que eu já começo a organizar pra você. 😉`;
  }

  let msg = `📊 *Seu resumo de ${label}:*\n\n`;
  msg += `📥 Entrou: *${fmt(summary.income)}*\n`;
  msg += `📤 Saiu: *${fmt(summary.expense)}*\n`;
  const saving = summary.saving;
  const sIcon = saving >= 0 ? '🟢' : '🔴';
  const sWord = saving >= 0 ? 'Sobrou' : 'Ficou negativo em';
  msg += `${sIcon} ${sWord}: *${fmt(Math.abs(saving))}*\n`;

  if (summary.categories.length) {
    msg += `\n*Pra onde o dinheiro foi:*\n`;
    const top = summary.categories.slice(0, 6);
    const max = top[0].total || 1;
    for (const c of top) {
      const barLen = Math.max(1, Math.round((c.total / max) * 10));
      const bar = '▰'.repeat(barLen) + '▱'.repeat(10 - barLen);
      const pct = summary.expense > 0 ? Math.round((c.total / summary.expense) * 100) : 0;
      msg += `${c.emoji || '•'} ${c.category_name}: ${fmt(c.total)} _(${pct}%)_\n${bar}\n`;
    }
    // Insight humanizado sobre a maior categoria
    const top1 = summary.categories[0];
    const pct1 = summary.expense > 0 ? Math.round((top1.total / summary.expense) * 100) : 0;
    if (pct1 >= 40) {
      msg += `\n💡 *${top1.category_name}* puxou boa parte (${pct1}%) dos seus gastos ${label}. ` +
        `Se quiser sobrar mais no fim do mês, é o melhor lugar pra começar a olhar.`;
    } else if (saving >= 0 && summary.income > 0) {
      const rate = Math.round((saving / summary.income) * 100);
      msg += `\n💡 Você guardou *${rate}%* do que entrou ${label}. ${rate >= 20 ? 'Tá num ótimo ritmo! 🚀' : 'Dá pra apertar um pouquinho mais se quiser acelerar suas metas.'}`;
    }
  }
  return msg;
}

// ---------------------------------------------------------------------------
// Saldo
// ---------------------------------------------------------------------------
function balance(info) {
  let msg = `💰 *Seu saldo estimado: ${fmt(info.balance)}*\n\n`;
  msg += `📥 Total que entrou: ${fmt(info.income)}\n`;
  msg += `📤 Total que saiu: ${fmt(info.expense)}`;
  if (info.balance < 0) {
    msg += `\n\n🔴 Você está no vermelho no acumulado. Bora dar uma olhada nos gastos pra virar esse jogo?`;
  }
  return msg;
}

// ---------------------------------------------------------------------------
// Simulação de parcelamento (consulta preventiva)
// ---------------------------------------------------------------------------
function installmentAdvice(amount, installments, summary) {
  const parcela = amount / installments;
  let msg = `🧮 *Vamos fazer as contas desse parcelamento:*\n\n`;
  msg += `Valor total: *${fmt(amount)}*\n`;
  msg += `Em ${installments}x de *${fmt(parcela)}* por mês.\n\n`;

  // Quanto a parcela representa da sobra mensal
  const saving = summary.saving;
  if (saving > 0) {
    const pct = Math.round((parcela / saving) * 100);
    if (pct <= 15) {
      msg += `✅ Pelo seu mês atual, essa parcela é só *${pct}%* do que você costuma deixar sobrar (${fmt(saving)}). ` +
        `Cabe tranquilo no seu orçamento.`;
    } else if (pct <= 35) {
      msg += `🟡 Essa parcela come *${pct}%* da sua sobra mensal (${fmt(saving)}). ` +
        `Dá pra encaixar, mas vai apertar um pouco os outros planos. Vale só conferir se não tem nada mais urgente na frente.`;
    } else {
      msg += `🟠 Olha, essa parcela é *${pct}%* do que sobra pra você por mês (${fmt(saving)}). ` +
        `É um comprometimento grande e por bastante tempo (${installments} meses). ` +
        `Se não for essencial agora, talvez valha esperar ou juntar uma parte antes.`;
    }
  } else {
    msg += `🔴 Pelos seus números atuais, você não está conseguindo deixar sobra no mês. ` +
      `Assumir ${installments}x de ${fmt(parcela)} agora ia pesar de verdade no orçamento. ` +
      `Se der, vale segurar essa compra até o fluxo melhorar.`;
  }
  msg += `\n\n_Decisão é sempre sua — eu só te mostro o número real pra você escolher com clareza._`;
  return msg;
}

// ---------------------------------------------------------------------------
// Metas
// ---------------------------------------------------------------------------
function goalCreated(name, target) {
  return `🎯 Meta criada: *${name}* — alvo de *${fmt(target)}*.\n` +
    `Sempre que guardar uma parte, me avisa tipo _"guardei 200 na ${name}"_ que eu atualizo o progresso. 💪`;
}

function goalsList(goals) {
  if (!goals.length) {
    return `🎯 Você ainda não tem metas. Que tal criar uma? Manda algo como _"quero juntar 5000 pra reserva de emergência"_.`;
  }
  let msg = `🎯 *Suas metas:*\n\n`;
  for (const g of goals) {
    const pct = g.target > 0 ? Math.min(100, Math.round((g.saved / g.target) * 100)) : 0;
    const barLen = Math.round((pct / 100) * 10);
    const bar = '▰'.repeat(barLen) + '▱'.repeat(10 - barLen);
    msg += `*${g.name}*\n${bar} ${pct}%\n${fmt(g.saved)} de ${fmt(g.target)}\n\n`;
  }
  return msg.trim();
}

// ---------------------------------------------------------------------------
// Ajuda / boas-vindas
// ---------------------------------------------------------------------------
function welcome(name) {
  const hi = name ? `Oi, ${name}! ` : 'Oi! ';
  return `${hi}👋 Eu sou seu *assistente financeiro pessoal*. Comigo, controlar as contas é só conversar — sem planilha, sem app travado.\n\n` +
    `*Como funciona:*\n` +
    `💸 Pra registrar um gasto: _"gastei 120 no ifood"_\n` +
    `💰 Pra registrar uma entrada: _"recebi 2500 de um cliente"_\n` +
    `📊 Pra ver um resumo: _"quanto gastei essa semana?"_\n` +
    `💳 Pra simular uma compra: _"vale a pena parcelar 1200 em 12x?"_\n` +
    `🎯 Pra criar meta: _"quero juntar 5000 de reserva"_\n\n` +
    `É só mandar mensagem naturalmente que eu organizo o resto. Bora? 🚀`;
}

function help() {
  return `🤖 *O que eu sei fazer:*\n\n` +
    `• Registrar gastos e entradas (escreve naturalmente!)\n` +
    `• Categorizar tudo sozinho\n` +
    `• Mostrar pra onde seu dinheiro foi (_"resumo do mês"_)\n` +
    `• Avisar quando você se aproxima de um limite\n` +
    `• Simular se vale a pena parcelar algo\n` +
    `• Acompanhar suas metas\n` +
    `• Te dar o saldo na hora (_"qual meu saldo?"_)\n\n` +
    `*Comandos úteis:*\n` +
    `/resumo — resumo do mês\n` +
    `/saldo — seu saldo atual\n` +
    `/metas — suas metas\n` +
    `/limites — seus limites por categoria\n` +
    `/limite Delivery 400 — define limite mensal\n` +
    `/exportar — baixa seu histórico em CSV (Excel)\n` +
    `/apagar — apaga o último lançamento\n` +
    `/ajuda — mostra isto`;
}

function notUnderstood() {
  return `🤔 Não consegui entender isso direito. Tenta de um jeito mais simples, tipo:\n\n` +
    `_"gastei 50 no mercado"_\n_"recebi 800 de freela"_\n_"quanto gastei esse mês?"_\n\n` +
    `Ou manda /ajuda pra ver tudo que eu faço.`;
}

function deleted(tx) {
  if (!tx) return `Não achei nenhum lançamento recente pra apagar.`;
  return `🗑️ Apaguei o último lançamento: ${tx.emoji || ''} ${fmt(tx.amount)} em ${tx.category_name}.`;
}

module.exports = {
  fmt,
  confirmExpense, confirmIncome,
  limitAlert,
  report, balance,
  installmentAdvice,
  goalCreated, goalsList,
  welcome, help, notUnderstood, deleted,
};
