# Regras de negócio e fórmulas

Versão do algoritmo de cálculo: **TLX-CALC-1.0** (constante `ALGORITHM_VERSION` em `src/js/tlx-core.js`).

## 1. Dimensões

Ordem fixa, igual à de Hart e Staveland (1988). O identificador curto é usado no código e nos dados salvos.

| ID | Dimensão | Extremo 0 | Extremo 100 |
|----|----------|-----------|-------------|
| MD | Demanda mental | Muito baixa | Muito alta |
| PD | Demanda física | Muito baixa | Muito alta |
| TD | Demanda temporal | Muito baixa | Muito alta |
| OP | Desempenho | **Bom desempenho** | **Mau desempenho** |
| EF | Esforço | Muito baixo | Muito alto |
| FR | Frustração | Muito baixa | Muito alta |

**Desempenho tem orientação diferente**: valor alto indica desempenho percebido pior. A interface avisa isso no cartão da dimensão e nas instruções. **O cálculo não inverte o valor**: Desempenho = 100 entra como 100.

## 2. Escala de intensidade

- Valores de 0 a 100, de 5 em 5 (21 valores possíveis).
- Valor válido: número inteiro, `0 ≤ v ≤ 100` e `v mod 5 = 0`. Qualquer outro valor (texto, 52,5, 7, −5, 105, NaN) é rejeitado.
- Uma dimensão sem resposta fica como `null`. Não há valor padrão: o controle deslizante aparece sem marcador até a primeira interação, e o leitor de tela anuncia "Sem resposta".

## 3. Comparações entre pares

As 15 comparações são todas as combinações C(6,2) das seis dimensões, geradas em ordem fixa: para cada dimensão *i* na ordem da tabela acima, pareada com cada dimensão *j* posterior a ela.

| Nº | Par | Nº | Par | Nº | Par |
|---|---|---|---|---|---|
| 01 | Demanda mental × Demanda física | 06 | Demanda física × Demanda temporal | 11 | Demanda temporal × Esforço |
| 02 | Demanda mental × Demanda temporal | 07 | Demanda física × Desempenho | 12 | Demanda temporal × Frustração |
| 03 | Demanda mental × Desempenho | 08 | Demanda física × Esforço | 13 | Desempenho × Esforço |
| 04 | Demanda mental × Esforço | 09 | Demanda física × Frustração | 14 | Desempenho × Frustração |
| 05 | Demanda mental × Frustração | 10 | Demanda temporal × Desempenho | 15 | Esforço × Frustração |

- Pergunta de cada par: "Qual dessas duas dimensões contribuiu mais para sua carga de trabalho durante a tarefa realizada?"
- Cada par é um grupo de botões de opção (radio): só uma dimensão pode ser escolhida; escolher a outra substitui a anterior.
- Uma escolha que não pertence ao par é rejeitada (`COMPARACAO_INVALIDA`).
- A ordem é fixa e não aleatorizada. Os pesos nunca são derivados das intensidades.

## 4. Pesos

```
pesoᵢ = número de vezes que a dimensão i foi escolhida nas 15 comparações
```

- Cada escolha soma exatamente 1 ponto à dimensão escolhida.
- Cada peso é um inteiro de 0 a 5 (cada dimensão aparece em 5 pares).
- A soma dos seis pesos é sempre 15.
- Os pesos só são calculados com as 15 comparações respondidas (`COMPARACOES_INCOMPLETAS` caso contrário).

## 5. Pontuações

### NASA-TLX ponderado (instrumento original)

```
NASA-TLX = Σ (avaliaçãoᵢ × pesoᵢ) / 15
```

Varia de 0 a 100. Só é calculado com as seis avaliações válidas e os seis pesos válidos (soma 15).

### Raw TLX (NASA-TLX não ponderado)

```
Raw TLX = (soma das seis avaliações) / 6
```

É apresentado separadamente, sempre identificado como "não ponderado". Não substitui a pontuação ponderada.

### Contribuição de cada dimensão

```
produtoᵢ       = avaliaçãoᵢ × pesoᵢ            (0 a 500)
contribuiçãoᵢ  = produtoᵢ / 15                (parcela do escore ponderado)
percentualᵢ    = contribuiçãoᵢ / NASA-TLX × 100
```

A soma das contribuições é igual ao NASA-TLX ponderado (verificado nos testes).

### Exemplo

Avaliações MD 80, PD 10, TD 60, OP 30, EF 70, FR 40; pesos 5, 4, 3, 2, 1, 0.

- Ponderado: (80×5 + 10×4 + 60×3 + 30×2 + 70×1 + 40×0) / 15 = 750 / 15 = **50**
- Raw TLX: 290 / 6 = 48,333… → exibido **48,3**

## 6. Arredondamento e auditoria

- Os valores internos não são arredondados. O resultado salvo guarda intensidades, pesos, produtos, contribuições e pontuações completos.
- Na tela e no PDF, os números aparecem com no máximo uma casa decimal, só quando necessário (50 → "50"; 48,333… → "48,3"), com vírgula decimal.
- No CSV, os resultados vão com até 4 casas decimais e vírgula decimal (48,3333).
- Ao reabrir a aplicação, o resultado de cada avaliação concluída é **recalculado** a partir das respostas salvas; um resultado alterado manualmente no armazenamento é descartado.

## 7. Bloqueios

| Situação | Comportamento |
|---|---|
| Tarefa não informada | Não avança da identificação; erro junto ao campo. |
| Dimensão sem resposta | Não avança para as comparações; resumo de erros com link para cada escala. |
| Comparação sem resposta | Não avança para a revisão; resumo de erros com link para cada par. |
| Qualquer pendência na conclusão | O cálculo não é feito. |
| Peso fora de 0–5 ou soma ≠ 15 | Cálculo ponderado rejeitado (`PESOS_INVALIDOS`, `SOMA_PESOS_INVALIDA`). |

## 8. Interpretação

A aplicação não classifica a pontuação como baixa, moderada ou alta. O texto exibido é:

> A pontuação representa a carga de trabalho subjetiva percebida durante a tarefa avaliada. A interpretação depende do contexto, da tarefa, da população e das condições de aplicação.

## 9. Estrutura do CSV

- Codificação UTF-8 com BOM (o Excel reconhece os acentos).
- Separador ponto e vírgula (`;`), padrão das planilhas em português; vírgula decimal.
- Quebra de linha CRLF. Uma linha por avaliação concluída.
- Campos de texto entre aspas; aspas internas duplicadas.
- Campos de texto que começam com `=`, `+`, `-`, `@`, tabulação ou retorno recebem um apóstrofo inicial, para que a planilha não os execute como fórmula.
- **As 15 escolhas individuais estão no mesmo arquivo**, em 15 colunas adicionais nomeadas "Comparação NN: Dimensão A × Dimensão B", cujo valor é o nome da dimensão escolhida.

Colunas, na ordem:

1. Código da avaliação
2. Tarefa
3. Código do participante
4. Data da avaliação (ISO 8601 com fuso, ex.: 2026-10-13T14:30:00-03:00)
5. Sistema ou aplicação avaliada
6. Versão do sistema avaliado
7–12. Intensidade da demanda mental, da demanda física, da demanda temporal, do desempenho, do esforço, da frustração
13–18. Peso da demanda mental, … , Peso da frustração
19. Resultado NASA-TLX ponderado
20. Resultado Raw TLX (não ponderado)
21. Versão do algoritmo de cálculo
22–36. Comparação 01 … Comparação 15
37. Observações do avaliador
38. Concluída em
39. Versão do sistema de avaliação

## 10. Armazenamento local

- Chave do `localStorage`: `lumia.nasa-tlx.v1`.
- Conteúdo: `{ app, schema, atual, concluidas[], salvoEm }`. `atual` é a avaliação em andamento (metadados, avaliações, comparações, etapa); `concluidas` guarda as avaliações concluídas com o resultado.
- Salvamento automático a cada alteração (campos de texto com atraso de 350 ms; escalas e comparações imediatamente) e ao sair da página.
- Ao carregar, valores inválidos são descartados com aviso; dados ilegíveis são informados e substituídos no próximo salvamento.
- "Remover todos os dados locais" apaga a chave, depois de confirmação e com a opção de exportar antes.
