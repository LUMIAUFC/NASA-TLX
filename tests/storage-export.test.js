// Testes do salvamento local e das exportações (node --test)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const T = require('../src/js/tlx-core.js');
const S = require('../src/js/tlx-storage.js');
const X = require('../src/js/tlx-export.js');
const ASSETS = require('../src/js/tlx-assets.js');

function sampleEvaluation(overrides) {
  const ev = T.createEvaluation(new Date(2026, 9, 13, 14, 30, 0));
  ev.meta.tarefa = 'Agendar consulta no aplicativo';
  ev.meta.participante = 'P07';
  ev.meta.sistema = 'Protótipo de agendamento';
  ev.meta.versaoSistema = '2.1';
  ev.meta.observacoes = 'Sessão sem interrupções.';
  ev.avaliacoes = { MD: 80, PD: 10, TD: 60, OP: 30, EF: 70, FR: 40 };
  for (const p of T.PAIRS) ev.comparacoes[p.id] = p.a; // pesos 5,4,3,2,1,0
  Object.assign(ev.meta, overrides || {});
  return T.finalizeEvaluation(ev, new Date(2026, 9, 13, 14, 45, 0));
}

/* ---------------- Armazenamento ---------------- */

test('salva e recupera avaliação em andamento (metadados, avaliações e comparações parciais)', () => {
  const mem = S.memoryStorage();
  const store = S.createStore(mem);
  const ev = T.createEvaluation();
  ev.meta.tarefa = 'Tarefa A'; ev.meta.participante = 'P01';
  ev.avaliacoes.MD = 45; ev.avaliacoes.OP = 100;
  ev.comparacoes.P01 = 'PD'; ev.comparacoes.P02 = 'MD';
  ev.etapa = 'comparacoes';
  assert.equal(store.save({ atual: ev, concluidas: [] }).ok, true);

  // Simula reabrir a aplicação: novo store sobre o mesmo armazenamento.
  const store2 = S.createStore(mem);
  const res = store2.load();
  assert.equal(res.ok, true);
  assert.equal(res.data.atual.codigo, ev.codigo);
  assert.equal(res.data.atual.meta.tarefa, 'Tarefa A');
  assert.equal(res.data.atual.avaliacoes.MD, 45);
  assert.equal(res.data.atual.avaliacoes.OP, 100);
  assert.equal(res.data.atual.avaliacoes.EF, null);
  assert.equal(res.data.atual.comparacoes.P01, 'PD');
  assert.equal(res.data.atual.comparacoes.P03, null);
  assert.equal(res.data.atual.etapa, 'comparacoes');
  assert.ok(res.data.salvoEm);
});

test('avaliações concluídas permanecem salvas e o resultado é recalculado ao carregar', () => {
  const mem = S.memoryStorage();
  const store = S.createStore(mem);
  const ev = sampleEvaluation();
  store.save({ atual: null, concluidas: [ev] });
  const res = S.createStore(mem).load();
  assert.equal(res.data.concluidas.length, 1);
  assert.equal(res.data.concluidas[0].resultado.ponderado, 50);
  assert.equal(res.data.concluidas[0].concluidaEm, ev.concluidaEm);
});

test('resultado adulterado no armazenamento é substituído pelo recálculo', () => {
  const mem = S.memoryStorage();
  const ev = sampleEvaluation();
  ev.resultado.ponderado = 99; // adulteração
  S.createStore(mem).save({ atual: null, concluidas: [ev] });
  const res = S.createStore(mem).load();
  assert.equal(res.data.concluidas[0].resultado.ponderado, 50);
});

test('valores inválidos no armazenamento são descartados com aviso', () => {
  const mem = S.memoryStorage();
  mem.setItem(S.DEFAULT_KEY, JSON.stringify({
    app: 'lumia-nasa-tlx', schema: 1,
    atual: { codigo: 'TLX-20261013-ABCDEF', meta: { tarefa: 'X' }, avaliacoes: { MD: 42, PD: 50 }, comparacoes: { P01: 'FR', P02: 'TD' } },
    concluidas: []
  }));
  const res = S.createStore(mem).load();
  assert.equal(res.ok, true);
  assert.equal(res.data.atual.avaliacoes.MD, null);
  assert.equal(res.data.atual.avaliacoes.PD, 50);
  assert.equal(res.data.atual.comparacoes.P01, null);
  assert.equal(res.data.atual.comparacoes.P02, 'TD');
  assert.ok(res.avisos.length >= 2);
});

test('dados corrompidos são detectados sem lançar erro', () => {
  const mem = S.memoryStorage();
  mem.setItem(S.DEFAULT_KEY, '{isto não é json');
  const res = S.createStore(mem).load();
  assert.equal(res.ok, false);
  assert.equal(res.error, 'CORROMPIDO');
  assert.equal(res.data.atual, null);
});

test('falha de gravação (cota cheia) é informada', () => {
  const store = S.createStore(S.memoryStorage({ failWrites: true }));
  const r = store.save({ atual: T.createEvaluation(), concluidas: [] });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'SEM_ESPACO');
  assert.match(S.errorMessage(r.error), /espaço/);
  assert.equal(store.available(), false);
});

test('armazenamento indisponível é informado', () => {
  const store = S.createStore(null);
  assert.equal(store.load().error, 'INDISPONIVEL');
  assert.equal(store.save({}).ok, false);
});

test('remoção explícita apaga os dados locais da aplicação', () => {
  const mem = S.memoryStorage();
  const store = S.createStore(mem);
  store.save({ atual: T.createEvaluation(), concluidas: [sampleEvaluation()] });
  assert.ok(mem.getItem(S.DEFAULT_KEY));
  store.clear();
  assert.equal(mem.getItem(S.DEFAULT_KEY), null);
  assert.equal(store.load().data.concluidas.length, 0);
});

/* ---------------- CSV ---------------- */

test('CSV: BOM UTF-8, cabeçalho em português e valores correspondentes às respostas', () => {
  const ev = sampleEvaluation();
  const csv = X.buildCSV([ev]);
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  const rows = X.parseCSV(csv);
  assert.equal(rows.length, 2);
  const [head, row] = rows;
  assert.equal(head.length, row.length);
  const get = (name) => row[head.indexOf(name)];
  assert.equal(get('Código da avaliação'), ev.codigo);
  assert.equal(get('Tarefa'), 'Agendar consulta no aplicativo');
  assert.equal(get('Código do participante'), 'P07');
  assert.equal(get('Sistema ou aplicação avaliada'), 'Protótipo de agendamento');
  assert.equal(get('Versão do sistema avaliado'), '2.1');
  assert.equal(get('Intensidade da demanda mental'), '80');
  assert.equal(get('Intensidade da demanda física'), '10');
  assert.equal(get('Intensidade da demanda temporal'), '60');
  assert.equal(get('Intensidade do desempenho'), '30');
  assert.equal(get('Intensidade do esforço'), '70');
  assert.equal(get('Intensidade da frustração'), '40');
  assert.deepEqual(['Peso da demanda mental', 'Peso da demanda física', 'Peso da demanda temporal',
    'Peso do desempenho', 'Peso do esforço', 'Peso da frustração'].map(get), ['5', '4', '3', '2', '1', '0']);
  assert.equal(get('Resultado NASA-TLX ponderado'), '50');
  assert.equal(get('Resultado Raw TLX (não ponderado)'), '48,3333');
  assert.equal(get('Versão do algoritmo de cálculo'), T.ALGORITHM_VERSION);
  assert.equal(get('Comparação 01: Demanda mental × Demanda física'), 'Demanda mental');
  assert.equal(get('Comparação 15: Esforço × Frustração'), 'Esforço');
  const compCols = head.filter((h) => h.startsWith('Comparação '));
  assert.equal(compCols.length, 15);
});

test('CSV: uma linha por avaliação concluída', () => {
  const csv = X.buildCSV([sampleEvaluation(), sampleEvaluation({ tarefa: 'Outra tarefa' })]);
  assert.equal(X.parseCSV(csv).length, 3);
});

test('CSV: campos com fórmula, aspas, ponto e vírgula e quebra de linha são tratados', () => {
  const ev = sampleEvaluation({ tarefa: '=HYPERLINK("http://x")', participante: '+55', observacoes: 'linha 1\nlinha 2; com "aspas"' });
  const csv = X.buildCSV([ev]);
  const [head, row] = X.parseCSV(csv);
  assert.equal(row[head.indexOf('Tarefa')], '\'=HYPERLINK("http://x")');
  assert.equal(row[head.indexOf('Código do participante')], "'+55");
  assert.equal(row[head.indexOf('Observações do avaliador')], 'linha 1\nlinha 2; com "aspas"');
  assert.equal(X.neutralizeFormula('-1'), "'-1");
  assert.equal(X.neutralizeFormula('@SUM'), "'@SUM");
  assert.equal(X.neutralizeFormula('Normal'), 'Normal');
});

test('CSV: avaliação não concluída não é exportada', () => {
  assert.throws(() => X.buildCSV([T.createEvaluation()]), { code: 'SEM_RESULTADO' });
});

/* ---------------- PDF ---------------- */

function hasTool(cmd) {
  try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; }
}

test('PDF: arquivo válido com cabeçalho, rodapé e estrutura PDF', () => {
  const bytes = X.buildReportPDF(sampleEvaluation(), ASSETS.pdfHeader);
  const s = Buffer.from(bytes).toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  assert.match(s, /\/Type \/Catalog/);
  assert.match(s, /\/Filter \/DCTDecode/);
  // a tabela xref aponta para os objetos certos
  const startxref = Number(/startxref\n(\d+)/.exec(s)[1]);
  assert.equal(s.slice(startxref, startxref + 4), 'xref');
  const offs = [...s.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offs.forEach((o, i) => assert.equal(s.slice(o, o + String(i + 1).length + 6), (i + 1) + ' 0 obj'));
});

test('PDF: texto extraído contém os dados da avaliação e acentos corretos', { skip: !hasTool('pdftotext') && 'pdftotext indisponível' }, () => {
  const ev = sampleEvaluation();
  const file = path.join(os.tmpdir(), 'tlx-teste.pdf');
  fs.writeFileSync(file, X.buildReportPDF(ev, ASSETS.pdfHeader));
  const txt = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-']).toString('utf8');
  for (const s of [
    'Relatório de Avaliação de Carga de Trabalho — NASA-TLX', ev.codigo, 'Agendar consulta no aplicativo',
    'Protótipo de agendamento', 'P07', 'NASA-TLX PONDERADO', 'Raw TLX', '48,3', 'Demanda física',
    'Frustração', 'Esforço × Frustração', 'Escolhida: Demanda mental', 'Hart', 'Staveland',
    'Sistema NASA-TLX LUMIA ' + T.APP_VERSION, T.ALGORITHM_VERSION, 'Página 1 de', 'Observações do avaliador'
  ]) assert.ok(txt.includes(s), 'faltou no PDF: ' + s);
  const info = execFileSync('pdfinfo', [file]).toString('utf8');
  assert.match(info, /Pages:\s+[23]/);
  assert.match(info, /Title:\s+Relatório de Avaliação/);
});

test('PDF: avaliação não concluída não gera relatório', () => {
  assert.throws(() => X.buildReportPDF(T.createEvaluation()), { code: 'SEM_RESULTADO' });
});

test('nomes de arquivo sem acentos nem caracteres especiais', () => {
  const ev = sampleEvaluation({ tarefa: 'Ação: cadastrar usuário/admin' });
  assert.equal(X.fileName(ev, 'pdf'), 'nasa-tlx_' + ev.codigo + '_acao-cadastrar-usuario-admin.pdf');
});
