#!/usr/bin/env node
/*
 * Gera versões de arquivo único a partir de src/:
 *   dist/nasa-tlx.html  — página completa, com CSS e JS incorporados (abre direto no navegador)
 *   index.html          — cópia de dist/nasa-tlx.html, servida pelo GitHub Pages
 *   dist/artifact.html  — o mesmo conteúdo sem <html>/<head>/<body>, para publicação como Artifact
 * Uso: node tools/build.js
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const src = (p) => fs.readFileSync(path.join(root, 'src', p), 'utf8');
let html = src('index.html');

html = html.replace('<link rel="stylesheet" href="css/tlx.css">', () => '<style>\n' + src('css/tlx.css') + '\n</style>');
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, file) => {
  const code = src(file).replace(/<\/script/gi, '<\\/script');
  return '<script>\n' + code + '\n</script>';
});

const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'nasa-tlx.html'), html);
// Página publicada pelo GitHub Pages (raiz do repositório).
fs.writeFileSync(path.join(root, 'index.html'), html);

// Versão Artifact: o conteúdo de <head> (title, fontes, estilo) vem primeiro, depois o corpo.
const head = /<head>([\s\S]*?)<\/head>/.exec(html)[1]
  .replace(/<meta[^>]*>\s*/g, '')
  .replace(/<link rel="icon"[^>]*>\s*/g, '')
  .replace(/<link rel="preconnect"[^>]*>\s*/g, '');
const body = /<body>([\s\S]*?)<\/body>/.exec(html)[1];
fs.writeFileSync(path.join(dist, 'artifact.html'), head.trim() + '\n' + body.trim() + '\n');

const kb = (f) => (fs.statSync(path.join(dist, f)).size / 1024).toFixed(0) + ' KB';
console.log('dist/nasa-tlx.html', kb('nasa-tlx.html'));
console.log('dist/artifact.html', kb('artifact.html'));
