'use strict';

/**
 * parser.js — O "cérebro" de interpretação de linguagem natural em PT-BR.
 *
 * Não usa IA paga: usa regras inteligentes (regex + dicionários de palavras-chave)
 * para entender mensagens naturais como:
 *   "gastei 120 no ifood"          -> despesa, R$120, categoria Delivery
 *   "recebi 2500 de um cliente"    -> receita, R$2500, categoria Trabalho
 *   "paguei 89,90 de uber"         -> despesa, R$89,90, categoria Transporte
 *   "quanto gastei essa semana?"   -> consulta de relatório semanal
 *   "faz sentido parcelar 1200 em 12x?" -> simulação de parcelamento
 *
 * Tudo é exportado em funções puras para facilitar os testes.
 */

// ---------------------------------------------------------------------------
// 1. Categorias e suas palavras-chave (o coração da categorização automática)
// ---------------------------------------------------------------------------
// Cada categoria tem um conjunto de gatilhos. A ordem importa: categorias mais
// específicas (Delivery) vêm antes de mais genéricas (Alimentação) para que
// "ifood" não caia em "comida" genérico.

const CATEGORIES = [
  {
    id: 'delivery', name: 'Delivery', emoji: '🛵',
    keywords: ['ifood', 'i food', 'rappi', 'uber eats', 'ubereats', 'delivery',
      'james', 'aiqfome', 'aiq fome', 'entrega de comida', 'pedi comida', 'pedi um lanche']
  },
  {
    id: 'transporte', name: 'Transporte', emoji: '🚗',
    keywords: ['uber', '99', 'noventa e nove', 'taxi', 'táxi', 'gasolina', 'combustivel',
      'combustível', 'posto', 'alcool', 'álcool', 'etanol', 'diesel', 'onibus', 'ônibus',
      'metro', 'metrô', 'passagem', 'bilhete unico', 'bilhete único', 'estacionamento',
      'pedagio', 'pedágio', 'brt', 'vlt', 'bina', 'indriver', 'indrive']
  },
  {
    id: 'mercado', name: 'Mercado', emoji: '🛒',
    keywords: ['mercado', 'supermercado', 'mercadinho', 'feira', 'hortifruti', 'sacolao',
      'sacolão', 'atacadao', 'atacadão', 'assai', 'assaí', 'carrefour', 'pao de acucar',
      'pão de açúcar', 'compras do mes', 'compras do mês', 'compra do mes', 'açougue',
      'acougue', 'padaria', 'quitanda']
  },
  {
    id: 'alimentacao', name: 'Alimentação', emoji: '🍽️',
    keywords: ['restaurante', 'almoço', 'almoco', 'janta', 'jantar', 'lanche', 'cafe',
      'café', 'cafeteria', 'bar', 'boteco', 'churrasco', 'pizza', 'hamburguer',
      'hambúrguer', 'comida', 'rango', 'marmita', 'self service', 'rodizio', 'rodízio',
      'sorvete', 'doceria', 'confeitaria', 'happy hour']
  },
  {
    id: 'mercado_livre', name: 'Compras', emoji: '🛍️',
    keywords: ['mercado livre', 'mercadolivre', 'amazon', 'shopee', 'aliexpress', 'shein',
      'magalu', 'magazine', 'americanas', 'comprei', 'roupa', 'roupas', 'tenis', 'tênis',
      'sapato', 'eletronico', 'eletrônico', 'celular', 'notebook', 'fone', 'presente',
      'shopping', 'loja']
  },
  {
    id: 'lazer', name: 'Lazer', emoji: '🎉',
    keywords: ['cinema', 'show', 'festa', 'balada', 'viagem', 'passeio', 'parque',
      'ingresso', 'jogo', 'game', 'steam', 'playstation', 'xbox', 'role', 'rolê',
      'bebida', 'cerveja', 'drinks', 'netflix', 'spotify', 'disney', 'hbo', 'prime video',
      'streaming', 'assinatura']
  },
  {
    id: 'saude', name: 'Saúde', emoji: '💊',
    keywords: ['farmacia', 'farmácia', 'remedio', 'remédio', 'medico', 'médico', 'consulta',
      'dentista', 'exame', 'plano de saude', 'plano de saúde', 'academia', 'psicologo',
      'psicólogo', 'terapia', 'hospital', 'laboratorio', 'laboratório', 'vacina',
      'suplemento', 'whey']
  },
  {
    id: 'casa', name: 'Casa', emoji: '🏠',
    keywords: ['aluguel', 'condominio', 'condomínio', 'luz', 'energia', 'agua', 'água',
      'internet', 'wifi', 'gas', 'gás', 'iptu', 'faxina', 'diarista', 'movel', 'móvel',
      'moveis', 'móveis', 'reforma', 'conserto', 'eletricista', 'encanador']
  },
  {
    id: 'contas', name: 'Contas & Serviços', emoji: '📄',
    keywords: ['conta de telefone', 'telefone', 'celular plano', 'plano de celular',
      'fatura', 'boleto', 'mensalidade', 'seguro', 'cartao', 'cartão', 'anuidade',
      'imposto', 'taxa', 'tarifa', 'assinatura mensal']
  },
  {
    id: 'educacao', name: 'Educação', emoji: '📚',
    keywords: ['curso', 'faculdade', 'escola', 'livro', 'livros', 'mensalidade escolar',
      'material escolar', 'aula', 'professor particular', 'ingles', 'inglês', 'udemy',
      'alura', 'matricula', 'matrícula']
  },
  {
    id: 'dividas', name: 'Dívidas', emoji: '💳',
    keywords: ['divida', 'dívida', 'emprestimo', 'empréstimo', 'financiamento', 'parcela',
      'prestacao', 'prestação', 'cartao de credito', 'cartão de crédito', 'fatura do cartao',
      'fatura do cartão', 'juros', 'cheque especial', 'fgts', 'consignado', 'agiota']
  },
  {
    id: 'pets', name: 'Pets', emoji: '🐾',
    keywords: ['pet', 'cachorro', 'gato', 'racao', 'ração', 'veterinario', 'veterinário',
      'petshop', 'pet shop', 'banho e tosa', 'tosa']
  },
];

// Categorias de RECEITA (entradas de dinheiro)
const INCOME_CATEGORIES = [
  {
    id: 'salario', name: 'Salário', emoji: '💼',
    keywords: ['salario', 'salário', 'pagamento', 'pago', 'holerite', 'contracheque']
  },
  {
    id: 'trabalho', name: 'Trabalho / Freela', emoji: '💰',
    keywords: ['cliente', 'freela', 'freelance', 'projeto', 'job', 'servico', 'serviço',
      'trabalho', 'pix de', 'recebi de', 'venda', 'vendi', 'comissao', 'comissão',
      'honorario', 'honorário', 'nota fiscal', 'nf']
  },
  {
    id: 'investimentos_rec', name: 'Rendimentos', emoji: '📈',
    keywords: ['rendimento', 'dividendo', 'dividendos', 'juros recebidos', 'lucro',
      'resgate', 'cdb', 'tesouro']
  },
  {
    id: 'outros_rec', name: 'Outras Entradas', emoji: '✨',
    keywords: ['presente', 'devolucao', 'devolução', 'reembolso', 'estorno', 'cashback',
      'premio', 'prêmio', 'restituicao', 'restituição', 'aluguel recebido', 'mesada']
  },
];

const FALLBACK_EXPENSE = { id: 'outros', name: 'Outros', emoji: '📦' };
const FALLBACK_INCOME = { id: 'outros_rec', name: 'Outras Entradas', emoji: '✨' };

// ---------------------------------------------------------------------------
// 2. Detecção de intenção (a mensagem é gasto? receita? consulta? meta?)
// ---------------------------------------------------------------------------

const INCOME_VERBS = ['recebi', 'ganhei', 'entrou', 'caiu', 'me pagaram', 'me pagou',
  'recebimento', 'recebido', 'vendi', 'faturei', 'embolsei'];

const EXPENSE_VERBS = ['gastei', 'paguei', 'comprei', 'torrei', 'gasto', 'pago', 'compra',
  'saiu', 'debitou', 'debitei', 'investi', 'desembolsei', 'custou', 'fica', 'ficou'];

// Palavras que indicam que o usuário quer um RELATÓRIO / CONSULTA, não um lançamento
const REPORT_TRIGGERS = ['quanto', 'resumo', 'relatorio', 'relatório', 'extrato', 'gastei',
  'onde', 'como estou', 'como ta', 'como tá', 'como estao', 'como estão', 'saldo',
  'balanço', 'balanco', 'fluxo', 'situacao', 'situação'];

const PERIOD_WORDS = {
  hoje: 'hoje',
  ontem: 'ontem',
  semana: 'semana',
  'essa semana': 'semana',
  'esta semana': 'semana',
  'na semana': 'semana',
  mes: 'mes',
  mês: 'mes',
  'esse mes': 'mes',
  'esse mês': 'mes',
  'este mes': 'mes',
  'este mês': 'mes',
  'no mes': 'mes',
  'do mes': 'mes',
};

// ---------------------------------------------------------------------------
// 3. Extração de valor monetário
// ---------------------------------------------------------------------------

/**
 * Extrai um valor em reais de um texto livre.
 * Lida com: "120", "R$120", "120,50", "1.200,00", "1200.50", "120 reais", "120 pila", "1,2k", "2 mil"
 * Retorna Number ou null se não achar.
 */
function extractAmount(text) {
  const t = ' ' + text.toLowerCase().replace(/r\$\s*/g, ' ') + ' ';

  // Caso "2 mil", "1,5 mil", "3 milhões"
  const milMatch = t.match(/(\d+(?:[.,]\d+)?)\s*(mil|milh[oõ]es?|milhao|milhão|k\b)/);
  if (milMatch) {
    let base = parseFloat(milMatch[1].replace('.', '').replace(',', '.'));
    const unit = milMatch[2];
    if (/mil|k/.test(unit)) base *= 1000;
    else if (/milh/.test(unit)) base *= 1000000;
    if (!isNaN(base) && base > 0) return round2(base);
  }

  // Procura todos os números "soltos" e escolhe o mais provável (o maior costuma ser o valor)
  // Formatos: 1.200,00 | 1200,00 | 1200.00 | 1200 | 120,5
  const numRegex = /(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})|\d+(?:\.\d{1,2})?|\d+)/g;
  const candidates = [];
  let m;
  while ((m = numRegex.exec(t)) !== null) {
    const raw = m[1];
    // Ignora números que claramente são "12x" (parcelas) — tratado em outro lugar
    const after = t.slice(m.index + raw.length, m.index + raw.length + 2);
    if (/^x/i.test(after.trim())) continue;
    const val = normalizeNumber(raw);
    if (val !== null && val > 0) candidates.push(val);
  }
  if (candidates.length === 0) return null;
  // Heurística: pega o maior valor encontrado (evita pegar "12x" ou datas pequenas)
  return round2(Math.max(...candidates));
}

function normalizeNumber(raw) {
  let s = raw.trim();
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // 1.200,00 -> ponto é milhar, vírgula é decimal
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    // 120,50 -> vírgula é decimal
    s = s.replace(',', '.');
  } else if (hasDot) {
    // pode ser 1.200 (milhar) ou 120.50 (decimal). Se tiver exatamente 3 dígitos depois
    // do ponto, tratamos como milhar; senão como decimal.
    const parts = s.split('.');
    if (parts.length === 2 && parts[1].length === 3) s = parts.join('');
    // senão deixa como está (decimal)
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function round2(n) { return Math.round(n * 100) / 100; }

// ---------------------------------------------------------------------------
// 4. Categorização
// ---------------------------------------------------------------------------

function categorize(text, type) {
  const t = normalizeText(text);
  const list = type === 'income' ? INCOME_CATEGORIES : CATEGORIES;
  let best = null;
  let bestLen = 0;
  for (const cat of list) {
    for (const kw of cat.keywords) {
      if (t.includes(kw) && kw.length > bestLen) {
        best = cat;
        bestLen = kw.length;
      }
    }
  }
  if (best) return { id: best.id, name: best.name, emoji: best.emoji };
  return type === 'income' ? { ...FALLBACK_INCOME } : { ...FALLBACK_EXPENSE };
}

function normalizeText(text) {
  return ' ' + text.toLowerCase().trim() + ' ';
}

// ---------------------------------------------------------------------------
// 5. Detecção de parcelamento ("12x", "em 12 vezes")
// ---------------------------------------------------------------------------

function extractInstallments(text) {
  const t = text.toLowerCase();
  const m = t.match(/(\d{1,2})\s*x\b/) || t.match(/em\s+(\d{1,2})\s*(?:vezes|parcelas|x)/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 2 && n <= 60) return n;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 6. Função principal de interpretação
// ---------------------------------------------------------------------------

/**
 * Interpreta uma mensagem e retorna um objeto de intenção:
 *  { kind: 'expense'|'income', amount, category, description }
 *  { kind: 'report', period }
 *  { kind: 'installment_query', amount, installments }
 *  { kind: 'goal_set', amount, description }
 *  { kind: 'balance' }
 *  { kind: 'unknown' }
 */
function interpret(rawText) {
  const text = (rawText || '').trim();
  const lower = normalizeText(text);

  if (!text) return { kind: 'unknown' };

  // --- Consulta de parcelamento ("faz sentido parcelar X em Yx?") ---
  const installments = extractInstallments(text);
  const mentionsParcelar = /parcel|vezes|\bem\s+\d+\s*x|faz sentido|vale a pena|devo (comprar|parcelar)/i.test(text);
  if (installments && (mentionsParcelar || /\?/.test(text))) {
    const amount = extractAmount(text);
    if (amount) {
      return { kind: 'installment_query', amount, installments };
    }
  }

  // --- Definição de meta ("quero juntar 5000 pra reserva", "meta de 10 mil") ---
  if (/\bmeta\b|juntar|poupar|guardar|economizar|reserva de emerg/i.test(lower)) {
    const amount = extractAmount(text);
    if (amount) {
      return { kind: 'goal_set', amount, description: cleanDescription(text) };
    }
  }

  // --- Consulta de saldo ---
  if (/\bsaldo\b|quanto (eu )?tenho|quanto sobrou|quanto me resta/i.test(lower)) {
    return { kind: 'balance' };
  }

  // --- Relatório / consulta ("quanto gastei essa semana", "resumo do mês", "onde gastei mais") ---
  const isQuestion = /\?/.test(text) || /^(quanto|onde|como|qual|resumo|relat)/i.test(text.trim());
  const hasReportTrigger = REPORT_TRIGGERS.some(w => lower.includes(' ' + w + ' ') || lower.includes(' ' + w + '?'));
  const hasAmount = extractAmount(text) !== null;
  // Se parece pergunta E menciona relatório/gasto E não tem um valor claro de lançamento → é consulta
  if ((isQuestion && hasReportTrigger) || (hasReportTrigger && !hasAmount && !hasExpenseVerb(lower) && !hasIncomeVerb(lower))) {
    return { kind: 'report', period: detectPeriod(lower) };
  }

  // --- Lançamento de receita ou despesa ---
  const amount = extractAmount(text);
  if (amount !== null && amount > 0) {
    const incomeScore = hasIncomeVerb(lower) ? 1 : 0;
    const expenseScore = hasExpenseVerb(lower) ? 1 : 0;
    // desempate: se menciona "cliente/freela/salário" puxa pra receita
    const incomeHint = INCOME_CATEGORIES.some(c => c.keywords.some(k => lower.includes(k)));

    let type;
    if (incomeScore > expenseScore) type = 'income';
    else if (expenseScore > incomeScore) type = 'expense';
    else if (incomeHint) type = 'income';
    else type = 'expense'; // padrão: a maioria das mensagens são gastos

    const category = categorize(text, type);
    return {
      kind: type,
      amount,
      category,
      description: cleanDescription(text),
    };
  }

  return { kind: 'unknown' };
}

function hasIncomeVerb(lower) {
  return INCOME_VERBS.some(v => lower.includes(' ' + v + ' ') || lower.includes(' ' + v));
}
function hasExpenseVerb(lower) {
  return EXPENSE_VERBS.some(v => lower.includes(' ' + v + ' ') || lower.includes(' ' + v));
}

function detectPeriod(lower) {
  for (const [word, period] of Object.entries(PERIOD_WORDS)) {
    if (lower.includes(word)) return period;
  }
  return 'mes'; // padrão: mês atual
}

/**
 * Limpa a mensagem pra virar uma "descrição" curta e legível.
 * Remove verbos de gasto, valores e palavras de ligação.
 */
function cleanDescription(text) {
  let d = text
    .replace(/r\$\s*/gi, '')
    .replace(/\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?/g, '')
    .replace(/\b(gastei|paguei|comprei|torrei|recebi|ganhei|de|no|na|com|um|uma|uns|umas|reais|pila|conto|contos|hoje|ontem|agora|mil|k)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!d) return null;
  // Capitaliza a primeira letra
  return d.charAt(0).toUpperCase() + d.slice(1);
}

module.exports = {
  interpret,
  extractAmount,
  categorize,
  extractInstallments,
  cleanDescription,
  normalizeNumber,
  CATEGORIES,
  INCOME_CATEGORIES,
};
