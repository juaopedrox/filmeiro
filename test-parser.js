'use strict';
const p = require('./src/parser');

let pass = 0, fail = 0;
function check(label, got, expectFn) {
  const ok = expectFn(got);
  console.log(`  ${ok ? '✓' : '✗'} ${label}` + (ok ? '' : `  → got: ${JSON.stringify(got)}`));
  ok ? pass++ : fail++;
}

console.log('=== EXTRACT AMOUNT ===');
check('"120"', p.extractAmount('gastei 120 no ifood'), v => v === 120);
check('"R$120"', p.extractAmount('paguei R$120'), v => v === 120);
check('"89,90"', p.extractAmount('uber 89,90'), v => v === 89.9);
check('"1.200,00"', p.extractAmount('aluguel 1.200,00'), v => v === 1200);
check('"1200.50"', p.extractAmount('comprei por 1200.50'), v => v === 1200.5);
check('"2 mil"', p.extractAmount('recebi 2 mil de cliente'), v => v === 2000);
check('"1,5 mil"', p.extractAmount('vendi por 1,5 mil'), v => v === 1500);
check('"50 pila"', p.extractAmount('torrei 50 pila'), v => v === 50);
check('"3500"', p.extractAmount('salario 3500'), v => v === 3500);
check('sem número', p.extractAmount('quanto gastei essa semana'), v => v === null);
check('não pega 12x', p.extractAmount('celular 1200 em 12x'), v => v === 1200);

console.log('\n=== INTERPRET: DESPESAS ===');
check('gastei 120 ifood → delivery', p.interpret('gastei 120 no ifood'),
  r => r.kind==='expense' && r.amount===120 && r.category.id==='delivery');
check('paguei 89,90 uber → transporte', p.interpret('paguei 89,90 de uber'),
  r => r.kind==='expense' && r.amount===89.9 && r.category.id==='transporte');
check('mercado 350 → mercado', p.interpret('gastei 350 no mercado'),
  r => r.kind==='expense' && r.category.id==='mercado');
check('farmacia 60 → saude', p.interpret('paguei 60 na farmacia'),
  r => r.kind==='expense' && r.category.id==='saude');
check('netflix 55 → lazer', p.interpret('paguei 55 da netflix'),
  r => r.kind==='expense' && r.category.id==='lazer');
check('aluguel 1200 → casa', p.interpret('paguei 1200 de aluguel'),
  r => r.kind==='expense' && r.category.id==='casa');
check('sem verbo, só "pizza 40"', p.interpret('pizza 40'),
  r => r.kind==='expense' && r.amount===40);
check('torrei 50 pila rango', p.interpret('torrei 50 pila no rango'),
  r => r.kind==='expense' && r.amount===50 && r.category.id==='alimentacao');

console.log('\n=== INTERPRET: RECEITAS ===');
check('recebi 2500 cliente → trabalho', p.interpret('recebi 2500 de um cliente'),
  r => r.kind==='income' && r.amount===2500 && r.category.id==='trabalho');
check('salario 3500 → salario', p.interpret('recebi meu salario de 3500'),
  r => r.kind==='income' && r.category.id==='salario');
check('ganhei 200 freela', p.interpret('ganhei 200 de um freela'),
  r => r.kind==='income' && r.amount===200);
check('vendi por 1,5 mil', p.interpret('vendi um job por 1,5 mil'),
  r => r.kind==='income' && r.amount===1500);

console.log('\n=== INTERPRET: CONSULTAS / RELATÓRIOS ===');
check('quanto gastei essa semana', p.interpret('quanto gastei essa semana?'),
  r => r.kind==='report' && r.period==='semana');
check('resumo do mês', p.interpret('me dá um resumo do mês'),
  r => r.kind==='report' && r.period==='mes');
check('onde gastei mais', p.interpret('onde estou gastando mais?'),
  r => r.kind==='report');
check('quanto gastei hoje', p.interpret('quanto gastei hoje?'),
  r => r.kind==='report' && r.period==='hoje');
check('saldo', p.interpret('qual meu saldo?'),
  r => r.kind==='balance');

console.log('\n=== INTERPRET: PARCELAMENTO ===');
check('parcelar 1200 em 12x', p.interpret('faz sentido parcelar um celular de 1200 em 12x?'),
  r => r.kind==='installment_query' && r.amount===1200 && r.installments===12);
check('vale a pena 12x de 1200', p.interpret('vale a pena comprar em 12x de 100?'),
  r => r.kind==='installment_query' && r.installments===12);

console.log('\n=== INTERPRET: METAS ===');
check('meta juntar 5000 reserva', p.interpret('quero juntar 5000 pra reserva de emergência'),
  r => r.kind==='goal_set' && r.amount===5000);
check('meta de 10 mil', p.interpret('minha meta é poupar 10 mil'),
  r => r.kind==='goal_set' && r.amount===10000);

console.log('\n=== INTERPRET: DESCONHECIDO ===');
check('bom dia', p.interpret('bom dia'),
  r => r.kind==='unknown');

console.log(`\n=== RESULTADO: ${pass} passou, ${fail} falhou ===`);
process.exit(fail > 0 ? 1 : 0);
