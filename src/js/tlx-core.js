/*
 * tlx-core.js — Regras de negócio e cálculo do NASA-TLX.
 * LUMIA · Laboratório de Usabilidade, Mídias e Inteligência Artificial · UFC Campus Quixadá
 *
 * Módulo sem dependências. Funciona no navegador (window.TLXCore) e no Node (require).
 * Nenhuma função deste módulo acessa rede, DOM ou armazenamento.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TLXCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Versão da aplicação (interface + exportações). */
  var APP_VERSION = '1.0.0';
  /** Versão do algoritmo de cálculo; muda se qualquer regra de cálculo mudar. */
  var ALGORITHM_VERSION = 'TLX-CALC-1.0';
  /** Versão do formato dos dados salvos no navegador. */
  var SCHEMA_VERSION = 1;

  var SCALE_MIN = 0;
  var SCALE_MAX = 100;
  var SCALE_STEP = 5;
  var TOTAL_COMPARISONS = 15;

  /*
   * As seis dimensões, na ordem de Hart & Staveland (1988).
   * As perguntas orientadoras são adaptações explicativas em português,
   * não a reprodução literal de uma tradução validada (ver docs/LIMITACOES.md).
   */
  var DIMENSIONS = [
    {
      id: 'MD', slug: 'demanda-mental', nome: 'Demanda mental', nomeEn: 'Mental Demand',
      resumo: 'Atividade mental e perceptiva exigida.',
      artigo: 'da', genero: 'f',
      pergunta: 'Quanto de atividade mental e perceptiva foi necessário para realizar a tarefa? Por exemplo: pensar, decidir, calcular, lembrar, procurar informações ou acompanhar o que estava acontecendo.',
      ancoraMin: 'Muito baixa', ancoraMax: 'Muito alta', orientacaoInvertida: false
    },
    {
      id: 'PD', slug: 'demanda-fisica', nome: 'Demanda física', nomeEn: 'Physical Demand',
      resumo: 'Atividade física exigida.',
      artigo: 'da', genero: 'f',
      pergunta: 'Quanto de atividade física foi necessário para realizar a tarefa? Considere, por exemplo, esforço corporal, movimentos e exigências físicas.',
      ancoraMin: 'Muito baixa', ancoraMax: 'Muito alta', orientacaoInvertida: false
    },
    {
      id: 'TD', slug: 'demanda-temporal', nome: 'Demanda temporal', nomeEn: 'Temporal Demand',
      resumo: 'Pressão de tempo pelo ritmo da tarefa.',
      artigo: 'da', genero: 'f',
      pergunta: 'Quanta pressão de tempo você sentiu devido ao ritmo da tarefa ou à necessidade de realizá-la rapidamente?',
      ancoraMin: 'Muito baixa', ancoraMax: 'Muito alta', orientacaoInvertida: false
    },
    {
      id: 'OP', slug: 'desempenho', nome: 'Desempenho', nomeEn: 'Performance',
      resumo: 'Quanto você atingiu os objetivos.',
      artigo: 'do', genero: 'm',
      pergunta: 'Como você avalia seu desempenho ao realizar a tarefa? Considere o quanto conseguiu atingir os objetivos propostos.',
      ancoraMin: 'Bom desempenho', ancoraMax: 'Mau desempenho', orientacaoInvertida: true
    },
    {
      id: 'EF', slug: 'esforco', nome: 'Esforço', nomeEn: 'Effort',
      resumo: 'Esforço mental e físico empregado.',
      artigo: 'do', genero: 'm',
      pergunta: 'Quanto esforço mental e físico você precisou empregar para atingir seu nível de desempenho na tarefa?',
      ancoraMin: 'Muito baixo', ancoraMax: 'Muito alto', orientacaoInvertida: false
    },
    {
      id: 'FR', slug: 'frustracao', nome: 'Frustração', nomeEn: 'Frustration',
      resumo: 'Insegurança, irritação, estresse ou incômodo.',
      artigo: 'da', genero: 'f',
      pergunta: 'Quanto você se sentiu inseguro, desanimado, irritado, estressado ou incomodado durante a tarefa, em comparação com o quanto se sentiu satisfeito e relaxado?',
      ancoraMin: 'Muito baixa', ancoraMax: 'Muito alta', orientacaoInvertida: false
    }
  ];

  var DIM_IDS = DIMENSIONS.map(function (d) { return d.id; });
  var DIM_BY_ID = {};
  DIMENSIONS.forEach(function (d) { DIM_BY_ID[d.id] = d; });

  /*
   * As 15 comparações, em ordem fixa e documentada: para i < j, (dimensão i, dimensão j),
   * percorrendo a lista de dimensões. Isso gera exatamente C(6,2) = 15 pares, sem
   * repetição e sem par de uma dimensão consigo mesma.
   */
  var PAIRS = (function () {
    var out = [];
    for (var i = 0; i < DIMENSIONS.length; i++) {
      for (var j = i + 1; j < DIMENSIONS.length; j++) {
        var n = out.length + 1;
        out.push({ id: 'P' + (n < 10 ? '0' + n : String(n)), numero: n, a: DIM_IDS[i], b: DIM_IDS[j] });
      }
    }
    return out;
  })();
  var PAIR_BY_ID = {};
  PAIRS.forEach(function (p) { PAIR_BY_ID[p.id] = p; });

  /** Erro de validação com código estável para testes e mensagens. */
  function TLXError(code, message, details) {
    var e = new Error(message);
    e.name = 'TLXError';
    e.code = code;
    e.details = details || null;
    Object.setPrototypeOf(e, TLXError.prototype);
    return e;
  }
  TLXError.prototype = Object.create(Error.prototype);
  TLXError.prototype.constructor = TLXError;

  /* ---------- Validação de avaliações (intensidades) ---------- */

  /** true se v é inteiro entre 0 e 100 e múltiplo de 5. */
  function isValidRating(v) {
    return typeof v === 'number' && Number.isInteger(v) &&
      v >= SCALE_MIN && v <= SCALE_MAX && v % SCALE_STEP === 0;
  }

  /** Lista dos 21 valores possíveis da escala. */
  function scaleValues() {
    var out = [];
    for (var v = SCALE_MIN; v <= SCALE_MAX; v += SCALE_STEP) out.push(v);
    return out;
  }

  /**
   * Verifica as seis avaliações sem lançar erro.
   * Retorna { ok, ausentes: [ids], invalidas: [ids] }.
   */
  function checkRatings(ratings) {
    var ausentes = [], invalidas = [];
    ratings = ratings || {};
    DIM_IDS.forEach(function (id) {
      var v = ratings[id];
      if (v === null || v === undefined || v === '') ausentes.push(id);
      else if (!isValidRating(v)) invalidas.push(id);
    });
    return { ok: ausentes.length === 0 && invalidas.length === 0, ausentes: ausentes, invalidas: invalidas };
  }

  /** Lança TLXError se alguma avaliação estiver ausente ou fora da escala. */
  function assertRatings(ratings) {
    var c = checkRatings(ratings);
    if (c.invalidas.length) {
      throw TLXError('AVALIACAO_INVALIDA',
        'Avaliação fora da escala (0 a 100, de 5 em 5): ' + c.invalidas.map(nomeDim).join(', ') + '.', c);
    }
    if (c.ausentes.length) {
      throw TLXError('AVALIACAO_AUSENTE',
        'Dimensões sem avaliação: ' + c.ausentes.map(nomeDim).join(', ') + '.', c);
    }
  }

  /* ---------- Comparações e pesos ---------- */

  /**
   * Verifica as escolhas das comparações sem lançar erro.
   * choices: { P01: 'MD' | 'PD' | null, ... }
   * Retorna { ok, respondidas, pendentes: [ids], invalidas: [ids] }.
   */
  function checkChoices(choices) {
    choices = choices || {};
    var pendentes = [], invalidas = [];
    PAIRS.forEach(function (p) {
      var c = choices[p.id];
      if (c === null || c === undefined || c === '') pendentes.push(p.id);
      else if (c !== p.a && c !== p.b) invalidas.push(p.id);
    });
    // Chaves desconhecidas também invalidam o conjunto.
    Object.keys(choices).forEach(function (k) {
      if (!PAIR_BY_ID[k] && invalidas.indexOf(k) < 0) invalidas.push(k);
    });
    return {
      ok: pendentes.length === 0 && invalidas.length === 0,
      respondidas: TOTAL_COMPARISONS - pendentes.length - invalidas.filter(function (k) { return PAIR_BY_ID[k]; }).length,
      pendentes: pendentes,
      invalidas: invalidas
    };
  }

  /**
   * Calcula os pesos a partir das 15 escolhas: cada escolha soma 1 ponto à dimensão escolhida.
   * Lança TLXError se houver comparação pendente ou escolha inválida.
   */
  function computeWeights(choices) {
    var c = checkChoices(choices);
    if (c.invalidas.length) {
      throw TLXError('COMPARACAO_INVALIDA',
        'Escolha inválida nas comparações: ' + c.invalidas.join(', ') + '.', c);
    }
    if (c.pendentes.length) {
      throw TLXError('COMPARACOES_INCOMPLETAS',
        'Faltam ' + c.pendentes.length + ' de ' + TOTAL_COMPARISONS + ' comparações.', c);
    }
    var w = emptyWeights();
    PAIRS.forEach(function (p) { w[choices[p.id]] += 1; });
    assertWeights(w);
    return w;
  }

  /** Pesos parciais (para mostrar progresso); não valida completude. */
  function partialWeights(choices) {
    var w = emptyWeights();
    choices = choices || {};
    PAIRS.forEach(function (p) {
      var c = choices[p.id];
      if (c === p.a || c === p.b) w[c] += 1;
    });
    return w;
  }

  function emptyWeights() {
    var w = {};
    DIM_IDS.forEach(function (id) { w[id] = 0; });
    return w;
  }

  /** Lança TLXError se algum peso não for inteiro 0–5 ou se a soma não for 15. */
  function assertWeights(weights) {
    if (!weights || typeof weights !== 'object') throw TLXError('PESOS_INVALIDOS', 'Pesos ausentes.');
    var soma = 0;
    DIM_IDS.forEach(function (id) {
      var w = weights[id];
      if (typeof w !== 'number' || !Number.isInteger(w) || w < 0 || w > 5) {
        throw TLXError('PESOS_INVALIDOS', 'Peso inválido para ' + nomeDim(id) + ': deve ser inteiro de 0 a 5.');
      }
      soma += w;
    });
    if (soma !== TOTAL_COMPARISONS) {
      throw TLXError('SOMA_PESOS_INVALIDA', 'A soma dos pesos deve ser 15; foi ' + soma + '.', { soma: soma });
    }
  }

  /* ---------- Pontuações ---------- */

  /** Raw TLX (não ponderado): média aritmética das seis avaliações. */
  function rawTLX(ratings) {
    assertRatings(ratings);
    var soma = 0;
    DIM_IDS.forEach(function (id) { soma += ratings[id]; });
    return soma / DIM_IDS.length;
  }

  /** NASA-TLX ponderado: Σ(avaliação × peso) / 15. */
  function weightedTLX(ratings, weights) {
    assertRatings(ratings);
    assertWeights(weights);
    var soma = 0;
    DIM_IDS.forEach(function (id) { soma += ratings[id] * weights[id]; });
    return soma / TOTAL_COMPARISONS;
  }

  /**
   * Resultado completo de uma avaliação.
   * Mantém os valores brutos (sem arredondamento) para auditoria.
   */
  function computeResults(ratings, choices) {
    assertRatings(ratings);
    var weights = computeWeights(choices);
    var weighted = weightedTLX(ratings, weights);
    var raw = rawTLX(ratings);
    var porDimensao = DIMENSIONS.map(function (d) {
      var produto = ratings[d.id] * weights[d.id];          // avaliação ajustada (0–500)
      var contribuicao = produto / TOTAL_COMPARISONS;      // parcela do escore ponderado (0–33,3…)
      return {
        id: d.id,
        nome: d.nome,
        intensidade: ratings[d.id],
        peso: weights[d.id],
        produto: produto,
        contribuicao: contribuicao,
        percentual: weighted > 0 ? (contribuicao / weighted) * 100 : 0
      };
    });
    return {
      ponderado: weighted,
      raw: raw,
      pesos: weights,
      somaPesos: TOTAL_COMPARISONS,
      porDimensao: porDimensao,
      versaoAlgoritmo: ALGORITHM_VERSION
    };
  }

  /* ---------- Avaliação (estado) ---------- */

  /** Gera um código de avaliação: TLX-AAAAMMDD-XXXXXX (sem caracteres ambíguos). */
  function generateEvaluationCode(date, randomFn) {
    date = date || new Date();
    var alfabeto = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    var bytes = randomFn ? randomFn(6) : randomBytes(6);
    var sufixo = '';
    for (var i = 0; i < 6; i++) sufixo += alfabeto[bytes[i] % alfabeto.length];
    return 'TLX-' + date.getFullYear() + pad2(date.getMonth() + 1) + pad2(date.getDate()) + '-' + sufixo;
  }

  function randomBytes(n) {
    var arr = new Uint8Array(n);
    var c = (typeof globalThis !== 'undefined' && globalThis.crypto) ? globalThis.crypto : null;
    if (c && c.getRandomValues) c.getRandomValues(arr);
    else for (var i = 0; i < n; i++) arr[i] = Math.floor(Math.random() * 256);
    return arr;
  }

  /** Cria uma avaliação vazia. */
  function createEvaluation(now) {
    now = now || new Date();
    var avaliacoes = {}, comparacoes = {};
    DIM_IDS.forEach(function (id) { avaliacoes[id] = null; });
    PAIRS.forEach(function (p) { comparacoes[p.id] = null; });
    return {
      schema: SCHEMA_VERSION,
      codigo: generateEvaluationCode(now),
      criadaEm: toLocalISO(now),
      atualizadaEm: toLocalISO(now),
      etapa: 'identificacao',
      meta: { tarefa: '', participante: '', sistema: '', versaoSistema: '', observacoes: '' },
      avaliacoes: avaliacoes,
      comparacoes: comparacoes,
      concluidaEm: null,
      resultado: null
    };
  }

  /**
   * Conclui a avaliação: valida tudo e grava o resultado calculado.
   * Retorna uma cópia nova; não altera a original.
   */
  function finalizeEvaluation(ev, now) {
    if (!ev || !ev.meta || !String(ev.meta.tarefa || '').trim()) {
      throw TLXError('TAREFA_AUSENTE', 'Informe o nome ou a descrição da tarefa.');
    }
    var res = computeResults(ev.avaliacoes, ev.comparacoes);
    var copy = clone(ev);
    copy.resultado = res;
    copy.concluidaEm = toLocalISO(now || new Date());
    copy.etapa = 'resultados';
    return copy;
  }

  /* ---------- Formatação ---------- */

  /**
   * Formata número em pt-BR com no máximo uma casa decimal, só quando necessário.
   * 50 → "50"; 47.333… → "47,3". O valor interno não é alterado.
   */
  function formatScore(v) {
    if (typeof v !== 'number' || !isFinite(v)) return '—';
    var r = Math.round(v * 10) / 10;
    if (Number.isInteger(r)) return String(r);
    return r.toFixed(1).replace('.', ',');
  }

  /** Data ISO local com fuso: 2026-10-13T17:18:05-03:00 */
  function toLocalISO(d) {
    var off = -d.getTimezoneOffset();
    var sign = off >= 0 ? '+' : '-';
    off = Math.abs(off);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) +
      sign + pad2(Math.floor(off / 60)) + ':' + pad2(off % 60);
  }

  /** "2026-10-13T17:18:05-03:00" → "13/10/2026 17:18" (horário registrado). */
  function formatDateTimeBR(iso) {
    if (!iso) return '—';
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
    if (!m) return String(iso);
    return m[3] + '/' + m[2] + '/' + m[1] + ' ' + m[4] + ':' + m[5];
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function nomeDim(id) { return DIM_BY_ID[id] ? DIM_BY_ID[id].nome : id; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---------- Referências ---------- */

  var REFERENCES = [
    'HART, S. G.; STAVELAND, L. E. Development of NASA-TLX (Task Load Index): results of empirical and theoretical research. In: HANCOCK, P. A.; MESHKATI, N. (ed.). Human Mental Workload. Amsterdam: North-Holland, 1988. p. 139-183. (Advances in Psychology, v. 52). DOI: 10.1016/S0166-4115(08)62386-9.',
    'HART, S. G. NASA-Task Load Index (NASA-TLX); 20 years later. Proceedings of the Human Factors and Ergonomics Society Annual Meeting, v. 50, n. 9, p. 904-908, 2006. DOI: 10.1177/154193120605000909.',
    'CIOFI-SILVA, C. L. et al. Workload assessment: cross-cultural adaptation, content validity and instrument reliability. Revista Brasileira de Enfermagem, v. 76, n. 3, e20220556, 2023. DOI: 10.1590/0034-7167-2022-0556.'
  ];

  var INTERPRETATION_NOTE = 'A pontuação representa a carga de trabalho subjetiva percebida durante a tarefa avaliada. A interpretação depende do contexto, da tarefa, da população e das condições de aplicação.';

  var INSTRUCTION = 'Considere a tarefa que você acabou de realizar. Responda às questões de acordo com sua experiência durante essa tarefa. Não existem respostas certas ou erradas. Avalie cada dimensão individualmente e responda às comparações considerando quais fatores mais contribuíram para sua carga de trabalho.';

  var PAIR_QUESTION = 'Qual dessas duas dimensões contribuiu mais para sua carga de trabalho durante a tarefa realizada?';

  return {
    APP_VERSION: APP_VERSION,
    ALGORITHM_VERSION: ALGORITHM_VERSION,
    SCHEMA_VERSION: SCHEMA_VERSION,
    SCALE_MIN: SCALE_MIN, SCALE_MAX: SCALE_MAX, SCALE_STEP: SCALE_STEP,
    TOTAL_COMPARISONS: TOTAL_COMPARISONS,
    DIMENSIONS: DIMENSIONS, DIM_IDS: DIM_IDS, DIM_BY_ID: DIM_BY_ID,
    PAIRS: PAIRS, PAIR_BY_ID: PAIR_BY_ID,
    REFERENCES: REFERENCES,
    INTERPRETATION_NOTE: INTERPRETATION_NOTE,
    INSTRUCTION: INSTRUCTION,
    PAIR_QUESTION: PAIR_QUESTION,
    TLXError: TLXError,
    isValidRating: isValidRating,
    scaleValues: scaleValues,
    checkRatings: checkRatings,
    assertRatings: assertRatings,
    checkChoices: checkChoices,
    computeWeights: computeWeights,
    partialWeights: partialWeights,
    assertWeights: assertWeights,
    rawTLX: rawTLX,
    weightedTLX: weightedTLX,
    computeResults: computeResults,
    generateEvaluationCode: generateEvaluationCode,
    createEvaluation: createEvaluation,
    finalizeEvaluation: finalizeEvaluation,
    formatScore: formatScore,
    formatDateTimeBR: formatDateTimeBR,
    toLocalISO: toLocalISO,
    nomeDim: nomeDim,
    clone: clone
  };
});
