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
- Mostra uma tabela do voo, caixas de resultado (TOW máximo, margem mínima,
  combustível final, total de pax) e um gráfico em canvas com a evolução do
  peso (degraus de TOW→LW por perna e saltos nas paradas), incluindo modo
  tela cheia.
- Permite adicionar, remover e reordenar pernas, e duplicar a rota invertida
  como atalho para o "voo de volta".
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
