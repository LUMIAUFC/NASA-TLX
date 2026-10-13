# Sistema NASA-TLX — LUMIA

Aplicação web para aplicar o **NASA Task Load Index (NASA-TLX)** — Índice de Carga de Trabalho da NASA —, calcular as pontuações e exportar os resultados. Desenvolvida com a identidade visual do **LUMIA** (Laboratório de Usabilidade, Mídias e Inteligência Artificial, UFC Campus Quixadá).

- Seis escalas de 0 a 100, de 5 em 5, com a orientação original de Desempenho (0 = bom, 100 = mau).
- 15 comparações entre pares para obter os pesos individuais.
- **NASA-TLX ponderado** e **Raw TLX (não ponderado)**, apresentados separadamente.
- Gráfico, tabelas, contribuição de cada dimensão, fórmulas aplicadas aos dados e referências.
- Relatório **PDF** e **CSV** gerados no próprio navegador.
- Salvamento automático no navegador e recuperação da avaliação ao reabrir.
- Sem banco de dados, sem servidor, sem login, sem rastreamento. Nenhuma resposta sai do navegador.

## Como executar

**Opção 1 — arquivo único.** Abra `dist/nasa-tlx.html` em um navegador atual (Chrome, Edge, Firefox ou Safari). Não precisa de servidor nem de instalação.

**Opção 2 — código-fonte.** Sirva a pasta `src/` com qualquer servidor estático e abra `index.html`:

```bash
cd src
python3 -m http.server 8080
# abra http://localhost:8080
```

**Opção 3 — online.** O sistema está publicado pelo GitHub Pages em https://lumiaufc.github.io/NASA-TLX/ (o `index.html` da raiz, gerado pelo build).

Para regenerar o arquivo único (e o `index.html` publicado) depois de alterar `src/`:

```bash
node tools/build.js
```

## Fluxo de uso

1. **Identificação** (avaliador): tarefa (obrigatória), código do participante, sistema, versão e observações (opcionais). Código da avaliação, data e hora são automáticos.
2. **Instruções**: o avaliador entrega o dispositivo ao participante, que lê a instrução padrão.
3. **Dimensões**: o participante avalia as seis dimensões.
4. **Comparações**: o participante responde os 15 pares.
5. **Revisão**: confere e altera respostas; conclui.
6. **Resultados**: pontuações, gráfico, tabelas, fórmulas, exportação em PDF e CSV, nova avaliação.

As avaliações concluídas ficam na tela inicial, para consulta, exportação (inclusive CSV com todas) e remoção.

## Estrutura

```
src/
  index.html            página
  css/tlx.css           estilos (tokens do Design System LUMIA, temas claro e escuro)
  js/tlx-core.js        dimensões, pares, validação, pesos e pontuações (sem DOM)
  js/tlx-storage.js     salvamento e recuperação no localStorage
  js/tlx-export.js      CSV e gerador de PDF próprio
  js/tlx-assets.js      logotipos UFC Campus Quixadá e LUMIA incorporados
  js/app.js             interface
dist/
  nasa-tlx.html         versão em arquivo único (gerada)
tests/
  core.test.js          testes do cálculo
  storage-export.test.js testes de salvamento, CSV e PDF
  e2e_test.py           teste de ponta a ponta no navegador
tools/build.js          gera dist/
docs/
  REGRAS-E-FORMULAS.md  regras de negócio, fórmulas, formato do CSV e do armazenamento
  LIMITACOES.md         limitações da tradução, do método e da aplicação
assets/                 logotipos originais e imagem do cabeçalho do PDF
```

## Dependências

- **Para usar:** nenhuma. Só um navegador atual. As fontes vêm do Google Fonts quando há conexão; sem ela, o navegador usa fontes do sistema.
- **Para os testes unitários:** Node.js 18 ou superior (usa `node:test`, sem pacotes npm).
- **Para conferir o texto do PDF nos testes (opcional):** `pdftotext` e `pdfinfo` (Poppler). Sem eles, esse teste é pulado.
- **Para o teste de navegador (opcional):** Python 3, `pip install playwright`, `playwright install chromium`; e, para a análise de acessibilidade, o arquivo `axe.min.js` do pacote `axe-core`.

## Testes

```bash
npm test                 # node --test tests/*.test.js
npm run build            # gera dist/
python3 tests/e2e_test.py dist/nasa-tlx.html --axe node_modules/axe-core/axe.min.js
```

Os testes unitários cobrem: escalas (21 valores, rejeição de valores fora da escala ou dos incrementos), orientação de Desempenho, 15 pares sem duplicação, todas as 32.768 combinações de escolhas (pesos entre 0 e 5, soma 15), incremento de exatamente uma dimensão por escolha, casos 0/50/100, rejeição de pesos com soma ≠ 15, bloqueio com respostas ou comparações faltando, comparação com cálculo independente em 500 casos aleatórios, salvamento, recuperação, dados corrompidos, falha de gravação por falta de espaço, remoção dos dados, conteúdo e proteção contra fórmulas do CSV, estrutura e texto do PDF.

O teste de navegador percorre o fluxo inteiro por teclado, recarrega a página no meio, conclui, baixa PDF e CSV, confere os valores nos arquivos e executa o axe-core.

## Privacidade

Os dados ficam apenas no navegador e perfil usados (`localStorage`, chave `lumia.nasa-tlx.v1`). Não há envio pela internet, analytics nem cookies. A aplicação pede apenas um código de participante; não peça nome, CPF ou e-mail. A recuperação não é garantida se os dados do navegador forem apagados, em navegação privada ou em outro dispositivo — exporte os resultados.

## Referências

- HART, S. G.; STAVELAND, L. E. Development of NASA-TLX (Task Load Index): results of empirical and theoretical research. In: HANCOCK, P. A.; MESHKATI, N. (ed.). *Human Mental Workload*. Amsterdam: North-Holland, 1988. p. 139-183. (Advances in Psychology, v. 52). DOI: 10.1016/S0166-4115(08)62386-9.
- HART, S. G. NASA-Task Load Index (NASA-TLX); 20 years later. *Proceedings of the Human Factors and Ergonomics Society Annual Meeting*, v. 50, n. 9, p. 904-908, 2006. DOI: 10.1177/154193120605000909.
- CIOFI-SILVA, C. L. et al. Workload assessment: cross-cultural adaptation, content validity and instrument reliability. *Revista Brasileira de Enfermagem*, v. 76, n. 3, e20220556, 2023. DOI: 10.1590/0034-7167-2022-0556.

## Limitações

Resumo — detalhes em [`docs/LIMITACOES.md`](docs/LIMITACOES.md):

- As perguntas orientadoras são adaptações explicativas em português, **não validadas**; não são a versão de Ciofi-Silva et al. (2023).
- As comparações seguem ordem fixa, sem aleatorização.
- Os dados podem ser perdidos se o navegador for limpo.
- Acessibilidade verificada com ferramenta automática; sem testes com leitores de tela reais. Não se declara conformidade com a WCAG.

---

LUMIA · Laboratório de Usabilidade, Mídias e Inteligência Artificial · UFC Campus Quixadá
