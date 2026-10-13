/*
 * tlx-storage.js — Salvamento local (localStorage) da avaliação em andamento
 * e das avaliações concluídas. Nada é enviado para fora do navegador.
 *
 * O armazenamento é injetável (qualquer objeto com getItem/setItem/removeItem),
 * o que permite testar no Node sem navegador.
 */
(function (root, factory) {
  var core = (typeof module === 'object' && module.exports) ? require('./tlx-core.js') : root.TLXCore;
  var api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TLXStorage = api;
})(typeof self !== 'undefined' ? self : this, function (T) {
  'use strict';

  var DEFAULT_KEY = 'lumia.nasa-tlx.v1';
  var ETAPAS = ['identificacao', 'instrucoes', 'dimensoes', 'comparacoes', 'revisao', 'resultados'];

  function emptyData() {
    return { app: 'lumia-nasa-tlx', schema: T.SCHEMA_VERSION, atual: null, concluidas: [], salvoEm: null };
  }

  /**
   * Corrige uma avaliação lida do armazenamento: mantém só campos conhecidos,
   * descarta valores fora da escala e escolhas que não pertencem ao par.
   * Retorna { ev, avisos }.
   */
  function normalizeEvaluation(raw) {
    var avisos = [];
    if (!raw || typeof raw !== 'object') return { ev: null, avisos: ['Registro inválido descartado.'] };
    var ev = T.createEvaluation();
    if (typeof raw.codigo === 'string' && /^TLX-\d{8}-[A-Z0-9]{6}$/.test(raw.codigo)) ev.codigo = raw.codigo;
    else avisos.push('Código de avaliação ausente; um novo código foi gerado.');
    if (typeof raw.criadaEm === 'string') ev.criadaEm = raw.criadaEm;
    if (typeof raw.atualizadaEm === 'string') ev.atualizadaEm = raw.atualizadaEm;
    if (ETAPAS.indexOf(raw.etapa) >= 0) ev.etapa = raw.etapa;
    var m = raw.meta || {};
    ['tarefa', 'participante', 'sistema', 'versaoSistema', 'observacoes'].forEach(function (k) {
      if (typeof m[k] === 'string') ev.meta[k] = m[k];
    });
    var av = raw.avaliacoes || {};
    T.DIM_IDS.forEach(function (id) {
      var v = av[id];
      if (v === null || v === undefined) return;
      if (T.isValidRating(v)) ev.avaliacoes[id] = v;
      else avisos.push('Valor inválido de ' + T.nomeDim(id) + ' descartado.');
    });
    var cp = raw.comparacoes || {};
    T.PAIRS.forEach(function (p) {
      var c = cp[p.id];
      if (c === null || c === undefined) return;
      if (c === p.a || c === p.b) ev.comparacoes[p.id] = c;
      else avisos.push('Escolha inválida na comparação ' + p.numero + ' descartada.');
    });
    if (typeof raw.concluidaEm === 'string' && raw.resultado) {
      // Recalcula para garantir que o resultado salvo corresponde às respostas.
      try {
        var fin = T.finalizeEvaluation(ev);
        fin.concluidaEm = raw.concluidaEm;
        ev = fin;
      } catch (e) {
        avisos.push('Resultado salvo não pôde ser reconstruído: ' + e.message);
        ev.etapa = 'revisao';
      }
    }
    return { ev: ev, avisos: avisos };
  }

  function createStore(storage, opts) {
    opts = opts || {};
    var key = opts.key || DEFAULT_KEY;
    var now = opts.now || function () { return new Date(); };

    function available() {
      if (!storage) return false;
      try {
        var t = key + '.__teste__';
        storage.setItem(t, '1');
        storage.removeItem(t);
        return true;
      } catch (e) { return false; }
    }

    /** Lê os dados. Retorna { ok, data, avisos, error }. */
    function load() {
      if (!storage) return { ok: false, data: emptyData(), avisos: [], error: 'INDISPONIVEL' };
      var txt;
      try { txt = storage.getItem(key); }
      catch (e) { return { ok: false, data: emptyData(), avisos: [], error: 'INDISPONIVEL' }; }
      if (txt === null || txt === undefined) return { ok: true, data: emptyData(), avisos: [], error: null };
      var parsed;
      try { parsed = JSON.parse(txt); }
      catch (e) { return { ok: false, data: emptyData(), avisos: [], error: 'CORROMPIDO', bruto: txt }; }
      if (!parsed || parsed.app !== 'lumia-nasa-tlx') {
        return { ok: false, data: emptyData(), avisos: [], error: 'CORROMPIDO', bruto: txt };
      }
      var data = emptyData();
      var avisos = [];
      data.salvoEm = typeof parsed.salvoEm === 'string' ? parsed.salvoEm : null;
      if (parsed.atual) {
        var n = normalizeEvaluation(parsed.atual);
        data.atual = n.ev; avisos = avisos.concat(n.avisos);
      }
      (Array.isArray(parsed.concluidas) ? parsed.concluidas : []).forEach(function (r) {
        var n2 = normalizeEvaluation(r);
        if (n2.ev && n2.ev.resultado) data.concluidas.push(n2.ev);
        avisos = avisos.concat(n2.avisos);
      });
      return { ok: true, data: data, avisos: avisos, error: null };
    }

    /** Grava os dados. Retorna { ok, salvoEm, error }. */
    function save(data) {
      if (!storage) return { ok: false, error: 'INDISPONIVEL' };
      var copy = {
        app: 'lumia-nasa-tlx',
        schema: T.SCHEMA_VERSION,
        atual: data.atual || null,
        concluidas: data.concluidas || [],
        salvoEm: T.toLocalISO(now())
      };
      try {
        storage.setItem(key, JSON.stringify(copy));
        return { ok: true, salvoEm: copy.salvoEm, error: null };
      } catch (e) {
        var quota = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
        return { ok: false, error: quota ? 'SEM_ESPACO' : 'FALHA_GRAVACAO', detalhe: String(e && e.message || e) };
      }
    }

    /** Remove todos os dados desta aplicação do navegador. */
    function clear() {
      if (!storage) return { ok: false, error: 'INDISPONIVEL' };
      try { storage.removeItem(key); return { ok: true }; }
      catch (e) { return { ok: false, error: 'FALHA_GRAVACAO' }; }
    }

    return { key: key, available: available, load: load, save: save, clear: clear };
  }

  /** Armazenamento em memória com a mesma interface do localStorage (testes e fallback). */
  function memoryStorage(opts) {
    opts = opts || {};
    var m = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      setItem: function (k, v) {
        if (opts.failWrites) { var e = new Error('cota excedida'); e.name = 'QuotaExceededError'; throw e; }
        m[k] = String(v);
      },
      removeItem: function (k) { delete m[k]; },
      _dump: function () { return m; }
    };
  }

  /** Mensagem em português para cada código de erro de armazenamento. */
  function errorMessage(code) {
    switch (code) {
      case 'INDISPONIVEL': return 'O armazenamento do navegador não está disponível (navegação privada ou bloqueio de dados de sites). As respostas não serão salvas se a página for fechada.';
      case 'SEM_ESPACO': return 'Não foi possível salvar: o espaço de armazenamento do navegador está cheio. Exporte os dados e remova avaliações antigas.';
      case 'CORROMPIDO': return 'Os dados salvos neste navegador estão ilegíveis e não puderam ser recuperados.';
      case 'FALHA_GRAVACAO': return 'Não foi possível salvar no navegador. Exporte os dados para não perdê-los.';
      default: return 'Erro de armazenamento.';
    }
  }

  return {
    DEFAULT_KEY: DEFAULT_KEY,
    ETAPAS: ETAPAS,
    createStore: createStore,
    memoryStorage: memoryStorage,
    normalizeEvaluation: normalizeEvaluation,
    errorMessage: errorMessage,
    emptyData: emptyData
  };
});
