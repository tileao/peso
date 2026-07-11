# AW139 Companion — Pesos por Perna

Módulo web (HTML + CSS + JS puro, sem build) que calcula a evolução do peso
de um AW139 ao longo das pernas de um voo multi-trecho (base → plataformas →
base), a partir do peso básico da aeronave, tripulação, combustível e
movimentação de pax/carga em cada parada.

## O que faz

- Monta a cadeia `ZFW → TOW → LW → combustível de pouso` perna a perna,
  encadeando o resultado de cada parada (reabastecimento, embarque/desembarque
  de pax e carga) para a perna seguinte.
- Valida cada perna contra MTOW, peso máximo de pouso e combustível mínimo no
  pouso, com status verde/âmbar/vermelho e mensagens de alerta.
- Mostra uma tabela do voo (Payload, comb. decolagem, TOW, LW, comb. pouso,
  POB, consumo e status por perna), caixas de resultado (TOW máximo, margem
  mínima, combustível final, total de pax) e um gráfico em canvas com a
  evolução do peso (degraus de TOW→LW por perna e saltos nas paradas),
  incluindo modo tela cheia.
- Permite adicionar, remover e reordenar pernas, e duplicar a rota invertida
  como atalho para o "voo de volta".
- **Modo de peso de pax** (painel Aeronave): alterna entre "quantidade × peso
  padrão" e "peso real dos pax (kg)", para lançar o peso de pax/bagagem
  exatamente como consta no manifesto, sem depender de uma média por
  passageiro.
- **Combustível real (pouso/decolagem)** (seletor "Consumo da perna", por
  perna): em vez de informar consumo estimado, digite o combustível com que
  vai pousar nesta perna e o combustível com que vai decolar na próxima — o
  app deriva o consumo e o reabastecimento (ou consumo em solo/APU, se a
  decolagem for com menos combustível do que o pouso) automaticamente.
- **Interface enxuta**: o painel Aeronave recolhe num resumo de uma linha
  (abre sozinho enquanto o BEW não foi informado), e a parada de cada perna
  vira uma linha-resumo ("↓4 pax · comb. −50 kg") que expande só para editar.
- **Sugestões automáticas nas paradas**: por padrão todos os pax a bordo
  desembarcam na parada, e a decolagem seguinte sai com o combustível do
  pouso −50 kg (consumo em solo/APU) — no modo "combustível real", os campos
  de pouso/decolagem já vêm pré-calculados a partir do consumo estimado.
  Digitar por cima torna o valor manual (a sugestão não volta a mexer);
  esvaziar o campo reativa a sugestão. Os flags manuais persistem com o
  formulário.
- **Conversor de unidade do manifesto** (kg/lb, painel Voo): manifestos às
  vezes chegam em libras. Selecione "lb" e os campos de pax/carga/combustível
  de cada perna convertem sozinhos para kg assim que você sai do campo — sem
  conta de cabeça. Os parâmetros da aeronave (BEW, tripulação, combustível
  mínimo etc.) continuam sempre em kg.
- **Gráfico de peso e balanceamento (CG)**: o viewer alterna entre "Evolução
  do peso" e o envelope de CG longitudinal certificado do RFM (Figuras 1-1 —
  base 6.400 kg, Supl. 50 = 6.800 kg, Supl. 90 = 7.000 kg, escolhido pela
  categoria de peso). Informando o CG do peso vazio (Chart C/E da aeronave),
  cada perna é plotada no envelope com os pontos de decolagem (●) e pouso (○),
  e o app alerta "CG fora do envelope" por perna. Braços do RFM Seção 6:
  tripulação STA 2820 mm, fileiras de pax 3415/4789/5600 mm (média 4601,
  editável), bagageiro 7700 mm; braço do combustível interpolado dos exemplos
  de carregamento do RFM (6206–6228 mm). O cálculo reproduz exatamente o
  exemplo (a) da Seção 6 do RFM (TOW 4730 kg @ 5390,0 mm; LW 4330 kg @
  5314,1 mm).
- **Tabela do voo flutuante**: fixa logo abaixo do header (sticky), sempre
  visível enquanto você edita as pernas, com scroll interno e botão
  "Ocultar/Mostrar tabela" (preferência persistida). No mobile, o gráfico
  aparece logo abaixo dela (parte de cima), antes do formulário.
- Botão "Ocultar/Mostrar gráfico" no header: recolhe o viewer inteiro para o
  formulário ocupar a tela toda (preferência persistida; no desktop a coluna
  central alarga). O PDF compartilhado sempre inclui tabela e gráfico, mesmo
  que estejam ocultos na tela.
- Compartilha a tabela + gráfico via impressão (botão "Compartilhar PDF").
- Persiste o formulário em `localStorage` (`aw139_pesos_form_v1`) e funciona
  100% offline como PWA (`manifest.webmanifest` + `sw.js`, cache-first).

## Como testar localmente

Não há dependências nem build. Basta servir a pasta estaticamente:

```bash
python3 -m http.server 8000
```

Depois abra `http://localhost:8000/` no navegador (ou adicione à tela de
início no iPhone para testar como PWA standalone).

## Integração com o AW139 Companion

Este módulo é pensado para ser incorporado ao app principal como subpasta,
seguindo as convenções visuais e de estrutura da suíte (tema cockpit escuro,
`cockpit-shell`/`topbar`/`workspace`, `status-chip`, `result-box`, etc.).

A ponte de integração (a ser feita no app principal) pode:

- Ler `watMaxWeightKg` de `localStorage['aw139_companion_shared_context_v1']`
  para exibir a margem de desempenho WAT por perna.
- Ler de volta, após o cálculo, os campos gravados nesse mesmo contexto
  (merge, nunca sobrescrita total): `pesoTowMaxKg`, `pesoPernaCritica`,
  `pesoZfwKg`, `weightKg` (TOW da perna crítica — mesmo campo que os módulos
  WAT/RTO já leem), `updatedAt` e `lastModule`.
- Preencher campos via `getElementById` + `dispatchEvent(new Event('input',
  { bubbles: true }))` — os cálculos reagem a eventos `input`/`change`
  disparados programaticamente.
- Usar `?embed=1` para ocultar a topbar e `?back=1&return=<url>` para exibir
  um botão de voltar, quando o módulo for aberto dentro do shell do app
  principal.

## Aviso

Ferramenta pessoal de estudo e planejamento — consulte o manifesto de peso e
balanceamento oficial.
