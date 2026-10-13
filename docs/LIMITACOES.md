# Limitações metodológicas e técnicas

## Tradução

- As perguntas orientadoras e os extremos das escalas são **adaptações explicativas em português** das definições de Hart e Staveland (1988), redigidas para esta aplicação a partir da especificação do projeto. **Não reproduzem literalmente uma tradução validada e não passaram por processo de validação.**
- Existe uma adaptação transcultural do NASA-TLX para o português do Brasil, com tradução, retrotradução, comitê de especialistas e pré-teste (Ciofi-Silva et al., 2023, *Revista Brasileira de Enfermagem*), testada com 50 profissionais de saúde de unidades de internação de um hospital público. Nela, o título adotado foi "Índice NASA de carga de tarefa", e os itens de desempenho e esforço precisaram ser reescritos. **O texto desta aplicação não é essa versão.** Quem precisar de comparabilidade com estudos que a utilizaram deve substituir os textos em `src/js/tlx-core.js` (`DIMENSIONS`) pelos do material suplementar do artigo, respeitando os termos de uso.
- Resultados obtidos com esta tradução não devem ser apresentados como obtidos com uma versão validada.

## Método

- **Ordem fixa das comparações.** Os 15 pares aparecem sempre na mesma ordem e com as dimensões sempre do mesmo lado. Aplicações em papel e alguns softwares aleatorizam a ordem e o lado para reduzir efeitos de ordem; esta versão não faz isso.
- **Ponderação por avaliação.** Cada avaliação tem suas próprias comparações, como no procedimento original. Não há ponderação por grupo nem reaproveitamento de pesos entre tarefas.
- **Sem categorias de interpretação.** A aplicação não classifica as pontuações em baixa, moderada ou alta, porque não há limites universais fundamentados para isso.
- **Raw TLX.** É oferecido como pontuação adicional; os dois resultados não são intercambiáveis entre estudos.
- **Escala contínua em 21 pontos.** A escala usa incrementos de 5, como na versão em papel. O controle deslizante, no estado inicial, fica sem marcador; mas se o participante clicar exatamente no ponto central sem arrastar, o valor 50 é registrado.

## Armazenamento

- Os dados ficam no `localStorage` do navegador e perfil em que a avaliação foi feita. Eles **podem ser perdidos** se o usuário limpar os dados do navegador, usar navegação privada (os dados somem ao fechar a janela), trocar de navegador ou de dispositivo, ou se o navegador liberar espaço automaticamente.
- Não há sincronização, cópia de segurança nem histórico remoto. Exporte CSV e PDF ao final de cada sessão.
- O espaço do `localStorage` é limitado (em geral, cerca de 5 MB por site). Cada avaliação concluída ocupa cerca de 1,5 KB; a aplicação avisa se não conseguir salvar.
- Os dados não são criptografados no navegador. Qualquer pessoa com acesso ao mesmo perfil do navegador pode vê-los. Use códigos de participante, não nomes.
- Quando a aplicação é aberta como arquivo local (`file://`), alguns navegadores separam o armazenamento por arquivo ou o desativam; se o salvamento falhar, a barra de status mostra "Não salvo" e as exportações continuam funcionando.

## Exportação

- O PDF é gerado por um gerador próprio (sem bibliotecas), com as fontes padrão do PDF (Helvetica e Courier) e codificação Windows-1252. Todos os caracteres do português são suportados. Caracteres fora dessa codificação digitados nos campos livres (emoji, letras de outros alfabetos) aparecem como "?". O texto do PDF pode ser selecionado e copiado, mas o arquivo não é marcado (PDF/UA) para leitores de tela.
- O CSV usa ponto e vírgula e vírgula decimal (padrão brasileiro). Planilhas configuradas em inglês podem pedir que o separador seja informado na importação.
- No Artifact do claude.ai, o download passa pela confirmação do próprio claude.ai.

## Fontes e funcionamento sem conexão

- A aplicação não depende de nenhum serviço externo para funcionar. As fontes Montserrat, Nunito Sans e DM Mono vêm do Google Fonts; sem conexão, o navegador usa as fontes do sistema, sem prejuízo das funções.
- Os logotipos da UFC Campus Quixadá e do LUMIA estão incorporados ao código (`src/js/tlx-assets.js`).

## Acessibilidade

- A interface foi construída considerando a WCAG 2.2 nível AA: HTML semântico, rótulos, navegação por teclado, foco visível, mensagens de erro junto aos campos e em resumo com links, alternativa textual para o gráfico, tabelas com os valores, contraste dos tokens do LUMIA, alvos de toque de pelo menos 24 px, estado indicado por texto e forma além da cor, respeito a `prefers-reduced-motion` e suporte a cores forçadas.
- Verificação feita: análise automática com axe-core 4.10 (regras WCAG 2.0/2.1/2.2 A e AA) em cinco telas, incluindo celular em tema escuro, sem violações; fluxo completo operado por teclado no teste automatizado.
- **Não foram feitos testes com leitores de tela reais (NVDA, JAWS, VoiceOver, TalkBack) nem com usuários com deficiência.** A ferramenta automática detecta apenas parte dos problemas. **Não se declara conformidade com a WCAG.**
