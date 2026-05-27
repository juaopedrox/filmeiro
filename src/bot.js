'use strict';

/**
 * bot.js — Ponto de entrada. Conecta o Telegram (via telegraf) com o cérebro
 * (parser), o banco (db) e as respostas (responder).
 *
 * Toda a interação é conversacional: o usuário escreve naturalmente e o bot
 * interpreta, registra e responde. Também há comandos /atalho pra ações diretas.
 *
 * 100% gratuito: usa a Bot API oficial do Telegram (sem custo) e SQLite local.
 */

const { Telegraf } = require('telegraf');
// Carrega variáveis do arquivo .env (se existir). Tolerante: se a lib não
// estiver instalada, segue usando as variáveis de ambiente do sistema.
try { require('dotenv').config(); } catch (_) { /* opcional */ }
const parser = require('./parser');
const db = require('./db');
const r = require('./responder');

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error('❌ Faltando BOT_TOKEN. Defina a variável de ambiente com o token do @BotFather.');
  process.exit(1);
}

const bot = new Telegraf(TOKEN);

// Mapa de categorias por nome (pra comando /limite Delivery 400)
const CAT_BY_NAME = {};
for (const c of parser.CATEGORIES) CAT_BY_NAME[c.name.toLowerCase()] = c;

// ---------------------------------------------------------------------------
// Middleware: registra/atualiza o usuário a cada mensagem
// ---------------------------------------------------------------------------
bot.use((ctx, next) => {
  if (ctx.chat && ctx.from) {
    db.touchUser(ctx.chat.id, ctx.from.first_name || ctx.from.username);
  }
  return next();
});

// ---------------------------------------------------------------------------
// Comandos
// ---------------------------------------------------------------------------
bot.start((ctx) => ctx.replyWithMarkdown(r.welcome(ctx.from.first_name)));
bot.help((ctx) => ctx.replyWithMarkdown(r.help()));
bot.command('ajuda', (ctx) => ctx.replyWithMarkdown(r.help()));

bot.command('resumo', (ctx) => {
  const s = db.summary(ctx.chat.id, 'mes');
  ctx.replyWithMarkdown(r.report(s));
});

bot.command('saldo', (ctx) => {
  ctx.replyWithMarkdown(r.balance(db.balance(ctx.chat.id)));
});

bot.command('metas', (ctx) => {
  ctx.replyWithMarkdown(r.goalsList(db.listGoals(ctx.chat.id)));
});

bot.command('limites', (ctx) => {
  const limits = db.listLimits(ctx.chat.id);
  if (!limits.length) {
    return ctx.replyWithMarkdown(
      `Você ainda não definiu limites. Pra criar um, manda assim:\n_/limite Delivery 400_`);
  }
  let msg = '🚧 *Seus limites mensais:*\n\n';
  for (const l of limits) {
    const cat = parser.CATEGORIES.find(c => c.id === l.category_id);
    const spent = db.spentInCategoryThisMonth(ctx.chat.id, l.category_id);
    const pct = Math.round((spent / l.monthly_cap) * 100);
    msg += `${cat ? cat.emoji : '•'} ${cat ? cat.name : l.category_id}: ${r.fmt(spent)} / ${r.fmt(l.monthly_cap)} (${pct}%)\n`;
  }
  ctx.replyWithMarkdown(msg);
});

bot.command('limite', (ctx) => {
  // formato: /limite Delivery 400
  const parts = ctx.message.text.split(/\s+/).slice(1);
  if (parts.length < 2) {
    return ctx.replyWithMarkdown(`Use assim: _/limite Delivery 400_ (categoria e valor mensal).`);
  }
  const valueRaw = parts[parts.length - 1];
  const catName = parts.slice(0, -1).join(' ').toLowerCase();
  const value = parser.normalizeNumber(valueRaw);
  const cat = CAT_BY_NAME[catName];
  if (!cat) {
    const names = parser.CATEGORIES.map(c => c.name).join(', ');
    return ctx.replyWithMarkdown(`Não reconheci a categoria "*${catName}*". As que existem são:\n${names}`);
  }
  if (!value || value <= 0) {
    return ctx.replyWithMarkdown(`Valor inválido. Tenta tipo _/limite ${cat.name} 400_.`);
  }
  db.setLimit(ctx.chat.id, cat.id, value);
  ctx.replyWithMarkdown(`✅ Limite de *${cat.name}* definido em *${r.fmt(value)}* por mês. Eu te aviso quando você chegar perto. 👍`);
});

bot.command('apagar', (ctx) => {
  const last = db.lastTransaction(ctx.chat.id);
  if (last) db.deleteTransaction(last.id, ctx.chat.id);
  ctx.replyWithMarkdown(r.deleted(last));
});

bot.command('exportar', async (ctx) => {
  const rows = db.allTransactions(ctx.chat.id);
  if (!rows.length) {
    return ctx.replyWithMarkdown('Você ainda não tem lançamentos pra exportar. Manda alguns gastos primeiro! 😉');
  }
  // Monta um CSV (abre no Excel / Google Sheets). Escapa aspas e separa por vírgula.
  const esc = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = ['Data', 'Tipo', 'Valor', 'Categoria', 'Descrição'];
  const lines = [header.join(',')];
  for (const t of rows) {
    const data = new Date(t.created_at).toLocaleString('pt-BR');
    const tipo = t.type === 'income' ? 'Entrada' : 'Saída';
    lines.push([esc(data), esc(tipo), esc(t.amount.toFixed(2).replace('.', ',')),
      esc(t.category_name), esc(t.description || '')].join(','));
  }
  const csv = '\uFEFF' + lines.join('\n'); // BOM pra acento abrir certo no Excel
  const stamp = new Date().toISOString().slice(0, 10);
  await ctx.replyWithDocument({
    source: Buffer.from(csv, 'utf8'),
    filename: `financas-${stamp}.csv`,
  }, { caption: '📄 Aqui está o seu histórico completo! Abre no Excel ou Google Sheets.' });
});

// ---------------------------------------------------------------------------
// Mensagens de texto livres (o coração do bot)
// ---------------------------------------------------------------------------
bot.on('text', (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return; // comando não reconhecido, ignora
  const chatId = ctx.chat.id;
  const intent = parser.interpret(text);

  switch (intent.kind) {
    case 'expense': {
      const tx = db.addTransaction(chatId, intent);
      const bal = db.balance(chatId);
      // checa limite da categoria
      const cap = db.getLimit(chatId, intent.category.id);
      let alert = null;
      if (cap) {
        const spent = db.spentInCategoryThisMonth(chatId, intent.category.id);
        alert = r.limitAlert(intent.category.name, spent, cap);
      }
      return ctx.replyWithMarkdown(r.confirmExpense(tx, bal, alert));
    }

    case 'income': {
      const tx = db.addTransaction(chatId, intent);
      const bal = db.balance(chatId);
      return ctx.replyWithMarkdown(r.confirmIncome(tx, bal));
    }

    case 'report': {
      const s = db.summary(chatId, intent.period);
      return ctx.replyWithMarkdown(r.report(s));
    }

    case 'balance': {
      return ctx.replyWithMarkdown(r.balance(db.balance(chatId)));
    }

    case 'installment_query': {
      const s = db.summary(chatId, 'mes');
      return ctx.replyWithMarkdown(r.installmentAdvice(intent.amount, intent.installments, s));
    }

    case 'goal_set': {
      const name = intent.description || 'Minha meta';
      db.addGoal(chatId, name, intent.amount);
      return ctx.replyWithMarkdown(r.goalCreated(name, intent.amount));
    }

    default:
      return ctx.replyWithMarkdown(r.notUnderstood());
  }
});

// Mensagens não-texto (foto, documento, áudio) — explica a limitação com gentileza
bot.on(['photo', 'document'], (ctx) => {
  ctx.replyWithMarkdown(
    `📎 Recebi seu arquivo, mas nesta versão eu trabalho só com *texto* (pra ser 100% gratuito).\n\n` +
    `É só me contar em palavras, tipo _"gastei 80 no mercado"_, que eu registro na hora! 😉`);
});

// ---------------------------------------------------------------------------
// Inicialização: long polling (não precisa de servidor web/HTTPS configurado)
// ---------------------------------------------------------------------------

// Mini servidor HTTP de "health check". Muitas hospedagens gratuitas (Render,
// Railway no modo web) exigem que o app responda numa porta, senão encerram o
// processo achando que travou. Isto mantém o bot vivo 24/7.
const http = require('http');
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Bot financeiro online 🤖');
}).listen(PORT, () => console.log(`🌐 Health check ouvindo na porta ${PORT}`));

bot.launch().then(() => {
  console.log('🤖 Bot financeiro no ar! Aguardando mensagens...');
}).catch((err) => {
  console.error('❌ Falha ao iniciar o bot:', err.message);
  process.exit(1);
});

// Encerramento limpo
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
