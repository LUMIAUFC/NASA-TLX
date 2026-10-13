#!/usr/bin/env python3
"""
Teste de ponta a ponta no navegador (Chromium via Playwright).
Percorre o fluxo completo, recarrega a página no meio para verificar a recuperação
local, conclui a avaliação, baixa PDF e CSV e confere o conteúdo dos arquivos.

Uso: python3 tests/e2e_test.py [caminho/para/nasa-tlx.html] [--axe caminho/axe.min.js] [--shots pasta]
"""
import csv, io, json, os, sys, subprocess, tempfile, pathlib
from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parent.parent
args = sys.argv[1:]
page_path = pathlib.Path(args[0]) if args and not args[0].startswith('--') else ROOT / 'dist' / 'nasa-tlx.html'
axe = args[args.index('--axe') + 1] if '--axe' in args else None
shots = pathlib.Path(args[args.index('--shots') + 1]) if '--shots' in args else None
URL = page_path.resolve().as_uri()

# Respostas de teste e resultado esperado (calculado à parte)
RATINGS = {'MD': 80, 'PD': 10, 'TD': 60, 'OP': 30, 'EF': 70, 'FR': 40}
ORDER = ['MD', 'PD', 'TD', 'OP', 'EF', 'FR']
PAIRS = [(a, b) for i, a in enumerate(ORDER) for b in ORDER[i + 1:]]
CHOICE = lambda a, b: b if (a, b) in {('MD', 'TD'), ('PD', 'EF'), ('OP', 'FR')} else a
weights = {k: 0 for k in ORDER}
for a, b in PAIRS: weights[CHOICE(a, b)] += 1
assert sum(weights.values()) == 15
EXP_W = sum(RATINGS[k] * weights[k] for k in ORDER) / 15
EXP_RAW = sum(RATINGS.values()) / 6
fmt = lambda v: (str(int(round(v * 10) / 10)) if round(v * 10) % 10 == 0 else f"{round(v * 10) / 10:.1f}".replace('.', ','))

results = []
def check(cond, label):
    results.append((bool(cond), label))
    print(('OK   ' if cond else 'FALHA ') + label)

def run_axe(page, label):
    if not axe: return
    page.add_script_tag(path=axe)
    r = page.evaluate("async () => (await axe.run(document, {runOnly: ['wcag2a','wcag2aa','wcag21aa','wcag22aa']})).violations.map(v => ({id: v.id, impact: v.impact, n: v.nodes.length, t: v.nodes.slice(0,2).map(n=>n.target.join(' '))}))")
    check(len(r) == 0, f'axe ({label}): {len(r)} violações' + ('' if not r else ' ' + json.dumps(r, ensure_ascii=False)))

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(accept_downloads=True, viewport={'width': 1280, 'height': 900}, locale='pt-BR', timezone_id='America/Fortaleza')
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL)

    # 1. Identificação
    expect(page.locator('#titulo-etapa')).to_have_text('Avaliação de carga de trabalho')
    code = page.locator('#f-codigo').input_value()
    check(code.startswith('TLX-'), f'código da avaliação gerado ({code})')
    run_axe(page, 'identificação')
    if shots: page.screenshot(path=str(shots / '01-identificacao.png'), full_page=True)
    page.get_by_role('button', name='Continuar para as instruções').click()
    check(page.locator('#f-tarefa-err').is_visible(), 'tarefa obrigatória: mensagem junto ao campo')
    check(page.evaluate('document.activeElement.id') == 'f-tarefa', 'foco vai para o campo com erro')
    page.fill('#f-tarefa', 'Agendar consulta no aplicativo')
    page.fill('#f-participante', 'P07')
    page.fill('#f-sistema', 'Protótipo Agenda')
    page.fill('#f-versao', '2.1')
    page.get_by_role('button', name='Continuar para as instruções').click()

    # 2. Instruções
    check('Considere a tarefa que você acabou de realizar' in page.inner_text('main'), 'instrução ao participante exibida')
    page.get_by_role('button', name='Começar a avaliação').click()

    # 3. Dimensões — tentar avançar sem respostas
    page.get_by_role('button', name='Continuar para as comparações').click()
    check(page.locator('#resumo-erros li').count() == 6, 'resumo de erros lista as 6 dimensões sem resposta')
    run_axe(page, 'dimensões com erros')
    if shots: page.screenshot(path=str(shots / '02-dimensoes-erros.png'), full_page=False)
    # Preenche pelo teclado: Home (0) e setas (5 em 5)
    for k in ['MD', 'PD', 'TD']:
        page.focus(f'#r-{k}')
        page.keyboard.press('Home')
        for _ in range(RATINGS[k] // 5): page.keyboard.press('ArrowRight')
    check(page.locator('#r-MD').get_attribute('aria-valuetext') == '80 de 100', 'valor anunciado ao leitor de tela (aria-valuetext)')
    # Recarrega no meio para testar recuperação
    page.wait_for_timeout(600)
    page.reload()
    check(page.locator('#titulo-etapa').inner_text() == 'Avaliação das seis dimensões', 'recarregar volta para a mesma etapa')
    check('Avaliação em andamento recuperada' in page.inner_text('main'), 'aviso de recuperação exibido')
    check(page.locator('#v-MD').inner_text() == 'Valor: 80' and page.locator('#v-TD').inner_text() == 'Valor: 60', 'valores recuperados do armazenamento local')
    check(page.locator('#v-OP').inner_text() == 'Sem resposta', 'dimensões não respondidas continuam sem resposta')
    # Desempenho: botões +/- (começam em 50)
    for _ in range(4): page.get_by_role('button', name='Diminuir Desempenho em 5').click()
    check(page.locator('#v-OP').inner_text() == 'Valor: 30', 'botões − e + ajustam de 5 em 5')
    check('0 significa bom desempenho' in page.locator('#card-OP').inner_text(), 'orientação invertida de Desempenho sinalizada')
    for k in ['EF', 'FR']:
        page.focus(f'#r-{k}'); page.keyboard.press('End')
        for _ in range((100 - RATINGS[k]) // 5): page.keyboard.press('ArrowLeft')
    check(page.locator('#prog-dim-n').inner_text() == '6', 'progresso 6 de 6')
    if shots: page.screenshot(path=str(shots / '03-dimensoes.png'), full_page=True)
    page.get_by_role('button', name='Continuar para as comparações').click()

    # 4. Comparações
    check(page.locator('fieldset.pair').count() == 15, '15 comparações apresentadas')
    names = page.locator('fieldset.pair legend').all_inner_texts()
    check(len(set(names)) == 15, 'comparações sem duplicação')
    for i, (a, b) in enumerate(PAIRS[:-1]):
        pid = f'P{i + 1:02d}'
        page.focus(f'#o-{pid}-{CHOICE(a, b)}')
        page.keyboard.press('Space')
    page.get_by_role('button', name='Revisar respostas').click()
    check(page.locator('#resumo-erros li').count() == 1, 'comparação pendente impede a revisão')
    # muda de ideia em P01 (radio: só uma escolha por par)
    page.check('#o-P01-PD'); page.check('#o-P01-MD')
    check(page.locator('input[name=P01]:checked').count() == 1, 'só uma dimensão selecionada por par')
    page.check('#o-P15-' + CHOICE(*PAIRS[14]))
    run_axe(page, 'comparações')
    if shots: page.screenshot(path=str(shots / '04-comparacoes.png'), full_page=False)
    page.get_by_role('button', name='Revisar respostas').click()

    # 5. Revisão
    txt = page.inner_text('main')
    check('Sem resposta' not in txt, 'revisão sem pendências')
    run_axe(page, 'revisão')
    page.get_by_role('button', name='Concluir e calcular').click()

    # 6. Resultados
    expect(page.locator('#titulo-etapa')).to_have_text('Resultados da avaliação')
    scores = page.locator('.score__value b').all_inner_texts()
    check(scores == [fmt(EXP_W), fmt(EXP_RAW)], f'pontuações exibidas {scores} == esperado {[fmt(EXP_W), fmt(EXP_RAW)]}')
    row_w = page.locator('tbody tr').nth(0).inner_text()
    check(str(weights['MD']) in row_w, 'tabela mostra o peso calculado')
    run_axe(page, 'resultados')
    if shots: page.screenshot(path=str(shots / '05-resultados.png'), full_page=True)

    with page.expect_download() as d:
        page.get_by_role('button', name='Baixar relatório PDF').click()
    pdf_path = os.path.join(tempfile.gettempdir(), d.value.suggested_filename)
    d.value.save_as(pdf_path)
    check(d.value.suggested_filename.endswith('.pdf') and code in d.value.suggested_filename, f'PDF baixado ({d.value.suggested_filename})')
    pdftxt = subprocess.run(['pdftotext', '-layout', pdf_path, '-'], capture_output=True, text=True).stdout
    check('Agendar consulta no aplicativo' in pdftxt and fmt(EXP_W) in pdftxt and 'Protótipo Agenda' in pdftxt, 'PDF contém tarefa, sistema e pontuação')

    with page.expect_download() as d2:
        page.get_by_role('button', name='Exportar CSV desta avaliação').click()
    csv_path = os.path.join(tempfile.gettempdir(), d2.value.suggested_filename)
    d2.value.save_as(csv_path)
    raw = open(csv_path, 'rb').read()
    check(raw.startswith(b'\xef\xbb\xbf'), 'CSV com BOM UTF-8')
    rows = list(csv.reader(io.StringIO(raw.decode('utf-8-sig')), delimiter=';'))
    head, row = rows[0], rows[1]
    g = lambda c: row[head.index(c)]
    check(g('Código da avaliação') == code, 'CSV: código confere')
    check([g('Intensidade da demanda mental'), g('Intensidade do desempenho'), g('Intensidade da frustração')] == ['80', '30', '40'], 'CSV: intensidades conferem')
    check([int(g(f'Peso {a} {n}')) for a, n in [('da', 'demanda mental'), ('da', 'demanda física'), ('da', 'demanda temporal'), ('do', 'desempenho'), ('do', 'esforço'), ('da', 'frustração')]] == [weights[k] for k in ORDER], 'CSV: pesos conferem')
    check(abs(float(g('Resultado NASA-TLX ponderado').replace(',', '.')) - EXP_W) < 1e-3, 'CSV: ponderado confere')
    check(abs(float(g('Resultado Raw TLX (não ponderado)').replace(',', '.')) - EXP_RAW) < 1e-3, 'CSV: Raw TLX confere')
    check(g('Comparação 02: Demanda mental × Demanda temporal') == 'Demanda temporal', 'CSV: escolha individual confere')

    # Recarregar após concluir: resultado mantido no histórico
    page.reload()
    check(page.locator('.history li').count() == 1, 'avaliação concluída mantida no navegador após recarregar')
    page.get_by_role('button', name='Ver resultados').click()
    check(page.locator('.score__value b').first.inner_text() == fmt(EXP_W), 'resultado reaberto do armazenamento local')

    # Celular + tema escuro
    mob = browser.new_context(viewport={'width': 390, 'height': 844}, color_scheme='dark', is_mobile=True, has_touch=True)
    mp = mob.new_page(); mp.goto(URL)
    mp.fill('#f-tarefa', 'Teste celular'); mp.get_by_role('button', name='Continuar para as instruções').click()
    mp.get_by_role('button', name='Começar a avaliação').click()
    sw = mp.evaluate('document.documentElement.scrollWidth')
    check(sw <= 390, f'sem rolagem horizontal no celular (largura {sw})')
    run_axe(mp, 'celular escuro dimensões')
    if shots:
        mp.screenshot(path=str(shots / '06-celular-escuro.png'), full_page=False)
    mob.close()

    # Remover todos os dados locais
    page.get_by_role('button', name='Voltar ao início').click()
    page.get_by_role('button', name='Remover todos os dados locais').click()
    check(page.locator('dialog[open]').count() == 1, 'confirmação antes de remover dados')
    page.locator('dialog').get_by_role('button', name='Remover tudo').click()
    page.wait_for_timeout(400)
    stored = page.evaluate("localStorage.getItem('lumia.nasa-tlx.v1')")
    check(stored is None, 'dados locais removidos do navegador')
    check(page.locator('.history li').count() == 0, 'lista de avaliações concluídas vazia após remoção')

    check(not errors, 'sem erros de JavaScript' + ('' if not errors else ': ' + '; '.join(errors)))
    browser.close()

fails = [l for ok, l in results if not ok]
print(f'\n{len(results) - len(fails)} de {len(results)} verificações passaram.')
sys.exit(1 if fails else 0)
