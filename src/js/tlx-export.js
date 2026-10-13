/*
 * tlx-export.js — Geração de CSV e de relatório PDF a partir dos dados preenchidos.
 *
 * O PDF é produzido por um gerador próprio e mínimo (PDF 1.4, fontes padrão
 * Helvetica e Courier com codificação WinAnsi), sem bibliotecas externas, para
 * que a aplicação funcione sem conexão. Os acentos do português estão cobertos
 * pela codificação WinAnsi (Windows-1252).
 */
(function (root, factory) {
  var isNode = typeof module === 'object' && module.exports;
  var core = isNode ? require('./tlx-core.js') : root.TLXCore;
  var api = factory(core);
  if (isNode) module.exports = api;
  else root.TLXExport = api;
})(typeof self !== 'undefined' ? self : this, function (T) {
  'use strict';

  /* =========================================================
   * CSV
   * ========================================================= */

  var CSV_SEP = ';';
  var CSV_EOL = '\r\n';
  var BOM = '﻿';

  /** Neutraliza campos que planilhas interpretariam como fórmula. */
  function neutralizeFormula(s) {
    return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  }

  function csvText(v) {
    var s = v === null || v === undefined ? '' : String(v);
    s = neutralizeFormula(s.replace(/\r\n?/g, '\n'));
    return '"' + s.replace(/"/g, '""') + '"';
  }

  /** Número com vírgula decimal (padrão pt-BR) e até 4 casas, sem zeros à direita. */
  function csvNumber(v) {
    if (typeof v !== 'number' || !isFinite(v)) return '';
    var s = (Math.round(v * 10000) / 10000).toFixed(4).replace(/\.?0+$/, '');
    return s.replace('.', ',');
  }

  function csvColumns() {
    var cols = [
      'Código da avaliação', 'Tarefa', 'Código do participante', 'Data da avaliação',
      'Sistema ou aplicação avaliada', 'Versão do sistema avaliado'
    ];
    T.DIMENSIONS.forEach(function (d) { cols.push('Intensidade ' + d.artigo + ' ' + d.nome.toLowerCase()); });
    T.DIMENSIONS.forEach(function (d) { cols.push('Peso ' + d.artigo + ' ' + d.nome.toLowerCase()); });
    cols.push('Resultado NASA-TLX ponderado', 'Resultado Raw TLX (não ponderado)', 'Versão do algoritmo de cálculo');
    T.PAIRS.forEach(function (p) {
      cols.push('Comparação ' + (p.numero < 10 ? '0' : '') + p.numero + ': ' + T.nomeDim(p.a) + ' × ' + T.nomeDim(p.b));
    });
    cols.push('Observações do avaliador', 'Concluída em', 'Versão do sistema de avaliação');
    return cols;
  }

  function csvRow(ev) {
    var r = ev.resultado;
    if (!r) throw T.TLXError('SEM_RESULTADO', 'A avaliação ' + ev.codigo + ' não foi concluída.');
    var cells = [
      csvText(ev.codigo), csvText(ev.meta.tarefa), csvText(ev.meta.participante),
      csvText(ev.criadaEm), csvText(ev.meta.sistema), csvText(ev.meta.versaoSistema)
    ];
    T.DIM_IDS.forEach(function (id) { cells.push(String(ev.avaliacoes[id])); });
    T.DIM_IDS.forEach(function (id) { cells.push(String(r.pesos[id])); });
    cells.push(csvNumber(r.ponderado), csvNumber(r.raw), csvText(r.versaoAlgoritmo));
    T.PAIRS.forEach(function (p) { cells.push(csvText(T.nomeDim(ev.comparacoes[p.id]))); });
    cells.push(csvText(ev.meta.observacoes), csvText(ev.concluidaEm), csvText('NASA-TLX LUMIA ' + T.APP_VERSION));
    return cells.join(CSV_SEP);
  }

  /** CSV com uma linha por avaliação concluída. Inclui BOM UTF-8 para o Excel reconhecer acentos. */
  function buildCSV(evaluations) {
    var lines = [csvColumns().map(csvText).join(CSV_SEP)];
    evaluations.forEach(function (ev) { lines.push(csvRow(ev)); });
    return BOM + lines.join(CSV_EOL) + CSV_EOL;
  }

  /** Leitor de CSV usado nos testes para conferir o arquivo gerado. */
  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === CSV_SEP) { row.push(cur); cur = ''; }
      else if (ch === '\r') { /* ignora */ }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  /* =========================================================
   * Gerador de PDF mínimo
   * ========================================================= */

  // Larguras AFM de Helvetica para os códigos 32–126 (1/1000 em).
  var HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556,
    556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278,
    500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556,
    500, 722, 500, 500, 500, 334, 260, 334, 584];
  // Larguras de Helvetica-Bold (32–126).
  var HELVB = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556,
    556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278,
    556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611,
    556, 778, 556, 556, 500, 389, 280, 389, 584];

  // Unicode → Windows-1252 para caracteres fora de Latin-1.
  var CP1252 = { 0x20AC: 0x80, 0x201A: 0x82, 0x201E: 0x84, 0x2026: 0x85, 0x2013: 0x96, 0x2014: 0x97,
    0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2122: 0x99 };
  var SUBST = { 0x03A3: 'Soma', 0x2264: '<=', 0x2265: '>=', 0x2212: '-', 0x2192: '->', 0x00A0: ' ' };

  /** Converte texto para bytes WinAnsi (string binária). Caracteres sem equivalente viram '?'. */
  function toWinAnsi(str) {
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (SUBST[c]) { out += SUBST[c]; continue; }
      if (c < 0x80 || (c >= 0xA0 && c <= 0xFF)) out += String.fromCharCode(c);
      else if (CP1252[c]) out += String.fromCharCode(CP1252[c]);
      else out += '?';
    }
    return out;
  }

  // Largura de um caractere WinAnsi acentuado = largura da letra-base.
  var BASE = 'AAAAAAACEEEEIIIIDNOOOOOxOUUUUYPsaaaaaaaceeeeiiiidnooooo/ouuuuypy';
  function charWidth(code, bold) {
    var tbl = bold ? HELVB : HELV;
    if (code >= 32 && code <= 126) return tbl[code - 32];
    if (code >= 0xC0 && code <= 0xFF) return tbl[BASE.charCodeAt(code - 0xC0) - 32];
    if (code === 0x97) return 1000; if (code === 0x96) return 556; if (code === 0x95) return 350;
    if (code === 0xD7) return 584; if (code === 0xB0) return 400; if (code === 0xB7) return 278;
    return 556;
  }

  function textWidth(str, size, font) {
    var s = toWinAnsi(str);
    if (font === 'mono') return s.length * 600 * size / 1000;
    var w = 0, bold = font === 'bold';
    for (var i = 0; i < s.length; i++) w += charWidth(s.charCodeAt(i), bold);
    return w * size / 1000;
  }

  function wrapText(str, size, font, maxWidth) {
    var lines = [];
    String(str).split('\n').forEach(function (para) {
      var words = para.split(/\s+/).filter(Boolean), line = '';
      if (!words.length) { lines.push(''); return; }
      words.forEach(function (w) {
        var test = line ? line + ' ' + w : w;
        if (textWidth(test, size, font) <= maxWidth || !line) line = test;
        else { lines.push(line); line = w; }
      });
      lines.push(line);
    });
    return lines;
  }

  function pdfString(str) {
    return '(' + toWinAnsi(str).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') + ')';
  }

  /** Texto para o dicionário Info em UTF-16BE (aceita qualquer caractere). */
  function pdfUnicodeString(str) {
    var hex = 'FEFF';
    for (var i = 0; i < str.length; i++) hex += ('0000' + str.charCodeAt(i).toString(16)).slice(-4).toUpperCase();
    return '<' + hex + '>';
  }

  function n(v) { return (Math.round(v * 100) / 100).toString(); }
  function rgb(hex) {
    var h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255]
      .map(function (x) { return n(x); }).join(' ');
  }

  /**
   * Documento PDF A4 com origem no canto superior esquerdo (y cresce para baixo).
   */
  function MiniPDF(opts) {
    this.W = 595.28; this.H = 841.89;
    this.pages = [];
    this.images = [];
    this.info = opts || {};
    this.addPage();
  }
  MiniPDF.prototype.addPage = function () { this.page = []; this.pages.push(this.page); return this; };
  MiniPDF.prototype.fontName = function (font) { return font === 'bold' ? 'F2' : font === 'mono' ? 'F3' : 'F1'; };
  MiniPDF.prototype.text = function (x, y, str, o) {
    o = o || {};
    var size = o.size || 10, font = o.font || 'regular';
    if (o.align === 'right') x -= textWidth(str, size, font);
    else if (o.align === 'center') x -= textWidth(str, size, font) / 2;
    this.page.push('BT /' + this.fontName(font) + ' ' + n(size) + ' Tf ' + rgb(o.color || '#1E1830') + ' rg ' +
      n(x) + ' ' + n(this.H - y) + ' Td ' + pdfString(str) + ' Tj ET');
    return this;
  };
  MiniPDF.prototype.rect = function (x, y, w, h, o) {
    o = o || {};
    var ops = [];
    if (o.fill) ops.push(rgb(o.fill) + ' rg');
    if (o.stroke) ops.push(rgb(o.stroke) + ' RG ' + n(o.lineWidth || 0.75) + ' w');
    ops.push(n(x) + ' ' + n(this.H - y - h) + ' ' + n(w) + ' ' + n(h) + ' re');
    ops.push(o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S');
    this.page.push('q ' + ops.join(' ') + ' Q');
    return this;
  };
  MiniPDF.prototype.line = function (x1, y1, x2, y2, o) {
    o = o || {};
    this.page.push('q ' + rgb(o.color || '#E4DFEE') + ' RG ' + n(o.width || 0.75) + ' w ' +
      n(x1) + ' ' + n(this.H - y1) + ' m ' + n(x2) + ' ' + n(this.H - y2) + ' l S Q');
    return this;
  };
  /** Imagem JPEG (bytes como string binária). */
  MiniPDF.prototype.jpeg = function (bin, pxW, pxH, x, y, w, h) {
    var id = 'Im' + (this.images.length + 1);
    this.images.push({ id: id, bin: bin, w: pxW, h: pxH });
    this.page.push('q ' + n(w) + ' 0 0 ' + n(h) + ' ' + n(x) + ' ' + n(this.H - y - h) + ' cm /' + id + ' Do Q');
    return this;
  };
  /** Gera o arquivo. Retorna Uint8Array. */
  MiniPDF.prototype.output = function () {
    var objs = [];  // conteúdo de cada objeto (string binária), índice = número - 1
    function add(body) { objs.push(body); return objs.length; }
    var catalog = add(null), pagesObj = add(null);
    var f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    var f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    var f3 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');
    var xobj = '';
    this.images.forEach(function (im) {
      var num = add('<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.bin.length + ' >>\nstream\n' +
        im.bin + '\nendstream');
      xobj += '/' + im.id + ' ' + num + ' 0 R ';
    });
    var resources = '<< /Font << /F1 ' + f1 + ' 0 R /F2 ' + f2 + ' 0 R /F3 ' + f3 + ' 0 R >>' +
      (xobj ? ' /XObject << ' + xobj + '>>' : '') + ' >>';
    var kids = [], self = this;
    this.pages.forEach(function (ops) {
      var stream = ops.join('\n');
      var c = add('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
      var p = add('<< /Type /Page /Parent ' + pagesObj + ' 0 R /MediaBox [0 0 ' + self.W + ' ' + self.H +
        '] /Resources ' + resources + ' /Contents ' + c + ' 0 R >>');
      kids.push(p + ' 0 R');
    });
    objs[catalog - 1] = '<< /Type /Catalog /Pages ' + pagesObj + ' 0 R /Lang (pt-BR) >>';
    objs[pagesObj - 1] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + kids.length + ' >>';
    var info = add('<< /Title ' + pdfUnicodeString(this.info.title || '') +
      ' /Author ' + pdfUnicodeString(this.info.author || '') +
      ' /Subject ' + pdfUnicodeString(this.info.subject || '') +
      ' /Creator ' + pdfUnicodeString(this.info.creator || '') +
      ' /Producer ' + pdfUnicodeString('Gerador PDF LUMIA NASA-TLX') + ' >>');

    var out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    var offsets = [];
    objs.forEach(function (body, i) {
      offsets.push(out.length);
      out += (i + 1) + ' 0 obj\n' + body + '\nendobj\n';
    });
    var xref = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    offsets.forEach(function (o) { out += ('0000000000' + o).slice(-10) + ' 00000 n \n'; });
    out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalog + ' 0 R /Info ' + info + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    var bytes = new Uint8Array(out.length);
    for (var i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xFF;
    return bytes;
  };

  function base64ToBinary(b64) {
    if (typeof atob === 'function') return atob(b64);
    return Buffer.from(b64, 'base64').toString('binary'); // Node
  }

  /* =========================================================
   * Relatório PDF
   * ========================================================= */

  var C = {
    ink: '#1E1830', muted: '#5D5672', line: '#E4DFEE', accent: '#6A3FC0', soft: '#F1EBFC',
    paper: '#F7F5FB', band: '#16112A', violet: '#A06CE0', yellow: '#F8C03C', cyan: '#1CC2DA', track: '#ECE8F4'
  };

  /**
   * Monta o relatório de uma avaliação concluída.
   * header (opcional): { width, height, base64 } — imagem JPEG da assinatura UFC + LUMIA.
   */
  function buildReportPDF(ev, header) {
    var r = ev.resultado;
    if (!r) throw T.TLXError('SEM_RESULTADO', 'A avaliação não foi concluída.');
    var titulo = 'Relatório de Avaliação de Carga de Trabalho — NASA-TLX';
    var pdf = new MiniPDF({
      title: titulo + ' — ' + ev.codigo,
      subject: 'Tarefa: ' + ev.meta.tarefa,
      author: 'LUMIA · UFC Campus Quixadá',
      creator: 'Sistema NASA-TLX LUMIA ' + T.APP_VERSION
    });
    var M = 48, W = pdf.W - 2 * M, BOTTOM = pdf.H - 60;
    var y = 0;

    function gradientLine(yy, h) {
      var steps = 80;
      for (var i = 0; i < steps; i++) {
        var t = i / (steps - 1), a, b, u;
        if (t <= 0.55) { a = C.violet; b = C.yellow; u = t / 0.55; } else { a = C.yellow; b = C.cyan; u = (t - 0.55) / 0.45; }
        pdf.rect(i * pdf.W / steps, yy, pdf.W / steps + 0.5, h, { fill: mix(a, b, u) });
      }
    }
    function pageHeader(first) {
      if (first && header) {
        var h = pdf.W * header.height / header.width;
        pdf.jpeg(base64ToBinary(header.base64), header.width, header.height, 0, 0, pdf.W, h);
        y = h + 26;
      } else {
        pdf.text(M, 34, 'LUMIA', { font: 'bold', size: 11, color: C.accent });
        pdf.text(M + textWidth('LUMIA', 11, 'bold') + 8, 34, 'Laboratório de Usabilidade, Mídias e Inteligência Artificial · UFC Campus Quixadá', { size: 8.5, color: C.muted });
        pdf.text(pdf.W - M, 34, ev.codigo, { font: 'mono', size: 8.5, color: C.muted, align: 'right' });
        gradientLine(44, 2);
        y = 70;
      }
    }
    function ensure(h) {
      if (y + h > BOTTOM) { pdf.addPage(); pageHeader(false); }
    }
    function h2(txt) {
      ensure(110); // mantém o título junto do conteúdo
      y += 10;
      pdf.text(M, y + 12, txt, { font: 'bold', size: 12.5, color: C.ink });
      y += 20;
      pdf.line(M, y, M + W, y, { color: C.line });
      y += 12;
    }
    function para(txt, o) {
      o = o || {};
      var size = o.size || 9.5, lh = size * 1.45;
      wrapText(txt, size, o.font, o.width || W).forEach(function (ln) {
        ensure(lh);
        pdf.text((o.x || M), y + size, ln, { size: size, font: o.font, color: o.color || C.ink });
        y += lh;
      });
      y += o.after === undefined ? 6 : o.after;
    }

    pageHeader(true);

    // Título
    pdf.text(M, y + 18, 'RELATÓRIO · ÍNDICE DE CARGA DE TRABALHO DA NASA', { font: 'bold', size: 7.5, color: C.accent });
    y += 26;
    wrapText(titulo, 16, 'bold', W).forEach(function (ln) { pdf.text(M, y + 16, ln, { font: 'bold', size: 16 }); y += 22; });
    y += 8;

    // Identificação
    var meta = [
      ['Tarefa avaliada', ev.meta.tarefa],
      ['Código da avaliação', ev.codigo],
      ['Código do participante', ev.meta.participante || 'Não informado'],
      ['Sistema ou aplicação', ev.meta.sistema || 'Não informado'],
      ['Versão do sistema avaliado', ev.meta.versaoSistema || 'Não informada'],
      ['Data da avaliação', T.formatDateTimeBR(ev.criadaEm)],
      ['Concluída em', T.formatDateTimeBR(ev.concluidaEm)]
    ];
    var labelW = 150;
    meta.forEach(function (row) {
      var lines = wrapText(row[1], 9.5, row[0].indexOf('Código') === 0 ? 'mono' : 'regular', W - labelW);
      ensure(lines.length * 13 + 6);
      pdf.text(M, y + 9.5, row[0].toUpperCase(), { font: 'bold', size: 7, color: C.muted });
      lines.forEach(function (ln, i) {
        pdf.text(M + labelW, y + 9.5 + i * 13, ln, { size: 9.5, font: row[0].indexOf('Código') === 0 ? 'mono' : 'regular' });
      });
      y += lines.length * 13 + 5;
      pdf.line(M, y, M + W, y, { color: C.line, width: 0.5 });
      y += 5;
    });
    y += 10;

    // Pontuações
    ensure(110);
    var bw = (W - 14) / 2, bh = 96;
    [[r.ponderado, 'NASA-TLX ponderado', 'Pontuação do instrumento original, com os pesos das 15 comparações.'],
     [r.raw, 'Raw TLX (NASA-TLX não ponderado)', 'Média simples das seis avaliações, sem pesos. Não substitui o ponderado.']]
      .forEach(function (s, i) {
        var bx = M + i * (bw + 14);
        pdf.rect(bx, y, bw, bh, { fill: i === 0 ? C.soft : '#FFFFFF', stroke: C.line });
        if (i === 0) {
          for (var k = 0; k < 40; k++) {
            var t = k / 39, col = t <= 0.55 ? mix(C.violet, C.yellow, t / 0.55) : mix(C.yellow, C.cyan, (t - 0.55) / 0.45);
            pdf.rect(bx + k * bw / 40, y, bw / 40 + 0.4, 3, { fill: col });
          }
        }
        pdf.text(bx + 12, y + 20, s[1].toUpperCase(), { font: 'bold', size: 7.5, color: i === 0 ? C.accent : C.muted });
        var val = T.formatScore(s[0]);
        pdf.text(bx + 12, y + 56, val, { font: 'bold', size: 32, color: C.ink });
        pdf.text(bx + 16 + textWidth(val, 32, 'bold'), y + 56, 'de 0 a 100', { size: 8.5, color: C.muted });
        var ly = y + 72;
        wrapText(s[2], 7.8, 'regular', bw - 24).forEach(function (ln) {
          pdf.text(bx + 12, ly, ln, { size: 7.8, color: C.muted }); ly += 10.5;
        });
      });
    y += bh + 12;
    para(T.INTERPRETATION_NOTE, { size: 9, color: C.muted });

    // Gráfico
    h2('Intensidade e peso por dimensão');
    para('Barras: intensidade atribuída (0 a 100). Quadrados: peso obtido nas comparações (0 a 5). Intensidade e peso são medidas diferentes: uma dimensão pode ter intensidade alta e peso baixo, ou o inverso.', { size: 8.5, color: C.muted });
    var nameW = 110, barX = M + nameW, barW = 220, pipX = barX + barW + 58;
    ensure(22);
    pdf.text(barX, y + 7, 'INTENSIDADE (0–100)', { font: 'bold', size: 6.8, color: C.muted });
    pdf.text(pipX, y + 7, 'PESO (0–5)', { font: 'bold', size: 6.8, color: C.muted });
    y += 14;
    // escala do eixo
    [0, 25, 50, 75, 100].forEach(function (t) {
      pdf.text(barX + barW * t / 100, y + 6, String(t), { size: 6.5, color: C.muted, align: t === 0 ? 'left' : t === 100 ? 'right' : 'center' });
    });
    y += 10;
    r.porDimensao.forEach(function (d) {
      ensure(24);
      var cy = y + 4;
      pdf.text(M, cy + 9, d.nome, { size: 9.5, font: 'bold' });
      pdf.rect(barX, cy + 1, barW, 10, { fill: C.track });
      [25, 50, 75].forEach(function (t) { pdf.line(barX + barW * t / 100, cy + 1, barX + barW * t / 100, cy + 11, { color: '#FFFFFF', width: 0.6 }); });
      if (d.intensidade > 0) pdf.rect(barX, cy + 1, barW * d.intensidade / 100, 10, { fill: C.accent });
      pdf.text(barX + barW + 8, cy + 9.5, String(d.intensidade), { font: 'mono', size: 9 });
      for (var k = 0; k < 5; k++) {
        pdf.rect(pipX + k * 13, cy + 1, 10, 10, k < d.peso ? { fill: C.ink } : { stroke: '#B9B2CC', lineWidth: 0.8 });
      }
      pdf.text(pipX + 5 * 13 + 6, cy + 9.5, d.peso + '/5', { font: 'mono', size: 9 });
      y += 22;
    });
    y += 8;

    // Tabela
    h2('Valores, pesos e contribuições');
    var cols = [
      { t: 'Dimensão', w: 118, a: 'left' },
      { t: 'Intensidade', w: 70, a: 'right' },
      { t: 'Peso', w: 50, a: 'right' },
      { t: 'Intens. × peso', w: 80, a: 'right' },
      { t: 'Contribuição (÷ 15)', w: 98, a: 'right' },
      { t: '% do ponderado', w: W - 416, a: 'right' }
    ];
    function rowAt(cells, o) {
      o = o || {};
      ensure(18);
      if (o.fill) pdf.rect(M, y, W, 18, { fill: o.fill });
      var x = M;
      cells.forEach(function (c, i) {
        var col = cols[i];
        var tx = col.a === 'right' ? x + col.w - 6 : x + 6;
        pdf.text(tx, y + 12.2, c, { size: o.head ? 7 : 9, font: o.head ? 'bold' : (i > 0 ? 'mono' : (o.bold ? 'bold' : 'regular')), color: o.head ? C.muted : C.ink, align: col.a });
        x += col.w;
      });
      y += 18;
      pdf.line(M, y, M + W, y, { color: C.line, width: 0.5 });
    }
    rowAt(cols.map(function (c) { return c.t.toUpperCase(); }), { head: true, fill: C.paper });
    r.porDimensao.forEach(function (d) {
      rowAt([d.nome, String(d.intensidade), String(d.peso), String(d.produto), T.formatScore(d.contribuicao), T.formatScore(d.percentual) + '%']);
    });
    var somaProd = r.porDimensao.reduce(function (a, d) { return a + d.produto; }, 0);
    var somaInt = r.porDimensao.reduce(function (a, d) { return a + d.intensidade; }, 0);
    rowAt(['Total', String(somaInt), String(r.somaPesos), String(somaProd), T.formatScore(r.ponderado), '100%'], { bold: true, fill: C.soft });
    y += 6;
    para('Na coluna Intensidade, a dimensão Desempenho segue a orientação original: 0 = bom desempenho, 100 = mau desempenho. Valores exibidos com no máximo uma casa decimal; os cálculos usam valores sem arredondamento.', { size: 8, color: C.muted });

    // Comparações
    h2('Escolhas nas 15 comparações');
    r && T.PAIRS.forEach(function (p, i) {
      ensure(16);
      var esc = ev.comparacoes[p.id];
      if (i % 2 === 0) pdf.rect(M, y, W, 16, { fill: C.paper });
      pdf.text(M + 6, y + 11, (p.numero < 10 ? '0' : '') + p.numero, { font: 'mono', size: 8.5, color: C.muted });
      pdf.text(M + 30, y + 11, T.nomeDim(p.a) + ' × ' + T.nomeDim(p.b), { size: 9 });
      pdf.text(M + W - 6, y + 11, 'Escolhida: ' + T.nomeDim(esc), { size: 9, font: 'bold', align: 'right' });
      y += 16;
    });
    y += 6;
    para('Pesos resultantes: ' + T.DIMENSIONS.map(function (d) { return d.nome + ' ' + r.pesos[d.id]; }).join(' · ') + ' (soma = 15).', { size: 8.5, color: C.muted });

    // Fórmulas
    h2('Fórmulas utilizadas');
    var formulas = [
      ['Peso de cada dimensão', 'pesoᵢ = número de vezes que a dimensão foi escolhida nas 15 comparações (0 a 5; soma = 15).'],
      ['NASA-TLX ponderado', 'NASA-TLX = Σ (avaliaçãoᵢ × pesoᵢ) ÷ 15'],
      ['Raw TLX (não ponderado)', 'Raw TLX = (soma das seis avaliações) ÷ 6'],
      ['Contribuição de cada dimensão', 'contribuiçãoᵢ = (avaliaçãoᵢ × pesoᵢ) ÷ 15; a soma das contribuições é o NASA-TLX ponderado.']
    ];
    formulas.forEach(function (f) {
      ensure(30);
      pdf.text(M, y + 9, f[0], { font: 'bold', size: 9 });
      y += 13;
      para(f[1].replace(/ᵢ/g, '_i'), { size: 9, font: 'mono', after: 4 });
    });
    para('Aplicado aos dados desta avaliação: (' + r.porDimensao.map(function (d) { return d.intensidade + '×' + d.peso; }).join(' + ') +
      ') ÷ 15 = ' + somaProd + ' ÷ 15 = ' + T.formatScore(r.ponderado) + '.   Raw TLX = ' + somaInt + ' ÷ 6 = ' + T.formatScore(r.raw) + '.', { size: 8.5, color: C.muted });

    // Observações
    if (String(ev.meta.observacoes || '').trim()) {
      h2('Observações do avaliador');
      para(ev.meta.observacoes, { size: 9.5 });
    }

    // Notas
    h2('Notas metodológicas');
    [
      'As perguntas orientadoras usadas nesta aplicação são adaptações explicativas em português das definições de Hart e Staveland (1988). Não reproduzem literalmente uma tradução validada.',
      'Existe adaptação transcultural do NASA-TLX para o português do Brasil (Ciofi-Silva et al., 2023), testada com profissionais de saúde hospitalar. O texto desta aplicação não é essa versão e não foi validado.',
      'Não são aplicadas categorias universais de carga baixa, moderada ou alta. Compare resultados apenas entre condições, tarefas e populações comparáveis.',
      'Os dados foram registrados apenas no navegador do avaliador. Nenhuma resposta foi enviada pela internet.'
    ].forEach(function (t) { para('•  ' + t, { size: 8.8 }); });

    // Referências
    h2('Referências');
    T.REFERENCES.forEach(function (ref) { para(ref, { size: 8.5, after: 5 }); });

    // Rodapés
    var total = pdf.pages.length;
    pdf.pages.forEach(function (ops, i) {
      pdf.page = ops;
      pdf.line(M, pdf.H - 40, M + W, pdf.H - 40, { color: C.line, width: 0.5 });
      pdf.text(M, pdf.H - 27, 'LUMIA · Laboratório de Usabilidade, Mídias e Inteligência Artificial · UFC', { size: 7.2, color: C.muted });
      pdf.text(M, pdf.H - 17, 'Sistema NASA-TLX LUMIA ' + T.APP_VERSION + ' · algoritmo ' + T.ALGORITHM_VERSION, { size: 7.2, color: C.muted });
      pdf.text(M + W, pdf.H - 27, 'Página ' + (i + 1) + ' de ' + total, { size: 7.2, color: C.muted, align: 'right' });
    });

    return pdf.output();
  }

  function mix(a, b, t) {
    var x = rgbArr(a), y = rgbArr(b);
    return '#' + [0, 1, 2].map(function (i) {
      var v = Math.round(x[i] + (y[i] - x[i]) * Math.max(0, Math.min(1, t)));
      return ('0' + v.toString(16)).slice(-2);
    }).join('');
  }
  function rgbArr(hex) { var h = hex.replace('#', ''); return [0, 2, 4].map(function (i) { return parseInt(h.slice(i, i + 2), 16); }); }

  /* =========================================================
   * Nomes de arquivo
   * ========================================================= */

  function slugify(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }
  function fileName(ev, ext) {
    var t = slugify(ev.meta && ev.meta.tarefa);
    return 'nasa-tlx_' + ev.codigo + (t ? '_' + t : '') + '.' + ext;
  }

  return {
    buildCSV: buildCSV,
    csvColumns: csvColumns,
    parseCSV: parseCSV,
    neutralizeFormula: neutralizeFormula,
    buildReportPDF: buildReportPDF,
    MiniPDF: MiniPDF,
    toWinAnsi: toWinAnsi,
    textWidth: textWidth,
    wrapText: wrapText,
    fileName: fileName,
    slugify: slugify
  };
});
