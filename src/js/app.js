/*
 * app.js — Interface do Sistema NASA-TLX (LUMIA).
 * Depende de TLXAssets, TLXCore, TLXStorage e TLXExport (carregados antes).
 */
(function () {
  'use strict';
  var T = window.TLXCore, S = window.TLXStorage, X = window.TLXExport, A = window.TLXAssets;

  var STEPS = [
    { id: 'identificacao', nome: 'Identificação' },
    { id: 'instrucoes', nome: 'Instruções' },
    { id: 'dimensoes', nome: 'Dimensões' },
    { id: 'comparacoes', nome: 'Comparações' },
    { id: 'revisao', nome: 'Revisão' },
    { id: 'resultados', nome: 'Resultados' }
  ];

  var main = document.getElementById('conteudo');
  var store = S.createStore(safeLocalStorage());
  var data = S.emptyData();
  var view = { etapa: 'identificacao', resultado: null, erros: null };
  var saveTimer = null;
  var lastSave = { ok: null, error: null, salvoEm: null };
  var bootNotice = null;

  /* ---------- Utilidades ---------- */

  function safeLocalStorage() {
    try { return window.localStorage; } catch (e) { return null; }
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function $(sel, rootEl) { return (rootEl || document).querySelector(sel); }
  function $all(sel, rootEl) { return Array.prototype.slice.call((rootEl || document).querySelectorAll(sel)); }
  function horaBR(iso) { var m = /T(\d{2}):(\d{2})/.exec(iso || ''); return m ? m[1] + ':' + m[2] : ''; }

  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 4200);
  }
  function announce(msg) {
    var a = document.getElementById('alert');
    a.textContent = ''; setTimeout(function () { a.textContent = msg; }, 30);
  }

  /* ---------- Salvamento ---------- */

  function persist(immediate) {
    if (data.atual) data.atual.atualizadaEm = T.toLocalISO(new Date());
    clearTimeout(saveTimer);
    var run = function () {
      var r = store.save(data);
      var mudouParaErro = !r.ok && lastSave.ok !== false;
      lastSave = r;
      renderSaveStatus();
      if (mudouParaErro) announce(S.errorMessage(r.error));
    };
    if (immediate) run(); else saveTimer = setTimeout(run, 350);
  }

  function renderSaveStatus() {
    var el = document.getElementById('save-status');
    if (lastSave.ok === false) {
      el.dataset.state = 'erro';
      el.textContent = lastSave.error === 'INDISPONIVEL' ? 'Não salvo: armazenamento indisponível' :
        lastSave.error === 'SEM_ESPACO' ? 'Não salvo: armazenamento cheio' : 'Não salvo: falha ao gravar';
      el.title = S.errorMessage(lastSave.error);
    } else if (lastSave.ok) {
      el.dataset.state = 'ok';
      el.textContent = 'Salvo neste navegador às ' + horaBR(lastSave.salvoEm);
      el.title = 'Os dados ficam apenas neste navegador e perfil.';
    } else {
      el.dataset.state = 'idle';
      el.textContent = 'Nada a salvar ainda';
    }
  }

  /* ---------- Downloads ---------- */

  var downloadsPromise = null;
  function getDownloads() {
    if (!downloadsPromise) {
      downloadsPromise = (window.claude && typeof window.claude.use === 'function')
        ? Promise.resolve(window.claude.use('downloads')).catch(function () { return null; })
        : Promise.resolve(null);
    }
    return downloadsPromise;
  }

  /** Entrega um arquivo ao usuário. Retorna Promise<boolean>. */
  function offerFile(filename, content, mime) {
    return getDownloads().then(function (dl) {
      if (dl) {
        return dl.save({ filename: filename, data: content }).then(function () { return true; }, function (err) {
          var code = err && err.code;
          if (code === 'declined') { toast('Download cancelado.'); return false; }
          if (code === 'rate_limited') { toast('Já existe um download aguardando confirmação.'); return false; }
          throw new Error('Não foi possível baixar o arquivo (' + (code || 'erro') + ').');
        });
      }
      var blob = new Blob([content], { type: mime });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      return true;
    });
  }

  function withBusy(btn, fn) {
    if (btn.getAttribute('aria-busy') === 'true') return;
    btn.setAttribute('aria-busy', 'true');
    var label = btn.textContent;
    Promise.resolve().then(function () {
      return new Promise(function (r) { setTimeout(r, 20); }); // permite pintar o estado de carregamento
    }).then(fn).then(function (ok) {
      if (ok) toast('Arquivo gerado: verifique seus downloads.');
    }).catch(function (e) {
      toast(e.message || 'Falha ao gerar o arquivo.');
      announce(e.message || 'Falha ao gerar o arquivo.');
    }).then(function () { btn.removeAttribute('aria-busy'); btn.textContent = label; });
  }

  function downloadPDF(ev, btn) {
    withBusy(btn, function () {
      var bytes = X.buildReportPDF(ev, A.pdfHeader);
      return offerFile(X.fileName(ev, 'pdf'), bytes, 'application/pdf');
    });
  }
  function downloadCSV(list, btn, name) {
    withBusy(btn, function () {
      var csv = X.buildCSV(list);
      return offerFile(name, csv, 'text/csv;charset=utf-8');
    });
  }
  function downloadPartialJSON(btn) {
    withBusy(btn, function () {
      var ev = data.atual;
      var payload = JSON.stringify({ aviso: 'Avaliação NASA-TLX não concluída, exportada antes da remoção dos dados locais.', avaliacao: ev }, null, 2);
      return offerFile('nasa-tlx_' + ev.codigo + '_em-andamento.json', payload, 'application/json');
    });
  }

  /* ---------- Diálogo de confirmação ---------- */

  /**
   * opts: { titulo, texto(html), confirmar, perigo, extras: [{label, onClick}] }
   * Retorna Promise<boolean>.
   */
  function confirmDialog(opts) {
    var dlg = document.getElementById('dialog');
    $('#dialog-title').textContent = opts.titulo;
    $('#dialog-text').innerHTML = opts.texto;
    var acts = $('#dialog-actions');
    acts.innerHTML = '';
    var extraGroup = document.createElement('div'); extraGroup.className = 'actions__group';
    (opts.extras || []).forEach(function (ex) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'btn btn--small'; b.textContent = ex.label;
      b.addEventListener('click', function () { ex.onClick(b); });
      extraGroup.appendChild(b);
    });
    acts.appendChild(extraGroup);
    var g = document.createElement('div'); g.className = 'actions__group';
    g.innerHTML = '<button type="submit" class="btn" value="cancelar">Cancelar</button>' +
      '<button type="submit" class="btn ' + (opts.perigo ? 'btn--danger' : 'btn--primary') + '" value="ok">' + esc(opts.confirmar) + '</button>';
    acts.appendChild(g);
    return new Promise(function (resolve) {
      var prevFocus = document.activeElement;
      dlg.returnValue = '';
      dlg.addEventListener('close', function onClose() {
        dlg.removeEventListener('close', onClose);
        if (prevFocus && document.contains(prevFocus)) prevFocus.focus();
        resolve(dlg.returnValue === 'ok');
      });
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else { dlg.setAttribute('open', ''); }
      var cancel = g.querySelector('[value="cancelar"]');
      cancel.focus();
    });
  }

  /* ---------- Navegação ---------- */

  function goTo(etapa, opts) {
    opts = opts || {};
    view.etapa = etapa;
    view.erros = null;
    if (data.atual && etapa !== 'resultados') {
      data.atual.etapa = etapa;
      // Uma avaliação vazia na identificação não é gravada: assim, remover os dados locais não os recria.
      if (hasProgress(data.atual) || etapa !== 'identificacao') persist(true);
    }
    render();
    window.scrollTo(0, 0);
    var focusEl = opts.focus ? document.getElementById(opts.focus) : $('#titulo-etapa');
    if (focusEl) {
      if (opts.focus) focusEl.scrollIntoView({ block: 'center' });
      focusEl.focus({ preventScroll: !!opts.focus });
    }
  }

  function renderSteps() {
    var idx = STEPS.findIndex(function (s) { return s.id === view.etapa; });
    $all('#steps li').forEach(function (li, i) {
      li.removeAttribute('aria-current');
      li.dataset.state = i < idx ? 'done' : 'todo';
      if (i === idx) li.setAttribute('aria-current', 'step');
      var label = li.querySelector('.steps__label');
      var extra = i < idx ? ' (concluída)' : '';
      li.setAttribute('aria-label', STEPS[i].nome + extra);
      label.textContent = STEPS[i].nome;
    });
  }

  function stepEyebrow() {
    var idx = STEPS.findIndex(function (s) { return s.id === view.etapa; });
    return 'Etapa ' + (idx + 1) + ' de ' + STEPS.length + ' · ' + STEPS[idx].nome;
  }

  function render() {
    renderSteps();
    var html = '';
    switch (view.etapa) {
      case 'identificacao': html = viewIdentificacao(); break;
      case 'instrucoes': html = viewInstrucoes(); break;
      case 'dimensoes': html = viewDimensoes(); break;
      case 'comparacoes': html = viewComparacoes(); break;
      case 'revisao': html = viewRevisao(); break;
      case 'resultados': html = viewResultados(); break;
    }
    main.innerHTML = html;
    if (view.etapa === 'dimensoes') initScales();
    document.title = (STEPS.find(function (s) { return s.id === view.etapa; }) || {}).nome + ' · NASA-TLX LUMIA';
  }

  function headerBlock(titulo, lede) {
    return '<header class="stack-sm"><p class="eyebrow">' + esc(stepEyebrow()) + '</p>' +
      '<h1 class="h1" id="titulo-etapa" tabindex="-1">' + esc(titulo) + '</h1>' +
      (lede ? '<p class="lede">' + lede + '</p>' : '') + '</header>';
  }

  function bootNoticeHtml() {
    if (!bootNotice) return '';
    var n = bootNotice; bootNotice = null;
    return n;
  }

  /* ---------- Etapa 1: Identificação ---------- */

  function viewIdentificacao() {
    var ev = data.atual, m = ev.meta;
    var err = view.erros && view.erros.tarefa;
    var h = headerBlock('Avaliação de carga de trabalho',
      'NASA-TLX · Índice de Carga de Trabalho da NASA. Identifique a tarefa que o participante vai realizar. Cada avaliação se refere a uma única tarefa ou condição.');
    h += bootNoticeHtml();
    h += '<div class="notice notice--info"><h2>Privacidade</h2><p>As respostas ficam salvas apenas neste navegador e perfil. Nada é enviado pela internet. Não informe nome completo, CPF, e-mail ou outros dados pessoais; use um código para o participante.</p></div>';
    h += '<form id="form-id" class="card" novalidate>' +
      '<h2 class="h2">Identificação da avaliação</h2>' +
      '<div class="grid-2">' +
      field('f-tarefa', 'tarefa', 'Nome ou descrição da tarefa', m.tarefa, { required: true, full: true, textarea: false, err: err, hint: 'Exemplo: "Agendar uma consulta no aplicativo, versão com menu lateral".' }) +
      field('f-codigo', null, 'Código da avaliação', ev.codigo, { readonly: true, hint: 'Gerado automaticamente.' }) +
      field('f-data', null, 'Data e hora da avaliação', T.formatDateTimeBR(ev.criadaEm), { readonly: true, hint: 'Registradas automaticamente.' }) +
      field('f-participante', 'participante', 'Código do participante', m.participante, { optional: true, hint: 'Exemplo: P07. Não use o nome.', autocomplete: 'off' }) +
      field('f-sistema', 'sistema', 'Sistema, equipamento ou aplicação avaliada', m.sistema, { optional: true }) +
      field('f-versao', 'versaoSistema', 'Versão do sistema avaliado', m.versaoSistema, { optional: true }) +
      field('f-obs', 'observacoes', 'Observações do avaliador', m.observacoes, { optional: true, full: true, textarea: true, hint: 'Condições da sessão, interrupções, observações relevantes.' }) +
      '</div>' +
      '<div class="actions"><div class="actions__group">' +
      '<button type="button" class="btn btn--danger" data-action="descartar">Descartar avaliação</button></div>' +
      '<div class="actions__group"><button type="submit" class="btn btn--primary">Continuar para as instruções</button></div></div>' +
      '</form>';
    h += historyBlock();
    return h;
  }

  function field(id, key, label, value, o) {
    o = o || {};
    var cls = 'field' + (o.full ? ' field--full' : '') + (o.err ? ' field--error' : '');
    var describedby = [];
    if (o.hint) describedby.push(id + '-hint');
    if (o.err) describedby.push(id + '-err');
    var attrs = ' id="' + id + '" name="' + (key || id) + '"' +
      (key ? ' data-meta="' + key + '"' : '') +
      (o.readonly ? ' readonly' : '') +
      (o.required ? ' required aria-required="true"' : '') +
      (o.err ? ' aria-invalid="true"' : '') +
      (describedby.length ? ' aria-describedby="' + describedby.join(' ') + '"' : '') +
      (o.autocomplete ? ' autocomplete="' + o.autocomplete + '"' : '') + ' maxlength="' + (o.textarea ? 2000 : 300) + '"';
    var input = o.textarea ? '<textarea' + attrs + '>' + esc(value) + '</textarea>' : '<input type="text"' + attrs + ' value="' + esc(value) + '">';
    return '<div class="' + cls + '"><label for="' + id + '">' + esc(label) +
      (o.required ? ' <span class="optional">(obrigatório)</span>' : '') +
      (o.optional ? ' <span class="optional">(opcional)</span>' : '') + '</label>' +
      input +
      (o.hint ? '<span class="field__hint" id="' + id + '-hint">' + esc(o.hint) + '</span>' : '') +
      (o.err ? '<span class="field__err" id="' + id + '-err">' + esc(o.err) + '</span>' : '') +
      '</div>';
  }

  function historyBlock() {
    var list = data.concluidas;
    var h = '<section class="section" aria-labelledby="h-hist"><h2 class="h2" id="h-hist">Avaliações concluídas neste navegador</h2>';
    if (!list.length) {
      h += '<p class="muted">Nenhuma avaliação concluída ainda. Ao concluir, os resultados ficam guardados aqui para consulta e exportação até você removê-los.</p>';
    } else {
      h += '<ul class="history">' + list.slice().reverse().map(function (ev) {
        return '<li><div class="history__main"><span class="history__title">' + esc(ev.meta.tarefa) + '</span>' +
          '<span class="small muted"><span class="data">' + esc(ev.codigo) + '</span>' +
          (ev.meta.participante ? ' · participante ' + esc(ev.meta.participante) : '') + ' · ' + esc(T.formatDateTimeBR(ev.concluidaEm)) +
          ' · ponderado <span class="data">' + T.formatScore(ev.resultado.ponderado) + '</span></span></div>' +
          '<div class="actions__group"><button type="button" class="btn btn--small" data-action="ver" data-codigo="' + esc(ev.codigo) + '">Ver resultados<span class="sr-only"> de ' + esc(ev.codigo) + '</span></button>' +
          '<button type="button" class="btn btn--small btn--danger" data-action="remover" data-codigo="' + esc(ev.codigo) + '">Remover<span class="sr-only"> ' + esc(ev.codigo) + '</span></button></div></li>';
      }).join('') + '</ul>';
      h += '<div class="actions__group"><button type="button" class="btn" data-action="csv-todas">Exportar todas em CSV (' + list.length + ')</button></div>';
    }
    h += '<div class="notice"><h3>Dados locais</h3><p class="small">Os dados permanecem neste navegador até serem removidos. Eles podem se perder se o histórico do navegador for limpo, em navegação privada ou ao trocar de dispositivo; exporte o que precisar guardar.</p>' +
      '<div><button type="button" class="btn btn--small btn--danger" data-action="limpar-tudo">Remover todos os dados locais</button></div></div>';
    h += '</section>';
    return h;
  }

  /* ---------- Etapa 2: Instruções ---------- */

  function viewInstrucoes() {
    var m = data.atual.meta;
    var h = headerBlock('Instruções para o participante', 'Avaliador: entregue o dispositivo ao participante depois que ele terminar a tarefa.');
    h += '<div class="card"><dl class="meta-list"><dt>Tarefa avaliada</dt><dd>' + esc(m.tarefa) + '</dd>' +
      (m.participante ? '<dt>Participante</dt><dd class="data">' + esc(m.participante) + '</dd>' : '') + '</dl></div>';
    h += '<div class="notice notice--quote"><p>' + esc(T.INSTRUCTION) + '</p></div>';
    h += '<div class="card"><h2 class="h2">Como responder</h2><ol class="stack-sm" style="margin:0;padding-left:1.2rem">' +
      '<li><strong>Seis escalas.</strong> Para cada dimensão, escolha um valor de 0 a 100, de 5 em 5. Leia os extremos de cada escala: na escala <strong>Desempenho</strong>, 0 significa bom desempenho e 100 significa mau desempenho.</li>' +
      '<li><strong>Quinze comparações.</strong> Em cada par de dimensões, escolha a que mais contribuiu para a sua carga de trabalho nesta tarefa.</li>' +
      '<li><strong>Revisão.</strong> Confira as respostas antes de concluir. Você pode voltar e alterar qualquer resposta.</li></ol></div>';
    h += '<div class="actions"><button type="button" class="btn" data-goto="identificacao">Voltar</button>' +
      '<button type="button" class="btn btn--primary" data-goto="dimensoes">Começar a avaliação</button></div>';
    return h;
  }

  /* ---------- Etapa 3: Dimensões ---------- */

  function viewDimensoes() {
    var av = data.atual.avaliacoes;
    var feitas = T.DIM_IDS.filter(function (id) { return av[id] !== null; }).length;
    var h = headerBlock('Avaliação das seis dimensões',
      'Tarefa: <strong>' + esc(data.atual.meta.tarefa) + '</strong>. Avalie cada dimensão separadamente. Use o controle deslizante, as setas do teclado ou os botões − e +.');
    h += errorSummary();
    h += '<div class="progress sticky-progress" id="prog-dim"><span class="progress__text"><strong id="prog-dim-n">' + feitas + '</strong> de 6 avaliadas</span>' +
      '<span class="meter" aria-hidden="true"><span style="--pct:' + (feitas / 6 * 100) + '%"></span></span></div>';
    T.DIMENSIONS.forEach(function (d) {
      var v = av[d.id], empty = v === null;
      var missing = view.erros && view.erros.dims && view.erros.dims.indexOf(d.id) >= 0;
      h += '<section class="card dim' + (missing ? ' is-missing' : '') + '" id="card-' + d.id + '" aria-labelledby="t-' + d.id + '">' +
        '<div class="dim__head"><h2 class="dim__title" id="t-' + d.id + '">' + esc(d.nome) + '</h2>' +
        '<span class="dim__value" id="v-' + d.id + '" data-empty="' + empty + '">' + (empty ? 'Sem resposta' : 'Valor: ' + v) + '</span></div>' +
        '<p class="dim__question" id="q-' + d.id + '">' + esc(d.pergunta) + '</p>' +
        (d.orientacaoInvertida ? '<p class="dim__flag" id="flag-' + d.id + '"><strong>Atenção:</strong> nesta escala, 0 significa bom desempenho e 100 significa mau desempenho.</p>' : '') +
        (missing ? '<p class="field__err" id="err-' + d.id + '">Escolha um valor para ' + esc(d.nome) + '.</p>' : '') +
        scaleHtml(d, v) + '</section>';
    });
    h += '<div class="actions"><button type="button" class="btn" data-goto="instrucoes">Voltar</button>' +
      '<button type="button" class="btn btn--primary" data-action="ir-comparacoes">Continuar para as comparações</button></div>';
    return h;
  }

  function scaleHtml(d, v) {
    var empty = v === null;
    var ticks = '', nums = '';
    for (var t = 0; t <= 100; t += 5) {
      var cls = t === 50 ? 'mid' : (t % 10 === 0 ? 'major' : '');
      ticks += '<span class="' + cls + '" style="left:' + t + '%"></span>';
      if (t % 10 === 0) nums += '<span class="' + (t % 50 === 0 ? '' : 'n-minor') + '" style="left:' + t + '%">' + t + '</span>';
    }
    var desc = 'q-' + d.id + ' a-' + d.id + (d.orientacaoInvertida ? ' flag-' + d.id : '');
    return '<div class="scale' + (empty ? ' is-empty' : '') + '" data-dim="' + d.id + '" style="--pct:' + (empty ? 0 : v) + '%">' +
      '<div class="scale__row">' +
      '<button type="button" class="scale__step" data-step="-5" aria-label="Diminuir ' + esc(d.nome) + ' em 5" aria-controls="r-' + d.id + '">−</button>' +
      '<div class="scale__control"><div class="scale__track"><div class="scale__fill"></div></div><div class="scale__ticks" aria-hidden="true">' + ticks + '</div>' +
      '<input type="range" id="r-' + d.id + '" min="0" max="100" step="5" value="' + (empty ? 50 : v) + '" aria-labelledby="t-' + d.id + '" aria-describedby="' + desc + '"' +
      ' aria-valuetext="' + esc(valueText(d, v)) + '"></div>' +
      '<button type="button" class="scale__step" data-step="5" aria-label="Aumentar ' + esc(d.nome) + ' em 5" aria-controls="r-' + d.id + '">+</button>' +
      '</div>' +
      '<div class="scale__numbers" aria-hidden="true"><div class="scale__numbers-inner">' + nums + '</div></div>' +
      '<p class="scale__anchors" id="a-' + d.id + '"><span><b>0</b> — ' + esc(d.ancoraMin) + '</span><span><b>100</b> — ' + esc(d.ancoraMax) + '</span></p>' +
      '</div>';
  }

  function valueText(d, v) {
    if (v === null || v === undefined) return 'Sem resposta';
    var extra = v === 0 ? ' — ' + d.ancoraMin : v === 100 ? ' — ' + d.ancoraMax : '';
    return v + ' de 100' + extra;
  }

  function initScales() {
    $all('.scale').forEach(function (sc) {
      var id = sc.dataset.dim, d = T.DIM_BY_ID[id];
      var input = sc.querySelector('input[type=range]');
      function setValue(v, announceIt) {
        v = Math.max(0, Math.min(100, Math.round(v / 5) * 5));
        input.value = v;
        data.atual.avaliacoes[id] = v;
        sc.classList.remove('is-empty');
        sc.style.setProperty('--pct', v + '%');
        input.setAttribute('aria-valuetext', valueText(d, v));
        var chip = document.getElementById('v-' + id);
        chip.textContent = 'Valor: ' + v; chip.dataset.empty = 'false';
        var card = document.getElementById('card-' + id);
        if (card.classList.contains('is-missing')) {
          card.classList.remove('is-missing');
          var e = document.getElementById('err-' + id); if (e) e.remove();
        }
        updateDimProgress();
        persist(false);
        if (announceIt) announce(d.nome + ': ' + valueText(d, v));
      }
      input.addEventListener('input', function () { setValue(Number(input.value)); });
      input.addEventListener('change', function () { setValue(Number(input.value)); });
      // Clique no ponto em que o controle já está (50) ainda conta como resposta.
      input.addEventListener('pointerup', function () { if (sc.classList.contains('is-empty')) setValue(Number(input.value)); });
      sc.querySelectorAll('.scale__step').forEach(function (b) {
        b.addEventListener('click', function () {
          var cur = data.atual.avaliacoes[id];
          var base = cur === null ? 50 : cur;
          setValue(base + Number(b.dataset.step), true);
        });
      });
    });
  }

  function updateDimProgress() {
    var av = data.atual.avaliacoes;
    var n = T.DIM_IDS.filter(function (id) { return av[id] !== null; }).length;
    var el = document.getElementById('prog-dim-n'); if (el) el.textContent = n;
    var m = $('#prog-dim .meter > span'); if (m) m.style.setProperty('--pct', (n / 6 * 100) + '%');
  }

  function errorSummary() {
    var e = view.erros;
    if (!e || !e.lista || !e.lista.length) return '';
    return '<div class="notice notice--error" id="resumo-erros" tabindex="-1" role="alert"><h2>' + esc(e.titulo) + '</h2><ul>' +
      e.lista.map(function (it) { return '<li><a href="#' + it.alvo + '" data-focus="' + it.alvo + '">' + esc(it.texto) + '</a></li>'; }).join('') +
      '</ul></div>';
  }

  /* ---------- Etapa 4: Comparações ---------- */

  function viewComparacoes() {
    var cp = data.atual.comparacoes;
    var chk = T.checkChoices(cp);
    var h = headerBlock('Comparação entre pares de dimensões',
      'Tarefa: <strong>' + esc(data.atual.meta.tarefa) + '</strong>. São 15 pares. Em cada um, escolha uma única dimensão.');
    h += '<div class="notice notice--quote"><p>' + esc(T.PAIR_QUESTION) + '</p></div>';
    h += errorSummary();
    h += '<div class="progress sticky-progress" id="prog-cmp"><span class="progress__text"><strong id="prog-cmp-n">' + chk.respondidas + '</strong> de 15 respondidas</span>' +
      '<span class="meter" aria-hidden="true"><span style="--pct:' + (chk.respondidas / 15 * 100) + '%"></span></span></div>';
    T.PAIRS.forEach(function (p) {
      var missing = view.erros && view.erros.pares && view.erros.pares.indexOf(p.id) >= 0;
      h += '<fieldset class="pair' + (missing ? ' is-missing' : '') + '" id="fs-' + p.id + '">' +
        '<legend><span class="chip">' + p.numero + ' de 15</span><span>' + esc(T.nomeDim(p.a)) + ' ou ' + esc(T.nomeDim(p.b)) + '?</span></legend>' +
        (missing ? '<p class="field__err" id="err-' + p.id + '">Escolha uma das duas dimensões.</p>' : '') +
        '<div class="pair__opts">' + optHtml(p, p.a, cp[p.id]) + '<span class="pair__or" aria-hidden="true">ou</span>' + optHtml(p, p.b, cp[p.id]) + '</div>' +
        '</fieldset>';
    });
    h += '<div class="actions"><button type="button" class="btn" data-goto="dimensoes">Voltar às dimensões</button>' +
      '<button type="button" class="btn btn--primary" data-action="ir-revisao">Revisar respostas</button></div>';
    return h;
  }

  function optHtml(p, dimId, chosen) {
    var d = T.DIM_BY_ID[dimId], id = 'o-' + p.id + '-' + dimId, checked = chosen === dimId;
    return '<label class="opt' + (checked ? ' is-checked' : '') + '" for="' + id + '">' +
      '<input type="radio" id="' + id + '" name="' + p.id + '" value="' + dimId + '"' + (checked ? ' checked' : '') + ' aria-describedby="d-' + id + '">' +
      '<span class="opt__mark" aria-hidden="true"></span>' +
      '<span class="opt__text"><span class="opt__name">' + esc(d.nome) + '</span><span class="opt__def" id="d-' + id + '">' + esc(d.resumo) + '</span></span>' +
      '<span class="opt__state" aria-hidden="true">Escolhida</span></label>';
  }

  /* ---------- Etapa 5: Revisão ---------- */

  function viewRevisao() {
    var ev = data.atual, av = ev.avaliacoes, cp = ev.comparacoes;
    var rc = T.checkRatings(av), cc = T.checkChoices(cp);
    var h = headerBlock('Revisão das respostas', 'Confira as respostas. Para alterar, use o botão Alterar ao lado do item.');
    h += errorSummary();
    if (!rc.ok || !cc.ok) {
      h += '<div class="notice notice--error"><h2>Avaliação incompleta</h2><p>' +
        (rc.ausentes.length ? 'Dimensões sem avaliação: ' + esc(rc.ausentes.map(T.nomeDim).join(', ')) + '. ' : '') +
        (cc.pendentes.length ? 'Comparações sem resposta: ' + cc.pendentes.length + '.' : '') +
        ' O resultado só é calculado com todas as respostas.</p></div>';
    }
    h += '<div class="card"><h2 class="h2">Identificação</h2><dl class="meta-list">' +
      '<dt>Tarefa</dt><dd>' + esc(ev.meta.tarefa) + '</dd><dt>Código</dt><dd class="data">' + esc(ev.codigo) + '</dd>' +
      (ev.meta.participante ? '<dt>Participante</dt><dd class="data">' + esc(ev.meta.participante) + '</dd>' : '') +
      (ev.meta.sistema ? '<dt>Sistema</dt><dd>' + esc(ev.meta.sistema) + (ev.meta.versaoSistema ? ' (versão ' + esc(ev.meta.versaoSistema) + ')' : '') + '</dd>' : '') +
      '</dl><div><button type="button" class="btn btn--small" data-goto="identificacao">Alterar identificação</button></div></div>';
    h += '<div class="card"><h2 class="h2">Avaliações das dimensões</h2><ul class="review-list">' +
      T.DIMENSIONS.map(function (d) {
        var v = av[d.id];
        return '<li><span><strong>' + esc(d.nome) + '</strong><br><span class="small muted">0 = ' + esc(d.ancoraMin) + ' · 100 = ' + esc(d.ancoraMax) + '</span></span>' +
          '<span class="actions__group" style="align-items:center">' + (v === null ? '<span class="tag-missing">Sem resposta</span>' : '<span class="val">' + v + '</span>') +
          '<button type="button" class="btn btn--small" data-goto="dimensoes" data-focus-target="r-' + d.id + '">Alterar<span class="sr-only"> ' + esc(d.nome) + '</span></button></span></li>';
      }).join('') + '</ul></div>';
    h += '<div class="card"><h2 class="h2">Comparações</h2><ul class="review-list">' +
      T.PAIRS.map(function (p) {
        var c = cp[p.id];
        return '<li><span><span class="chip">' + p.numero + '</span> ' + esc(T.nomeDim(p.a)) + ' × ' + esc(T.nomeDim(p.b)) + '</span>' +
          '<span class="actions__group" style="align-items:center">' + (c ? '<strong>' + esc(T.nomeDim(c)) + '</strong>' : '<span class="tag-missing">Sem resposta</span>') +
          '<button type="button" class="btn btn--small" data-goto="comparacoes" data-focus-target="fs-' + p.id + '">Alterar<span class="sr-only"> comparação ' + p.numero + '</span></button></span></li>';
      }).join('') + '</ul></div>';
    h += '<div class="actions"><button type="button" class="btn" data-goto="comparacoes">Voltar</button>' +
      '<button type="button" class="btn btn--primary" data-action="concluir">Concluir e calcular</button></div>';
    return h;
  }

  /* ---------- Etapa 6: Resultados ---------- */

  function viewResultados() {
    var ev = data.concluidas.find(function (e) { return e.codigo === view.resultado; });
    if (!ev) { return headerBlock('Resultado não encontrado') + '<p>Esta avaliação não está mais salva neste navegador.</p><div class="actions"><button class="btn" type="button" data-action="nova">Iniciar nova avaliação</button></div>'; }
    var r = ev.resultado, m = ev.meta;
    var h = headerBlock('Resultados da avaliação', esc(T.INTERPRETATION_NOTE));
    h += bootNoticeHtml();
    h += '<div class="card"><dl class="meta-list">' +
      '<dt>Tarefa</dt><dd>' + esc(m.tarefa) + '</dd>' +
      '<dt>Código da avaliação</dt><dd class="data">' + esc(ev.codigo) + '</dd>' +
      '<dt>Participante</dt><dd' + (m.participante ? ' class="data">' + esc(m.participante) : '>Não informado') + '</dd>' +
      (m.sistema ? '<dt>Sistema avaliado</dt><dd>' + esc(m.sistema) + (m.versaoSistema ? ' · versão ' + esc(m.versaoSistema) : '') + '</dd>' : '') +
      '<dt>Data da avaliação</dt><dd>' + esc(T.formatDateTimeBR(ev.criadaEm)) + '</dd>' +
      '<dt>Concluída em</dt><dd>' + esc(T.formatDateTimeBR(ev.concluidaEm)) + '</dd>' +
      (m.observacoes ? '<dt>Observações</dt><dd>' + esc(m.observacoes).replace(/\n/g, '<br>') + '</dd>' : '') +
      '</dl></div>';

    h += '<section class="scores" aria-label="Pontuações">' +
      scoreCard(true, 'NASA-TLX ponderado', r.ponderado, 'Pontuação do instrumento original: soma das avaliações multiplicadas pelos pesos das 15 comparações, dividida por 15.') +
      scoreCard(false, 'Raw TLX · não ponderado', r.raw, 'Média simples das seis avaliações, sem pesos. É uma pontuação alternativa e não substitui a ponderada.') +
      '</section>';

    // Exportação
    h += '<section class="card" aria-labelledby="h-exp"><h2 class="h2" id="h-exp">Exportar</h2>' +
      '<p class="small muted">Os arquivos são gerados neste navegador a partir das respostas registradas.</p>' +
      '<div class="actions__group">' +
      '<button type="button" class="btn btn--primary" data-action="pdf" data-codigo="' + esc(ev.codigo) + '">Baixar relatório PDF</button>' +
      '<button type="button" class="btn" data-action="csv" data-codigo="' + esc(ev.codigo) + '">Exportar CSV desta avaliação</button>' +
      (data.concluidas.length > 1 ? '<button type="button" class="btn" data-action="csv-todas">Exportar CSV de todas (' + data.concluidas.length + ')</button>' : '') +
      '</div></section>';

    // Gráfico
    var resumoGrafico = r.porDimensao.map(function (d) { return d.nome + ': intensidade ' + d.intensidade + ' de 100, peso ' + d.peso + ' de 5'; }).join('; ') + '.';
    h += '<section class="section" aria-labelledby="h-graf"><h2 class="h2" id="h-graf">Intensidade e peso por dimensão</h2>' +
      '<p class="small muted">Intensidade é o valor atribuído na escala. Peso é quantas vezes a dimensão foi escolhida nas comparações. São medidas diferentes: uma dimensão pode ter intensidade alta e peso baixo, ou o contrário.</p>' +
      '<div class="chart__legend" aria-hidden="true"><span><i class="sw-bar"></i>Intensidade (0 a 100)</span><span><i class="sw-pip"></i>Peso (0 a 5)</span></div>' +
      '<figure class="card chart" style="margin:0" role="img" aria-label="Gráfico de barras. ' + esc(resumoGrafico) + ' Os mesmos valores estão na tabela abaixo.">' +
      '<div class="chart__head" aria-hidden="true"><span>Dimensão</span><span class="chart__axis"><span style="left:0">0</span><span style="left:25%">25</span><span style="left:50%">50</span><span style="left:75%">75</span><span style="left:100%">100</span></span><span></span><span>Peso</span></div>' +
      r.porDimensao.map(function (d) {
        var pips = '';
        for (var k = 0; k < 5; k++) pips += '<i class="' + (k < d.peso ? 'on' : '') + '"></i>';
        return '<div class="chart__row" aria-hidden="true"><span class="chart__name">' + esc(d.nome) + '</span>' +
          '<span class="chart__bar" title="Intensidade ' + d.intensidade + '"><span style="--pct:' + d.intensidade + '%"></span></span>' +
          '<span class="chart__num">' + d.intensidade + '</span>' +
          '<span class="pips" title="Peso ' + d.peso + ' de 5">' + pips + '<b>' + d.peso + '/5</b></span></div>';
      }).join('') + '</figure></section>';

    // Tabela
    var somaInt = 0, somaProd = 0;
    r.porDimensao.forEach(function (d) { somaInt += d.intensidade; somaProd += d.produto; });
    h += '<section class="section" aria-labelledby="h-tab"><h2 class="h2" id="h-tab">Valores, pesos e contribuições</h2>' +
      '<div class="table-wrap" tabindex="0" role="region" aria-labelledby="h-tab"><table>' +
      '<caption class="sr-only">Intensidade, peso, produto e contribuição de cada dimensão para o NASA-TLX ponderado</caption>' +
      '<thead><tr><th scope="col">Dimensão</th><th scope="col">Intensidade<br>(0–100)</th><th scope="col">Peso<br>(0–5)</th><th scope="col">Intensidade<br>× peso</th><th scope="col">Contribuição<br>(÷ 15)</th><th scope="col">% do<br>ponderado</th></tr></thead><tbody>' +
      r.porDimensao.map(function (d) {
        return '<tr><th scope="row" style="font-weight:600">' + esc(d.nome) + '</th><td class="num">' + d.intensidade + '</td><td class="num">' + d.peso + '</td><td class="num">' + d.produto +
          '</td><td class="num">' + T.formatScore(d.contribuicao) + '</td><td class="num">' + T.formatScore(d.percentual) + '%</td></tr>';
      }).join('') + '</tbody><tfoot><tr><th scope="row">Total</th><td class="num">' + somaInt + '</td><td class="num">15</td><td class="num">' + somaProd +
      '</td><td class="num">' + T.formatScore(r.ponderado) + '</td><td class="num">100%</td></tr></tfoot></table></div>' +
      '<p class="small muted">Na dimensão Desempenho, 0 = bom desempenho e 100 = mau desempenho (orientação original, sem inversão). Valores exibidos com no máximo uma casa decimal; os cálculos usam os valores completos.</p></section>';

    // Comparações
    h += '<section class="section" aria-labelledby="h-cmp"><h2 class="h2" id="h-cmp">Escolhas nas 15 comparações</h2>' +
      '<div class="table-wrap" tabindex="0" role="region" aria-labelledby="h-cmp"><table><thead><tr><th scope="col">Nº</th><th scope="col" style="text-align:left">Par</th><th scope="col" style="text-align:left">Dimensão escolhida</th></tr></thead><tbody>' +
      T.PAIRS.map(function (p) {
        return '<tr><td class="num" style="text-align:left">' + p.numero + '</td><td style="text-align:left">' + esc(T.nomeDim(p.a)) + ' × ' + esc(T.nomeDim(p.b)) + '</td><td style="text-align:left"><strong>' + esc(T.nomeDim(ev.comparacoes[p.id])) + '</strong></td></tr>';
      }).join('') + '</tbody></table></div></section>';

    // Fórmulas
    h += '<section class="section" aria-labelledby="h-form"><h2 class="h2" id="h-form">Fórmulas utilizadas</h2><div class="formula-list">' +
      '<p><strong>Peso</strong>: número de vezes que a dimensão foi escolhida nas 15 comparações (de 0 a 5; a soma dos seis pesos é 15).</p>' +
      '<p><strong>NASA-TLX ponderado</strong></p><p class="formula">NASA-TLX = Σ (avaliação<sub>i</sub> × peso<sub>i</sub>) ÷ 15</p>' +
      '<p class="formula">(' + r.porDimensao.map(function (d) { return d.intensidade + ' × ' + d.peso; }).join(' + ') + ') ÷ 15 = ' + somaProd + ' ÷ 15 = ' + T.formatScore(r.ponderado) + '</p>' +
      '<p><strong>Raw TLX (não ponderado)</strong></p><p class="formula">Raw TLX = (soma das seis avaliações) ÷ 6 = ' + somaInt + ' ÷ 6 = ' + T.formatScore(r.raw) + '</p>' +
      '<p class="small muted">Versão do algoritmo: <span class="data">' + esc(r.versaoAlgoritmo) + '</span>. Não há classificação universal em carga baixa, moderada ou alta; compare resultados entre tarefas, condições e populações comparáveis.</p>' +
      '</div></section>';

    // Referências
    h += '<section class="section" aria-labelledby="h-ref"><h2 class="h2" id="h-ref">Referências</h2><ol class="refs">' +
      T.REFERENCES.map(function (ref) { return '<li>' + esc(ref) + '</li>'; }).join('') + '</ol>' +
      '<p class="small muted">As perguntas orientadoras desta aplicação são adaptações explicativas em português e não foram validadas. A adaptação transcultural de Ciofi-Silva et al. (2023) é uma versão diferente, testada com profissionais de saúde.</p></section>';

    h += '<div class="actions"><button type="button" class="btn" data-action="inicio">Voltar ao início</button>' +
      '<button type="button" class="btn btn--primary" data-action="nova">Iniciar nova avaliação</button></div>';
    return h;
  }

  function scoreCard(main, label, value, desc) {
    return '<div class="score' + (main ? ' score--main' : '') + '"><p class="score__label">' + esc(label) + '</p>' +
      '<p class="score__value"><b>' + T.formatScore(value) + '</b><span>de 0 a 100</span></p>' +
      '<div class="score__bar" aria-hidden="true"><span style="--pct:' + value + '%"></span></div>' +
      '<p class="score__desc">' + esc(desc) + '</p></div>';
  }

  /* ---------- Ações ---------- */

  function hasProgress(ev) {
    if (!ev) return false;
    var m = ev.meta;
    return !!(m.tarefa || m.participante || m.sistema || m.versaoSistema || m.observacoes) ||
      T.DIM_IDS.some(function (id) { return ev.avaliacoes[id] !== null; }) ||
      T.PAIRS.some(function (p) { return ev.comparacoes[p.id] !== null; });
  }

  function newEvaluation() {
    data.atual = T.createEvaluation();
    view.resultado = null;
    goTo('identificacao');
  }

  function askDiscard() {
    if (!hasProgress(data.atual)) { newEvaluation(); return; }
    confirmDialog({
      titulo: 'Descartar a avaliação em andamento?',
      texto: '<p>As respostas da avaliação <span class="data">' + esc(data.atual.codigo) + '</span> serão apagadas deste navegador. Esta ação não pode ser desfeita.</p>' +
        '<p class="small muted">Se quiser guardar as respostas parciais, baixe-as antes em JSON.</p>',
      confirmar: 'Descartar respostas', perigo: true,
      extras: [{ label: 'Baixar respostas (JSON)', onClick: downloadPartialJSON }]
    }).then(function (ok) {
      if (ok) { newEvaluation(); toast('Avaliação descartada. Uma nova avaliação foi iniciada.'); }
    });
  }

  function validateIdent() {
    syncMetaFromForm();
    if (!data.atual.meta.tarefa.trim()) {
      view.erros = { tarefa: 'Informe o nome ou a descrição da tarefa.' };
      render();
      var f = document.getElementById('f-tarefa'); f.focus();
      announce('Informe o nome ou a descrição da tarefa.');
      return false;
    }
    return true;
  }

  function syncMetaFromForm() {
    $all('[data-meta]').forEach(function (el) { data.atual.meta[el.dataset.meta] = el.value; });
  }

  function goComparacoes() {
    var c = T.checkRatings(data.atual.avaliacoes);
    if (!c.ok) {
      view.erros = {
        titulo: 'Faltam ' + c.ausentes.length + (c.ausentes.length === 1 ? ' dimensão' : ' dimensões') + ' por avaliar',
        dims: c.ausentes,
        lista: c.ausentes.map(function (id) { return { alvo: 'r-' + id, texto: T.nomeDim(id) + ': sem resposta' }; })
      };
      render();
      var s = document.getElementById('resumo-erros'); s.focus(); s.scrollIntoView({ block: 'start' });
      return;
    }
    goTo('comparacoes');
  }

  function goRevisao() {
    var c = T.checkChoices(data.atual.comparacoes);
    if (!c.ok) {
      view.erros = {
        titulo: 'Faltam ' + c.pendentes.length + ' de 15 comparações',
        pares: c.pendentes,
        lista: c.pendentes.map(function (id) {
          var p = T.PAIR_BY_ID[id];
          return { alvo: 'o-' + id + '-' + p.a, texto: 'Comparação ' + p.numero + ': ' + T.nomeDim(p.a) + ' × ' + T.nomeDim(p.b) };
        })
      };
      render();
      var s = document.getElementById('resumo-erros'); s.focus(); s.scrollIntoView({ block: 'start' });
      return;
    }
    goTo('revisao');
  }

  function conclude(btn) {
    var ev = data.atual;
    var rc = T.checkRatings(ev.avaliacoes), cc = T.checkChoices(ev.comparacoes);
    if (!ev.meta.tarefa.trim()) {
      view.erros = { titulo: 'Falta identificar a tarefa', lista: [{ alvo: 'titulo-etapa', texto: 'Volte à identificação e informe a tarefa.' }] };
      render(); document.getElementById('resumo-erros').focus(); return;
    }
    if (!rc.ok || !cc.ok) {
      var lista = rc.ausentes.map(function (id) { return { alvo: 'titulo-etapa', texto: T.nomeDim(id) + ': sem resposta' }; })
        .concat(cc.pendentes.map(function (id) { return { alvo: 'titulo-etapa', texto: 'Comparação ' + T.PAIR_BY_ID[id].numero + ': sem resposta' }; }));
      view.erros = { titulo: 'Não é possível calcular: há respostas faltando', lista: lista };
      render(); document.getElementById('resumo-erros').focus(); return;
    }
    btn.setAttribute('aria-busy', 'true');
    try {
      var fin = T.finalizeEvaluation(ev);
      data.concluidas.push(fin);
      data.atual = null;
      persist(true);
      view.resultado = fin.codigo;
      goTo('resultados');
      announce('Avaliação concluída. NASA-TLX ponderado: ' + T.formatScore(fin.resultado.ponderado) + '. Raw TLX: ' + T.formatScore(fin.resultado.raw) + '.');
    } catch (e) {
      btn.removeAttribute('aria-busy');
      view.erros = { titulo: 'Não foi possível calcular', lista: [{ alvo: 'titulo-etapa', texto: e.message }] };
      render();
    }
  }

  function removeConcluded(codigo) {
    var ev = data.concluidas.find(function (e) { return e.codigo === codigo; });
    if (!ev) return;
    confirmDialog({
      titulo: 'Remover esta avaliação?',
      texto: '<p>A avaliação <span class="data">' + esc(codigo) + '</span> (' + esc(ev.meta.tarefa) + ') será apagada deste navegador. Exporte antes se precisar dos dados.</p>',
      confirmar: 'Remover avaliação', perigo: true,
      extras: [
        { label: 'Baixar CSV', onClick: function (b) { downloadCSV([ev], b, X.fileName(ev, 'csv')); } },
        { label: 'Baixar PDF', onClick: function (b) { downloadPDF(ev, b); } }
      ]
    }).then(function (ok) {
      if (!ok) return;
      data.concluidas = data.concluidas.filter(function (e) { return e.codigo !== codigo; });
      persist(true);
      render();
      toast('Avaliação removida.');
      var h = $('#h-hist'); if (h) { h.setAttribute('tabindex', '-1'); h.focus(); }
    });
  }

  function clearAll() {
    var extras = [];
    if (data.concluidas.length) extras.push({ label: 'Exportar concluídas (CSV)', onClick: function (b) { downloadCSV(data.concluidas, b, 'nasa-tlx_avaliacoes_' + T.toLocalISO(new Date()).slice(0, 10) + '.csv'); } });
    if (hasProgress(data.atual)) extras.push({ label: 'Baixar em andamento (JSON)', onClick: downloadPartialJSON });
    confirmDialog({
      titulo: 'Remover todos os dados locais?',
      texto: '<p>Serão apagadas deste navegador ' + (data.concluidas.length ? data.concluidas.length + ' avaliação(ões) concluída(s)' : 'as avaliações concluídas') +
        (hasProgress(data.atual) ? ' e a avaliação em andamento' : '') + '. Esta ação não pode ser desfeita.</p>' +
        (extras.length ? '<p class="small muted">Exporte os dados antes, se precisar deles.</p>' : ''),
      confirmar: 'Remover tudo', perigo: true, extras: extras
    }).then(function (ok) {
      if (!ok) return;
      var r = store.clear();
      data = S.emptyData();
      data.atual = T.createEvaluation();
      if (!r.ok) announce(S.errorMessage(r.error));
      lastSave = { ok: null };
      renderSaveStatus();
      view.resultado = null;
      goTo('identificacao');
      toast('Dados locais removidos.');
    });
  }

  /* ---------- Eventos (delegação) ---------- */

  main.addEventListener('click', function (e) {
    var link = e.target.closest('a[data-focus]');
    if (link) {
      e.preventDefault();
      var tgt = document.getElementById(link.dataset.focus);
      if (tgt) { tgt.scrollIntoView({ block: 'center' }); tgt.focus({ preventScroll: true }); }
      return;
    }
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.goto) {
      if (view.etapa === 'identificacao' && b.dataset.goto !== 'identificacao' && !validateIdent()) return;
      goTo(b.dataset.goto, { focus: b.dataset.focusTarget });
      return;
    }
    var codigo = b.dataset.codigo;
    var ev = codigo ? data.concluidas.find(function (x) { return x.codigo === codigo; }) : null;
    switch (b.dataset.action) {
      case 'descartar': askDiscard(); break;
      case 'ir-comparacoes': goComparacoes(); break;
      case 'ir-revisao': goRevisao(); break;
      case 'concluir': conclude(b); break;
      case 'ver': view.resultado = codigo; goTo('resultados'); break;
      case 'remover': removeConcluded(codigo); break;
      case 'csv-todas': downloadCSV(data.concluidas, b, 'nasa-tlx_avaliacoes_' + T.toLocalISO(new Date()).slice(0, 10) + '.csv'); break;
      case 'limpar-tudo': clearAll(); break;
      case 'pdf': if (ev) downloadPDF(ev, b); break;
      case 'csv': if (ev) downloadCSV([ev], b, X.fileName(ev, 'csv')); break;
      case 'nova':
        if (hasProgress(data.atual)) { view.resultado = null; goTo(data.atual.etapa || 'identificacao'); toast('Há uma avaliação em andamento. Conclua ou descarte antes de iniciar outra.'); }
        else newEvaluation();
        break;
      case 'inicio':
        if (!data.atual) data.atual = T.createEvaluation();
        view.resultado = null; goTo('identificacao'); break;
    }
  });

  main.addEventListener('submit', function (e) {
    if (e.target.id === 'form-id') {
      e.preventDefault();
      if (validateIdent()) goTo('instrucoes');
    }
  });

  main.addEventListener('input', function (e) {
    var el = e.target;
    if (el.dataset && el.dataset.meta) {
      data.atual.meta[el.dataset.meta] = el.value;
      if (el.dataset.meta === 'tarefa' && el.value.trim() && view.erros && view.erros.tarefa) {
        view.erros = null;
        var wrap = el.closest('.field'); wrap.classList.remove('field--error');
        var err = document.getElementById('f-tarefa-err'); if (err) err.remove();
        el.removeAttribute('aria-invalid');
        el.setAttribute('aria-describedby', 'f-tarefa-hint');
      }
      persist(false);
    }
  });

  main.addEventListener('change', function (e) {
    var el = e.target;
    if (el.type === 'radio' && T.PAIR_BY_ID[el.name]) {
      data.atual.comparacoes[el.name] = el.value;
      var fs = document.getElementById('fs-' + el.name);
      fs.querySelectorAll('.opt').forEach(function (o) { o.classList.toggle('is-checked', o.querySelector('input').checked); });
      if (fs.classList.contains('is-missing')) {
        fs.classList.remove('is-missing');
        var er = document.getElementById('err-' + el.name); if (er) er.remove();
      }
      var n = T.checkChoices(data.atual.comparacoes).respondidas;
      var pn = document.getElementById('prog-cmp-n'); if (pn) pn.textContent = n;
      var m = $('#prog-cmp .meter > span'); if (m) m.style.setProperty('--pct', (n / 15 * 100) + '%');
      persist(true);
    }
  });

  window.addEventListener('pagehide', function () { if (saveTimer) { clearTimeout(saveTimer); store.save(data); } });

  /* ---------- Inicialização ---------- */

  function boot() {
    document.getElementById('logo-ufc').src = A.ufcLogo;
    document.getElementById('logo-lumia').src = A.lumiaLogoNegativo;
    var fav = document.getElementById('favicon'); if (fav) fav.href = A.favicon;
    document.getElementById('app-version').textContent = T.APP_VERSION;
    document.getElementById('alg-version').textContent = T.ALGORITHM_VERSION;

    var res = store.load();
    data = res.data;
    var notices = [];
    if (!res.ok && res.error === 'CORROMPIDO') {
      notices.push('<div class="notice notice--error"><h2>Dados salvos ilegíveis</h2><p>' + esc(S.errorMessage('CORROMPIDO')) + ' Uma nova avaliação foi iniciada; os dados antigos serão substituídos no próximo salvamento.</p></div>');
    } else if (!res.ok && res.error === 'INDISPONIVEL') {
      notices.push('<div class="notice notice--error"><h2>Salvamento indisponível</h2><p>' + esc(S.errorMessage('INDISPONIVEL')) + ' Exporte os resultados ao final.</p></div>');
      lastSave = { ok: false, error: 'INDISPONIVEL' };
    }
    if (res.avisos && res.avisos.length) {
      notices.push('<div class="notice notice--info"><h2>Alguns dados salvos foram corrigidos</h2><ul>' + res.avisos.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul></div>');
    }

    if (data.atual) {
      view.etapa = data.atual.etapa && data.atual.etapa !== 'resultados' ? data.atual.etapa : 'identificacao';
      if (hasProgress(data.atual)) {
        notices.unshift('<div class="notice notice--info" role="status"><h2>Avaliação em andamento recuperada</h2><p>A avaliação <span class="data">' + esc(data.atual.codigo) +
          '</span>' + (data.atual.meta.tarefa ? ' (' + esc(data.atual.meta.tarefa) + ')' : '') + ' foi salva em ' + esc(T.formatDateTimeBR(data.atual.atualizadaEm)) +
          '. Continue de onde parou ou descarte-a na etapa de identificação.</p></div>');
      }
      lastSave = lastSave.ok === false ? lastSave : { ok: true, salvoEm: data.salvoEm || data.atual.atualizadaEm };
    } else {
      data.atual = T.createEvaluation();
      view.etapa = 'identificacao';
    }
    bootNotice = notices.join('');
    renderSaveStatus();
    render();
    // Mostra avisos também quando a etapa recuperada não é a de identificação.
    if (bootNotice) {
      var holder = document.createElement('div');
      holder.className = 'stack';
      holder.innerHTML = bootNotice; bootNotice = null;
      var hdr = main.querySelector('header');
      hdr.insertAdjacentElement('afterend', holder);
    }
    getDownloads();
  }

  boot();
})();
