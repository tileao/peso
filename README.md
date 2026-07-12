# AW139 Companion — Pesos por Perna

Módulo web (HTML + CSS + JS puro, sem build) que calcula a evolução do peso
de um AW139 ao longo das pernas de um voo multi-trecho (base → plataformas →
base), a partir da rota, do manifesto de pax/bag/carga e do combustível real
de cada perna.

## Fluxo de uso

1. **Aeronave** (painel recolhível, configura uma vez): matrícula (aparece
   na linha-resumo para identificar de qual aeronave são os dados), BEW,
   tripulação, categoria de peso (6800/7000), peso máx. de pouso,
   combustível mínimo, CG do peso vazio e braços de pax e bag/carga.
2. **Rota**: uma linha com as localidades em sequência (maiúsculas
   automáticas) — ex.: `SBMI FPAB P74 FPAB SBMI` monta 4 pernas. Botão
   "Voo de volta" duplica a rota invertida.
3. **Manifesto (pax/bag/carga)**: uma linha por item do manifesto, com
   De → Para e os pesos de pax, bagagem e carga — **em kg ou lb por linha**.
   Trocar a unidade da linha **converte os valores já digitados** (os
   manifestos de pax/bag e de carga chegam separados, às vezes em unidades
   diferentes: digite um em lb, mude a linha para kg e complete o outro).
   O app aloca cada linha às pernas certas: um trecho SBMI→P74 permanece a
   bordo durante a parada em FPAB. Ex.: `SBMI-FPAB 650/90/15`,
   `SBMI-P74 105/19/0`, `FPAB-P74 90/15/0`, `FPAB-SBMI 85/5/0`.
4. **Combustível por perna** (default: combustível real): informe o
   combustível na decolagem da 1ª perna e o combustível no pouso de cada
   perna — a decolagem das pernas seguintes já vem sugerida no quadro da
   própria perna (pouso anterior − 50 kg de consumo em solo/APU), editável.
   Alternativas por perna: consumo estimado (kg) ou tempo × taxa (kg/h).
5. **Weather por perna (botão WX)**: cada perna tem um popup de meteorologia
   do destino. Para unidade marítima (UM), na ordem: QNH, aproamento, vento,
   temperatura, pitch, roll, heave, heave rate, inclinação, status light
   (verde/vermelho) e helideque guarnecido e liberado; para aeródromo
   (código ICAO Sxxx, detectado automaticamente): QNH, vento e temperatura.
   Status light vermelho ou helideque não liberado geram alerta âmbar. Os
   dados ficam salvos com o formulário e são gravados no contexto
   compartilhado (`pesoWeatherPorPerna`) para alimentar os demais módulos —
   primeiro passo da evolução deste módulo para o "módulo voo" da suíte.

## O que mostra

- **Tabela do voo flutuante** (fixa sob o header, com botão ocultar):
  Payload, comb. decolagem, TOW, LW, comb. pouso, pax (kg), consumo e status
  verde/âmbar/vermelho por perna.
- **Gráfico de peso e balanceamento (default)**: envelope de CG longitudinal
  certificado do RFM (Fig. 1-1 — base 6.400 kg, Supl. 50 = 6.800 kg,
  Supl. 90 = 7.000 kg, escolhido pela categoria de peso), com os pontos de
  decolagem (●) e pouso (○) de cada perna e alerta "CG fora do envelope".
  Braços do RFM Seção 6: tripulação STA 2820 mm, média das fileiras de pax
  4601 mm (editável), bagageiro 7700 mm; braço do combustível interpolado dos
  exemplos de carregamento do RFM (6206–6228 mm). O cálculo reproduz
  exatamente o exemplo (a) da Seção 6 (TOW 4730 kg @ 5390,0 mm; LW 4330 kg @
  5314,1 mm). Modo alternativo: evolução do peso (degraus TOW→LW). Tela
  cheia disponível; botão no header oculta o gráfico inteiro.
- **Caixas de resultado**: TOW máximo, margem mínima p/ MTOW, combustível
  final e peso de pax embarcado; alertas por perna (MTOW, peso máx. de pouso,
  reserva de combustível, margem baixa, CG e WAT via contexto compartilhado).
- **Compartilhar PDF** (impressão) sempre inclui tabela e gráfico, mesmo
  ocultos na tela.

## Sugestões automáticas

A decolagem de cada perna vem sugerida como o pouso da perna anterior
− 50 kg. Digitar por cima torna o valor manual (a sugestão não mexe mais);
esvaziar o campo reativa a sugestão. Os flags manuais persistem com o
formulário (`localStorage`, chave `aw139_pesos_form_v2`).

## Como testar localmente

Não há dependências nem build. Basta servir a pasta estaticamente:

```bash
python3 -m http.server 8000
```

Depois abra `http://localhost:8000/` no navegador (ou adicione à tela de
início no iPhone para usar como PWA standalone, 100% offline).

## Integração com o AW139 Companion

Este módulo é pensado para ser incorporado ao app principal como subpasta,
seguindo as convenções visuais e de estrutura da suíte (tema cockpit escuro,
`cockpit-shell`/`topbar`/`workspace`, `status-chip`, `result-box`, etc.).

A ponte de integração (a ser feita no app principal) pode:

- Ler `watMaxWeightKg` de `localStorage['aw139_companion_shared_context_v1']`
  para exibir a margem de desempenho WAT por perna.
- Ler de volta, após o cálculo, os campos gravados nesse mesmo contexto
  (merge, nunca sobrescrita total): `pesoTowMaxKg`, `pesoPernaCritica`,
  `pesoZfwKg`, `pesoCgTowMm`, `weightKg` (TOW da perna crítica — mesmo campo
  que os módulos WAT/RTO já leem), `updatedAt` e `lastModule`.
- Preencher campos via `getElementById` + `dispatchEvent(new Event('input',
  { bubbles: true }))` — os cálculos reagem a eventos `input`/`change`
  disparados programaticamente.
- Usar `?embed=1` para ocultar a topbar e `?back=1&return=<url>` para exibir
  um botão de voltar, quando o módulo for aberto dentro do shell do app
  principal.

## Aviso

Ferramenta pessoal de estudo e planejamento — consulte o manifesto de peso e
balanceamento oficial.
