// Testes do núcleo de cálculo (node --test)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/js/tlx-core.js');

const all = (v) => Object.fromEntries(T.DIM_IDS.map((id) => [id, v]));

/** Escolhas que produzem pesos conhecidos: escolhe sempre a dimensão de menor índice (a). */
const choicesFirst = () => Object.fromEntries(T.PAIRS.map((p) => [p.id, p.a]));

/** Cálculo independente, escrito sem reutilizar o módulo. */
function independentWeighted(ratings, choices) {
  const order = ['MD', 'PD', 'TD', 'OP', 'EF', 'FR'];
  const w = { MD: 0, PD: 0, TD: 0, OP: 0, EF: 0, FR: 0 };
  for (const k of Object.keys(choices)) w[choices[k]]++;
  let s = 0;
  for (const id of order) s += ratings[id] * w[id];
  return { score: s / 15, w };
}

test('estrutura: seis dimensões na ordem e nomes exigidos', () => {
  assert.deepEqual(T.DIMENSIONS.map((d) => d.nome),
    ['Demanda mental', 'Demanda física', 'Demanda temporal', 'Desempenho', 'Esforço', 'Frustração']);
});

test('estrutura: escala com 21 valores de 0 a 100, de 5 em 5', () => {
  const v = T.scaleValues();
  assert.equal(v.length, 21);
  assert.equal(v[0], 0); assert.equal(v[20], 100);
  assert.ok(v.every((x, i) => x === i * 5));
});

test('estrutura: desempenho com orientação invertida (0 = bom, 100 = mau)', () => {
  const op = T.DIM_BY_ID.OP;
  assert.equal(op.orientacaoInvertida, true);
  assert.equal(op.ancoraMin, 'Bom desempenho');
  assert.equal(op.ancoraMax, 'Mau desempenho');
  // O cálculo não inverte: desempenho 100 conta como 100.
  const r = all(0); r.OP = 100;
  assert.equal(T.rawTLX(r), 100 / 6);
});

test('estrutura: 15 comparações, sem duplicação nem autopares, na ordem documentada', () => {
  assert.equal(T.PAIRS.length, 15);
  const seen = new Set();
  for (const p of T.PAIRS) {
    assert.notEqual(p.a, p.b);
    const key = [p.a, p.b].sort().join('-');
    assert.ok(!seen.has(key), 'par duplicado ' + key);
    seen.add(key);
  }
  const nomes = T.PAIRS.map((p) => T.nomeDim(p.a) + ' × ' + T.nomeDim(p.b));
  assert.deepEqual(nomes, [
    'Demanda mental × Demanda física', 'Demanda mental × Demanda temporal', 'Demanda mental × Desempenho',
    'Demanda mental × Esforço', 'Demanda mental × Frustração', 'Demanda física × Demanda temporal',
    'Demanda física × Desempenho', 'Demanda física × Esforço', 'Demanda física × Frustração',
    'Demanda temporal × Desempenho', 'Demanda temporal × Esforço', 'Demanda temporal × Frustração',
    'Desempenho × Esforço', 'Desempenho × Frustração', 'Esforço × Frustração'
  ]);
});

for (const v of [0, 100, 50]) {
  test(`seis avaliações iguais a ${v}: ponderado = ${v} e Raw TLX = ${v}`, () => {
    const res = T.computeResults(all(v), choicesFirst());
    assert.equal(res.ponderado, v);
    assert.equal(res.raw, v);
  });
}

test('pesos com soma diferente de 15: cálculo ponderado é rejeitado', () => {
  const w = { MD: 5, PD: 4, TD: 3, OP: 2, EF: 1, FR: 1 }; // soma 16
  assert.throws(() => T.weightedTLX(all(50), w), { code: 'SOMA_PESOS_INVALIDA' });
  const w2 = { MD: 5, PD: 4, TD: 3, OP: 2, EF: 0, FR: 0 }; // soma 14
  assert.throws(() => T.weightedTLX(all(50), w2), { code: 'SOMA_PESOS_INVALIDA' });
});

test('pesos fora de 0–5 ou não inteiros são rejeitados', () => {
  assert.throws(() => T.assertWeights({ MD: 6, PD: 4, TD: 3, OP: 2, EF: 0, FR: 0 }), { code: 'PESOS_INVALIDOS' });
  assert.throws(() => T.assertWeights({ MD: 2.5, PD: 2.5, TD: 3, OP: 3, EF: 2, FR: 2 }), { code: 'PESOS_INVALIDOS' });
  assert.throws(() => T.assertWeights({ MD: -1, PD: 5, TD: 5, OP: 5, EF: 1, FR: 0 }), { code: 'PESOS_INVALIDOS' });
});

test('comparações incompletas impedem a conclusão da ponderação', () => {
  const c = choicesFirst();
  c.P07 = null;
  assert.throws(() => T.computeWeights(c), { code: 'COMPARACOES_INCOMPLETAS' });
  assert.throws(() => T.computeResults(all(50), c), { code: 'COMPARACOES_INCOMPLETAS' });
  const chk = T.checkChoices(c);
  assert.equal(chk.ok, false); assert.deepEqual(chk.pendentes, ['P07']); assert.equal(chk.respondidas, 14);
});

test('escolha que não pertence ao par é rejeitada', () => {
  const c = choicesFirst();
  c.P01 = 'FR'; // P01 é MD × PD
  assert.throws(() => T.computeWeights(c), { code: 'COMPARACAO_INVALIDA' });
});

test('avaliações ausentes impedem o cálculo final', () => {
  const r = all(50); r.EF = null;
  assert.throws(() => T.rawTLX(r), { code: 'AVALIACAO_AUSENTE' });
  assert.throws(() => T.computeResults(r, choicesFirst()), { code: 'AVALIACAO_AUSENTE' });
  const r2 = all(50); delete r2.FR;
  assert.throws(() => T.rawTLX(r2), { code: 'AVALIACAO_AUSENTE' });
});

test('valores fora da escala ou fora dos incrementos de 5 são rejeitados', () => {
  for (const bad of [-5, 105, 7, 52.5, '50', NaN, Infinity]) {
    assert.equal(T.isValidRating(bad), false, String(bad));
    const r = all(50); r.MD = bad;
    assert.throws(() => T.rawTLX(r), { code: 'AVALIACAO_INVALIDA' }, String(bad));
  }
  for (const ok of [0, 5, 35, 100]) assert.equal(T.isValidRating(ok), true);
});

test('cada escolha incrementa exatamente uma dimensão', () => {
  const choices = {};
  for (const p of T.PAIRS) choices[p.id] = null;
  let prev = T.partialWeights(choices);
  for (const p of T.PAIRS) {
    choices[p.id] = p.b;
    const cur = T.partialWeights(choices);
    const diffs = T.DIM_IDS.map((id) => cur[id] - prev[id]);
    assert.equal(diffs.filter((d) => d === 1).length, 1);
    assert.equal(diffs.filter((d) => d !== 0 && d !== 1).length, 0);
    assert.equal(cur[p.b] - prev[p.b], 1);
    prev = cur;
  }
});

test('soma dos pesos calculados é 15 e cada peso fica entre 0 e 5', () => {
  // Percorre as 2^15 combinações possíveis de escolhas.
  for (let mask = 0; mask < (1 << 15); mask++) {
    const c = {};
    T.PAIRS.forEach((p, i) => { c[p.id] = (mask >> i) & 1 ? p.b : p.a; });
    const w = T.computeWeights(c);
    const vals = Object.values(w);
    assert.equal(vals.reduce((a, b) => a + b, 0), 15);
    assert.ok(vals.every((x) => x >= 0 && x <= 5));
  }
});

test('pesos de "sempre a primeira dimensão" são 5,4,3,2,1,0', () => {
  assert.deepEqual(T.computeWeights(choicesFirst()), { MD: 5, PD: 4, TD: 3, OP: 2, EF: 1, FR: 0 });
});

test('pontuação ponderada confere com cálculo independente (500 casos aleatórios)', () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let k = 0; k < 500; k++) {
    const r = {}; for (const id of T.DIM_IDS) r[id] = Math.floor(rnd() * 21) * 5;
    const c = {}; for (const p of T.PAIRS) c[p.id] = rnd() < 0.5 ? p.a : p.b;
    const res = T.computeResults(r, c);
    const ind = independentWeighted(r, c);
    assert.deepEqual(res.pesos, ind.w);
    assert.ok(Math.abs(res.ponderado - ind.score) < 1e-9);
    const rawInd = Object.values(r).reduce((a, b) => a + b, 0) / 6;
    assert.ok(Math.abs(res.raw - rawInd) < 1e-9);
    const somaContrib = res.porDimensao.reduce((a, d) => a + d.contribuicao, 0);
    assert.ok(Math.abs(somaContrib - res.ponderado) < 1e-9);
  }
});

test('caso documentado: ponderado e raw diferem e são reportados separadamente', () => {
  const r = { MD: 80, PD: 10, TD: 60, OP: 30, EF: 70, FR: 40 };
  const c = choicesFirst(); // pesos 5,4,3,2,1,0
  const res = T.computeResults(r, c);
  // (80*5 + 10*4 + 60*3 + 30*2 + 70*1 + 40*0) / 15 = 750 / 15 = 50
  assert.equal(res.ponderado, 50);
  // (80+10+60+30+70+40)/6 = 290/6 = 48,333…
  assert.ok(Math.abs(res.raw - 290 / 6) < 1e-12);
  assert.equal(T.formatScore(res.raw), '48,3');
  assert.equal(T.formatScore(res.ponderado), '50');
});

test('finalizeEvaluation exige tarefa e grava resultado sem alterar o original', () => {
  const ev = T.createEvaluation(new Date(2026, 9, 13, 10, 0, 0));
  ev.avaliacoes = all(50); ev.comparacoes = choicesFirst();
  assert.throws(() => T.finalizeEvaluation(ev), { code: 'TAREFA_AUSENTE' });
  ev.meta.tarefa = 'Cadastrar paciente';
  const fin = T.finalizeEvaluation(ev);
  assert.equal(fin.resultado.ponderado, 50);
  assert.equal(ev.resultado, null);
  assert.equal(fin.resultado.versaoAlgoritmo, T.ALGORITHM_VERSION);
});

test('código de avaliação tem formato TLX-AAAAMMDD-XXXXXX', () => {
  const c = T.generateEvaluationCode(new Date(2026, 9, 13));
  assert.match(c, /^TLX-20261013-[A-Z2-9]{6}$/);
});

test('formatação pt-BR com uma casa decimal só quando necessário', () => {
  assert.equal(T.formatScore(50), '50');
  assert.equal(T.formatScore(47.3333), '47,3');
  assert.equal(T.formatScore(12.96), '13');
  assert.equal(T.formatDateTimeBR('2026-10-13T17:18:05-03:00'), '13/10/2026 17:18');
});
