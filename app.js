'use strict';

(function () {
  var FORM_KEY = 'aw139_pesos_form_v2';
  var SHARED_KEY = 'aw139_companion_shared_context_v1';
  var TABLE_VISIBLE_KEY = 'aw139_pesos_table_visible_v1';
  var CHART_MODE_KEY = 'aw139_pesos_chart_mode_v1';
  var CHART_VISIBLE_KEY = 'aw139_pesos_chart_visible_v1';
  var AIRCRAFT_OPEN_KEY = 'aw139_pesos_aircraft_open_v1';

  // Envelopes de CG longitudinal — AW139 RFM 139G0290X002, Figuras 1-1
  // (E.A.S.A. Approved). Pontos [STA mm, peso kg]. Selecionado pela
  // categoria de peso da aeronave (Supl. 50 = 6800 kg, Supl. 90 = 7000 kg).
  var CG_ENVELOPES = {
    '6400': {
      maxKg: 6400, minKg: 4400, label: 'RFM Fig. 1-1 (Rev. 21, até 6.400 kg)',
      points: [[5071, 4400], [5000, 4660], [5000, 5170], [5180, 6400], [5504, 6400], [5595, 4850], [5536, 4400]]
    },
    '6800': {
      maxKg: 6800, minKg: 4400, label: 'RFM Supl. 50 Fig. 1-1 (6.800 kg)',
      points: [[5071, 4400], [5000, 4660], [5000, 5170], [5238, 6800], [5480, 6800], [5595, 4850], [5536, 4400]]
    },
    '7000': {
      maxKg: 7000, minKg: 4400, label: 'RFM Supl. 90 Fig. 1-1 (7.000 kg)',
      points: [[5071, 4400], [5000, 4660], [5000, 5170], [5266, 7000], [5469, 7000], [5595, 4850], [5536, 4400]]
    }
  };
  var MAST_STA_MM = 5000;
  var CREW_ARM_MM = 2820; // STA dos assentos de piloto/copiloto (RFM Seção 6, Chart E)

  function getCgEnvelope(aircraft) {
    return CG_ENVELOPES[String(aircraft.mtowCategory)] || CG_ENVELOPES['7000'];
  }

  // Braço longitudinal do combustível × quantidade, derivado dos exemplos de
  // carregamento do RFM Seção 6 (6-11/6-12) e do combustível inutilizável do
  // Chart D. Interpolação linear; acima de 1000 kg extrapola a última taxa.
  var FUEL_ARM_TABLE = [
    [0, 6206],
    [100, 6210],
    [300, 6210],
    [500, 6212],
    [800, 6217],
    [1000, 6228]
  ];

  // Consumo típico em solo/APU entre pernas, usado na sugestão de combustível
  // de decolagem da perna seguinte.
  var AUTOFILL_STOP_BURN_KG = 50;

  var KG_PER_LB = 0.45359237;

  var legsContainer = document.getElementById('legsContainer');
  var legTemplate = document.getElementById('legTemplate');
  var manifestRowsContainer = document.getElementById('manifestRowsContainer');
  var manifestRowTemplate = document.getElementById('manifestRowTemplate');
  var fullscreenOverlay = document.getElementById('fullscreenOverlay');

  var lastCalcResult = null;
  var recalcTimer = null;
  var resizeTimer = null;

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function parseNum(v) {
    if (v === null || v === undefined) return NaN;
    var s = String(v).trim();
    if (s === '') return NaN;
    if (s.indexOf(',') !== -1) {
      s = s.replace(/\./g, '').replace(',', '.');
    }
    return parseFloat(s);
  }

  function numOr0(n) { return isFinite(n) ? n : 0; }

  function numWithDefault(id, def) {
    var v = parseNum(document.getElementById(id).value);
    return isFinite(v) ? v : def;
  }

  function fmt(n, decimals) {
    decimals = decimals === undefined ? 0 : decimals;
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return n.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function truncateLabel(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function fuelArmMm(fuelKg) {
    var f = Math.max(0, fuelKg);
    var t = FUEL_ARM_TABLE;
    var last = t[t.length - 1];
    if (f >= last[0]) {
      var prev = t[t.length - 2];
      var slope = (last[1] - prev[1]) / (last[0] - prev[0]);
      return last[1] + (f - last[0]) * slope;
    }
    for (var i = 1; i < t.length; i++) {
      if (f <= t[i][0]) {
        var a = t[i - 1], b = t[i];
        return a[1] + (b[1] - a[1]) * (f - a[0]) / (b[0] - a[0]);
      }
    }
    return t[0][1];
  }

  function pointInPolygon(x, y, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1];
      var xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  // ---------------------------------------------------------------------
  // Query params: ?embed=1  ?back=1&return=<url>
  // ---------------------------------------------------------------------

  function applyQueryParams() {
    var params = new URLSearchParams(location.search);
    if (params.get('embed') === '1') {
      var topbar = document.getElementById('topbar');
      if (topbar) topbar.hidden = true;
    }
    if (params.get('back') === '1') {
      var backBtn = document.getElementById('backBtn');
      var returnUrl = params.get('return');
      backBtn.hidden = false;
      backBtn.addEventListener('click', function () {
        if (returnUrl) location.href = returnUrl;
        else history.back();
      });
    }
  }

  // ---------------------------------------------------------------------
  // Rota: uma linha de localidades define as pernas
  // ---------------------------------------------------------------------

  function parseRoute(str) {
    return String(str || '').toUpperCase().split(/[^A-Z0-9]+/).filter(function (s) { return s !== ''; });
  }

  function getStops() {
    return parseRoute(document.getElementById('routeInput').value);
  }

  function uniqueStops(stops) {
    var seen = {}, out = [];
    stops.forEach(function (s) {
      if (!seen[s]) { seen[s] = true; out.push(s); }
    });
    return out;
  }

  function updateRouteLegsNote(stops) {
    var note = document.getElementById('routeLegsNote');
    if (stops.length < 2) {
      note.textContent = 'Informe pelo menos origem e destino para montar as pernas.';
      return;
    }
    var legs = [];
    for (var i = 0; i < stops.length - 1; i++) legs.push(stops[i] + '→' + stops[i + 1]);
    note.textContent = (stops.length - 1) + (stops.length === 2 ? ' perna: ' : ' pernas: ') + legs.join('  ·  ');
  }

  // Escolhe a viagem mais curta possível: embarque na ÚLTIMA ocorrência da
  // origem que ainda tem o destino pela frente; desembarque na PRIMEIRA
  // ocorrência do destino depois disso.
  function resolveTrip(fromCode, toCode, stops) {
    var best = null;
    for (var i = 0; i < stops.length - 1; i++) {
      if (stops[i] !== fromCode) continue;
      for (var j = i + 1; j < stops.length; j++) {
        if (stops[j] === toCode) {
          best = { fromIdx: i, toIdx: j };
          break;
        }
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------
  // Cards de perna (combustível)
  // ---------------------------------------------------------------------

  function createLegCard() {
    var frag = legTemplate.content.cloneNode(true);
    return frag.querySelector('.leg-card');
  }

  function toggleConsumptionMode(card) {
    var mode = $('.consumption-mode-select', card).value;
    $('.consumption-actual-row', card).hidden = mode !== 'actual';
    $('.consumption-manual-row', card).hidden = mode !== 'manual';
    $('.consumption-time-row', card).hidden = mode !== 'time';
  }

  function rebuildLegCards(stops) {
    var wanted = Math.max(0, stops.length - 1);
    var cards = $$('.leg-card', legsContainer);
    while (cards.length > wanted) {
      cards.pop().remove();
    }
    while (cards.length < wanted) {
      var card = createLegCard();
      legsContainer.appendChild(card);
      toggleConsumptionMode(card);
      cards.push(card);
    }
    cards.forEach(function (card, i) {
      $('.leg-number', card).textContent = 'Perna ' + (i + 1);
      $('.leg-route-label', card).textContent = stops[i] + ' → ' + stops[i + 1];
      updateWxButton(card);
    });
    $('#fuelPanel').hidden = wanted === 0;
  }

  // ---------------------------------------------------------------------
  // Weather por perna (popup WX) — dados do destino da perna
  // ---------------------------------------------------------------------

  var WX_FIELDS = [
    ['qnh', 'wxQnh'],
    ['aproamento', 'wxAproamento'],
    ['vento', 'wxVento'],
    ['temperatura', 'wxTemp'],
    ['pitch', 'wxPitch'],
    ['roll', 'wxRoll'],
    ['heave', 'wxHeave'],
    ['heaveRate', 'wxHeaveRate'],
    ['inclinacao', 'wxInclinacao'],
    ['statusLight', 'wxStatusLight'],
    ['helideckOk', 'wxHelideckOk']
  ];

  var wxCard = null;

  function getLegWeather(card) {
    try {
      return card.dataset.weather ? JSON.parse(card.dataset.weather) : null;
    } catch (e) {
      return null;
    }
  }

  function updateWxButton(card) {
    var btn = $('.wx-btn', card);
    var has = !!getLegWeather(card);
    btn.classList.toggle('wx-filled', has);
    btn.textContent = has ? 'WX ✓' : 'WX';
  }

  function applyWxTypeVisibility() {
    var isUm = document.getElementById('wxType').value === 'um';
    $$('.wx-um-only').forEach(function (el) { el.hidden = !isUm; });
  }

  function guessWxType(dest) {
    // Aeródromos ICAO brasileiros têm 4 letras começando com S; o resto
    // tratamos como unidade marítima.
    return /^S[A-Z]{3}$/.test(dest) ? 'aero' : 'um';
  }

  function openWxDialog(card) {
    wxCard = card;
    var dest = ($('.leg-route-label', card).textContent.split('→')[1] || '').trim();
    var legNum = $('.leg-number', card).textContent;
    document.getElementById('wxTitle').textContent = 'Weather — ' + dest + ' (' + legNum + ')';
    var data = getLegWeather(card) || {};
    document.getElementById('wxType').value = data.type || guessWxType(dest);
    WX_FIELDS.forEach(function (f) {
      document.getElementById(f[1]).value = data[f[0]] !== undefined ? data[f[0]] : '';
    });
    applyWxTypeVisibility();
    document.getElementById('wxOverlay').hidden = false;
  }

  function saveWxDialog() {
    if (!wxCard) return;
    var data = { type: document.getElementById('wxType').value };
    var hasAny = false;
    WX_FIELDS.forEach(function (f) {
      var v = document.getElementById(f[1]).value.trim();
      data[f[0]] = v;
      if (v !== '') hasAny = true;
    });
    if (hasAny) wxCard.dataset.weather = JSON.stringify(data);
    else delete wxCard.dataset.weather;
    updateWxButton(wxCard);
  }

  function closeWxDialog() {
    saveWxDialog();
    document.getElementById('wxOverlay').hidden = true;
    wxCard = null;
    scheduleRecalc();
  }

  // ---------------------------------------------------------------------
  // Linhas do manifesto (pax / bag / carga por trecho)
  // ---------------------------------------------------------------------

  function addManifestRow(data) {
    var frag = manifestRowTemplate.content.cloneNode(true);
    var row = frag.querySelector('.manifest-row');
    manifestRowsContainer.appendChild(row);
    refreshManifestSelectsIn(row, uniqueStops(getStops()));
    if (data) {
      if (data.from) setSelectValue($('.manifest-from-select', row), data.from);
      if (data.to) setSelectValue($('.manifest-to-select', row), data.to);
      $('.manifest-pax-input', row).value = data.pax || '';
      $('.manifest-bag-input', row).value = data.bag || '';
      $('.manifest-cargo-input', row).value = data.cargo || '';
      $('.manifest-unit-select', row).value = data.unit === 'lb' ? 'lb' : 'kg';
    }
    var unitSelect = $('.manifest-unit-select', row);
    unitSelect.dataset.prevUnit = unitSelect.value;
    return row;
  }

  // Ao trocar a unidade da linha, os pesos já digitados CONVERTEM para a
  // unidade selecionada (manifestos de pax/bag e de carga chegam separados,
  // às vezes em unidades diferentes: digita um em lb, converte a linha para
  // kg e completa o outro em kg).
  function convertManifestRowUnits(select) {
    var row = select.closest('.manifest-row');
    var prev = select.dataset.prevUnit || 'kg';
    var next = select.value;
    if (prev !== next) {
      var factor = next === 'lb' ? (1 / KG_PER_LB) : KG_PER_LB;
      ['.manifest-pax-input', '.manifest-bag-input', '.manifest-cargo-input'].forEach(function (sel) {
        var input = $(sel, row);
        var v = parseNum(input.value);
        if (isFinite(v) && v !== 0) {
          input.value = String(round1(v * factor)).replace('.', ',');
        }
      });
    }
    select.dataset.prevUnit = next;
  }

  function setSelectValue(select, value) {
    var has = Array.prototype.some.call(select.options, function (o) { return o.value === value; });
    if (!has) {
      var opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      select.appendChild(opt);
    }
    select.value = value;
  }

  function refreshManifestSelectsIn(row, stopList) {
    ['.manifest-from-select', '.manifest-to-select'].forEach(function (sel) {
      var select = $(sel, row);
      var current = select.value;
      select.innerHTML = '';
      stopList.forEach(function (s) {
        var opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        select.appendChild(opt);
      });
      if (current) setSelectValue(select, current);
      else if (sel === '.manifest-to-select' && stopList.length > 1) select.value = stopList[1];
    });
  }

  function refreshManifestSelects() {
    var stopList = uniqueStops(getStops());
    $$('.manifest-row', manifestRowsContainer).forEach(function (row) {
      refreshManifestSelectsIn(row, stopList);
    });
  }

  function readManifestRows() {
    return $$('.manifest-row', manifestRowsContainer).map(function (row, idx) {
      var unit = $('.manifest-unit-select', row).value;
      var factor = unit === 'lb' ? KG_PER_LB : 1;
      return {
        index: idx,
        from: $('.manifest-from-select', row).value,
        to: $('.manifest-to-select', row).value,
        paxKg: numOr0(parseNum($('.manifest-pax-input', row).value)) * factor,
        bagKg: numOr0(parseNum($('.manifest-bag-input', row).value)) * factor,
        cargoKg: numOr0(parseNum($('.manifest-cargo-input', row).value)) * factor
      };
    });
  }

  // ---------------------------------------------------------------------
  // Leitura do estado
  // ---------------------------------------------------------------------

  function readAircraft() {
    return {
      bewKg: parseNum(document.getElementById('bewKg').value),
      crewKg: numWithDefault('crewKg', 170),
      mtowCategory: parseNum(document.getElementById('mtowCategory').value),
      maxLandingKg: numWithDefault('maxLandingKg', parseNum(document.getElementById('mtowCategory').value)),
      minLandingFuelKg: numWithDefault('minLandingFuelKg', 240),
      bewArmMm: parseNum(document.getElementById('bewArmMm').value),
      paxArmMm: numWithDefault('paxArmMm', 4601),
      cargoArmMm: numWithDefault('cargoArmMm', 7700)
    };
  }

  function readLegsFuel() {
    return $$('.leg-card', legsContainer).map(function (card) {
      return {
        mode: $('.consumption-mode-select', card).value,
        takeoffFuelKg: parseNum($('.takeoff-fuel-input', card).value),
        landingFuelKg: parseNum($('.landing-fuel-actual-input', card).value),
        consumptionKg: parseNum($('.consumption-input', card).value),
        timeMin: parseNum($('.flight-time-input', card).value),
        rateKgH: parseNum($('.fuel-rate-input', card).value),
        weather: getLegWeather(card)
      };
    });
  }

  function readSharedContext() {
    try {
      var raw = localStorage.getItem(SHARED_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------------
  // Motor de cálculo
  // ---------------------------------------------------------------------

  function criticalMargin(r, aircraft) {
    var margins = [
      aircraft.mtowCategory - r.tow,
      aircraft.maxLandingKg - r.lw,
      r.fuelAtLanding - aircraft.minLandingFuelKg
    ];
    if (r.watMargin !== null && r.watMargin !== undefined) margins.push(r.watMargin);
    return Math.min.apply(Math, margins);
  }

  function computeCriticalIndex(results, aircraft) {
    if (!results.length) return -1;
    var idx = 0, val = Infinity;
    results.forEach(function (r, i) {
      var m = criticalMargin(r, aircraft);
      if (m < val) { val = m; idx = i; }
    });
    return idx;
  }

  function computeMinMtowMargin(results) {
    var idx = 0, val = Infinity;
    results.forEach(function (r, i) {
      if (r.marginToMtow < val) { val = r.marginToMtow; idx = i; }
    });
    return { value: val, index: idx };
  }

  function compute() {
    var aircraft = readAircraft();
    var stops = getStops();
    var manifest = readManifestRows();
    var legsFuel = readLegsFuel();
    var shared = readSharedContext();
    var watMax = (shared && isFinite(parseFloat(shared.watMaxWeightKg))) ? parseFloat(shared.watMaxWeightKg) : null;
    var mtow = aircraft.mtowCategory;

    var globalIssues = [];
    if (!isFinite(aircraft.bewKg)) {
      globalIssues.push({ level: 'error', message: 'Informe o peso básico da aeronave (BEW).' });
    }

    var results = [];
    var totalPaxBoardKg = 0;
    if (stops.length < 2) {
      globalIssues.push({ level: 'error', message: 'Informe a rota (pelo menos origem e destino).' });
      return { aircraft: aircraft, stops: stops, results: results, watMax: watMax, globalIssues: globalIssues, totalPaxBoardKg: 0 };
    }

    var nLegs = stops.length - 1;
    var legPax = [], legBag = [], legCargo = [];
    for (var k = 0; k < nLegs; k++) { legPax.push(0); legBag.push(0); legCargo.push(0); }

    manifest.forEach(function (row) {
      var hasWeight = row.paxKg !== 0 || row.bagKg !== 0 || row.cargoKg !== 0;
      if (!hasWeight) return;
      if (!row.from || !row.to || row.from === row.to) {
        globalIssues.push({ level: 'error', message: 'Linha ' + (row.index + 1) + ' do manifesto: informe origem e destino diferentes.' });
        return;
      }
      var trip = resolveTrip(row.from, row.to, stops);
      if (!trip) {
        globalIssues.push({ level: 'error', message: 'Linha ' + (row.index + 1) + ' do manifesto: trecho ' + row.from + '→' + row.to + ' não existe na rota.' });
        return;
      }
      for (var k2 = trip.fromIdx; k2 < trip.toIdx; k2++) {
        legPax[k2] += row.paxKg;
        legBag[k2] += row.bagKg;
        legCargo[k2] += row.cargoKg;
      }
      totalPaxBoardKg += row.paxKg;
    });

    for (var i = 0; i < nLegs; i++) {
      var leg = legsFuel[i] || { mode: 'actual', takeoffFuelKg: NaN, landingFuelKg: NaN, consumptionKg: NaN, timeMin: NaN, rateKgH: NaN };
      var legIssues = [];

      var payload = legPax[i] + legBag[i] + legCargo[i];
      var zfw = numOr0(aircraft.bewKg) + aircraft.crewKg + payload;

      var startFuel = isFinite(leg.takeoffFuelKg) ? leg.takeoffFuelKg : 0;
      if (!isFinite(leg.takeoffFuelKg)) {
        legIssues.push({ level: 'error', message: 'Combustível na decolagem não informado.' });
      }
      var tow = zfw + startFuel;

      var consumption, fuelAtLanding;
      if (leg.mode === 'actual') {
        fuelAtLanding = leg.landingFuelKg;
        if (!isFinite(fuelAtLanding)) {
          legIssues.push({ level: 'error', message: 'Combustível no pouso não informado.' });
          fuelAtLanding = startFuel;
        }
        consumption = startFuel - fuelAtLanding;
        if (consumption < 0) {
          legIssues.push({ level: 'warn', message: 'Comb. no pouso maior que na decolagem (consumo negativo).' });
        }
      } else if (leg.mode === 'time') {
        consumption = (isFinite(leg.timeMin) && isFinite(leg.rateKgH)) ? (leg.timeMin / 60) * leg.rateKgH : NaN;
        if (!isFinite(consumption)) {
          legIssues.push({ level: 'error', message: 'Informe tempo de voo e consumo médio.' });
          consumption = 0;
        }
        fuelAtLanding = startFuel - consumption;
      } else {
        consumption = leg.consumptionKg;
        if (!isFinite(consumption)) {
          legIssues.push({ level: 'error', message: 'Consumo da perna não informado.' });
          consumption = 0;
        }
        fuelAtLanding = startFuel - consumption;
      }
      var lw = tow - consumption;

      if (tow > mtow) legIssues.push({ level: 'error', message: 'Acima do MTOW em ' + fmt(tow - mtow) + ' kg' });
      if (lw > aircraft.maxLandingKg) legIssues.push({ level: 'error', message: 'Acima do peso máx. de pouso em ' + fmt(lw - aircraft.maxLandingKg) + ' kg' });

      if (fuelAtLanding < 0) {
        legIssues.push({ level: 'error', message: 'Combustível insuficiente na perna' });
      } else if (fuelAtLanding < aircraft.minLandingFuelKg) {
        legIssues.push({ level: 'error', message: 'Combustível de pouso abaixo do mínimo (' + fmt(fuelAtLanding) + ' kg)' });
      } else if (fuelAtLanding < aircraft.minLandingFuelKg * 1.10) {
        legIssues.push({ level: 'warn', message: 'Combustível de pouso próximo do mínimo (' + fmt(fuelAtLanding) + ' kg)' });
      }

      var marginToMtow = mtow - tow;
      if (marginToMtow > 0 && marginToMtow <= 100) {
        legIssues.push({ level: 'warn', message: 'Margem para o MTOW baixa (' + fmt(marginToMtow) + ' kg)' });
      }

      var watMargin = null;
      if (watMax !== null) {
        watMargin = watMax - tow;
        if (watMargin < 0) {
          legIssues.push({ level: 'error', message: 'Acima do peso máx. WAT em ' + fmt(-watMargin) + ' kg' });
        }
      }

      if (leg.weather && leg.weather.type === 'um') {
        if (leg.weather.statusLight === 'vermelho') {
          legIssues.push({ level: 'warn', message: 'Helideque de ' + stops[i + 1] + ': status light VERMELHO' });
        }
        if (leg.weather.helideckOk === 'nao') {
          legIssues.push({ level: 'warn', message: 'Helideque de ' + stops[i + 1] + ': não guarnecido/liberado' });
        }
      }

      var cgTowMm = null, cgLwMm = null;
      if (isFinite(aircraft.bewArmMm)) {
        var cgEnv = getCgEnvelope(aircraft);
        var zfwMoment = numOr0(aircraft.bewKg) * aircraft.bewArmMm +
          aircraft.crewKg * CREW_ARM_MM +
          legPax[i] * aircraft.paxArmMm +
          (legBag[i] + legCargo[i]) * aircraft.cargoArmMm;
        if (tow > 0) cgTowMm = (zfwMoment + startFuel * fuelArmMm(startFuel)) / tow;
        if (lw > 0) cgLwMm = (zfwMoment + Math.max(0, fuelAtLanding) * fuelArmMm(fuelAtLanding)) / lw;

        var checkEnvelope = function (cg, weight, phase) {
          if (cg === null || !isFinite(cg)) return;
          if (weight > cgEnv.maxKg) return; // já coberto pela validação de MTOW
          if (weight < cgEnv.minKg) {
            legIssues.push({ level: 'warn', message: 'Peso ' + phase + ' abaixo do mínimo do envelope (' + fmt(cgEnv.minKg) + ' kg)' });
            return;
          }
          if (!pointInPolygon(cg, weight, cgEnv.points)) {
            legIssues.push({ level: 'error', message: 'CG fora do envelope ' + phase + ' (STA ' + fmt(cg) + ' mm)' });
          }
        };
        checkEnvelope(cgTowMm, tow, 'na decolagem');
        checkEnvelope(cgLwMm, lw, 'no pouso');
      }

      var worst = 'ok';
      if (legIssues.some(function (x) { return x.level === 'error'; })) worst = 'error';
      else if (legIssues.some(function (x) { return x.level === 'warn'; })) worst = 'warn';

      results.push({
        index: i,
        originText: stops[i],
        destText: stops[i + 1],
        payloadKg: payload,
        paxOnBoard: legPax[i],
        bagKg: legBag[i],
        cargoKg: legCargo[i],
        zfw: zfw,
        tow: tow,
        consumption: consumption,
        lw: lw,
        fuelAtStart: startFuel,
        fuelAtLanding: fuelAtLanding,
        marginToMtow: marginToMtow,
        watMargin: watMargin,
        cgTowMm: cgTowMm,
        cgLwMm: cgLwMm,
        weather: leg.weather || null,
        issues: legIssues,
        status: worst
      });
    }

    return { aircraft: aircraft, stops: stops, results: results, watMax: watMax, globalIssues: globalIssues, totalPaxBoardKg: totalPaxBoardKg };
  }

  // ---------------------------------------------------------------------
  // Autocompletamento: a decolagem da perna N+1 sai com o combustível do
  // pouso da perna N − consumo em solo. Digitar por cima torna manual;
  // esvaziar o campo (blur) volta a aceitar a sugestão.
  // ---------------------------------------------------------------------

  var AUTOFILL_SELECTOR = '.takeoff-fuel-input';

  function autofillField(input, value) {
    if (!input || input.dataset.manual === '1') return false;
    if (document.activeElement === input) return false;
    if (!isFinite(value)) return false;
    var str = String(round1(value)).replace('.', ',');
    if (input.value === str) return false;
    input.value = str;
    return true;
  }

  function applyAutofill(results) {
    var cards = $$('.leg-card', legsContainer);
    var changed = false;
    cards.forEach(function (card, i) {
      if (i === 0) return;
      var prev = results[i - 1];
      if (!prev || !isFinite(prev.fuelAtLanding)) return;
      changed = autofillField($('.takeoff-fuel-input', card), prev.fuelAtLanding - AUTOFILL_STOP_BURN_KG) || changed;
    });
    return changed;
  }

  function computeWithAutofill() {
    var res = compute();
    for (var k = 0; k < 8; k++) {
      if (!applyAutofill(res.results)) break;
      res = compute();
    }
    return res;
  }

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  function setStatusChip(state, text) {
    var chip = document.getElementById('statusChip');
    chip.dataset.state = state;
    chip.textContent = text;
  }

  function updateAircraftSummary() {
    var el = document.getElementById('aircraftSummary');
    if (!el) return;
    var parts = [];
    var reg = document.getElementById('registrationInput').value.trim();
    if (reg) parts.push(reg);
    var bew = parseNum(document.getElementById('bewKg').value);
    var cat = document.getElementById('mtowCategory').value;
    parts.push(isFinite(bew) ? 'BEW ' + fmt(bew) : 'BEW —');
    parts.push('MTOW ' + fmt(parseNum(cat)));
    var cg = parseNum(document.getElementById('bewArmMm').value);
    if (isFinite(cg)) parts.push('CG ' + fmt(cg));
    el.textContent = parts.join(' · ');
  }

  function updateLegDerivedNotes(results) {
    $$('.leg-card', legsContainer).forEach(function (card, i) {
      var note = $('.leg-derived-note', card);
      var r = results[i];
      if (!r) { note.textContent = ''; return; }
      var mode = $('.consumption-mode-select', card).value;
      if (mode === 'actual') {
        note.textContent = 'Consumo da perna: ' + fmt(r.consumption) + ' kg';
      } else {
        note.textContent = 'Comb. no pouso: ' + fmt(r.fuelAtLanding) + ' kg';
      }
    });
  }

  function renderAlerts(globalIssues, results) {
    var list = document.getElementById('alertsList');
    list.innerHTML = '';
    var items = [];
    globalIssues.forEach(function (gi) { items.push({ level: gi.level, message: gi.message }); });
    results.forEach(function (r, i) {
      r.issues.forEach(function (iss) {
        items.push({ level: iss.level, message: 'Perna ' + (i + 1) + ' (' + r.originText + ' → ' + r.destText + '): ' + iss.message });
      });
    });
    if (!items.length) {
      var div = document.createElement('div');
      div.className = 'alert-item';
      div.textContent = results.length ? 'Nenhum alerta — todas as pernas dentro dos limites.' : 'Informe a rota e o manifesto para ver o resultado.';
      list.appendChild(div);
      return;
    }
    items.sort(function (a, b) { return (a.level === 'error' ? 0 : 1) - (b.level === 'error' ? 0 : 1); });
    items.forEach(function (it) {
      var d = document.createElement('div');
      d.className = 'alert-item ' + it.level;
      d.textContent = it.message;
      list.appendChild(d);
    });
  }

  function renderTable(results, criticalIndex) {
    var tbody = document.getElementById('flightTableBody');
    tbody.innerHTML = '';
    results.forEach(function (r, i) {
      var tr = document.createElement('tr');
      if (r.status === 'error') tr.classList.add('error-row');
      else if (i === criticalIndex) tr.classList.add('critical-row');
      var statusLabel = r.status === 'error' ? 'Fora' : (r.status === 'warn' ? 'Alerta' : 'OK');
      tr.innerHTML =
        '<td>' + escapeHtml(r.originText) + ' → ' + escapeHtml(r.destText) + '</td>' +
        '<td>' + fmt(r.payloadKg) + '</td>' +
        '<td>' + fmt(r.fuelAtStart) + '</td>' +
        '<td>' + fmt(r.tow) + '</td>' +
        '<td>' + fmt(r.lw) + '</td>' +
        '<td>' + fmt(r.fuelAtLanding) + '</td>' +
        '<td>' + fmt(r.paxOnBoard) + '</td>' +
        '<td>' + fmt(r.consumption) + '</td>' +
        '<td><span class="table-status-pill ' + r.status + '">' + statusLabel + '</span></td>';
      tbody.appendChild(tr);
    });
  }

  function getChartMode() {
    var sel = document.getElementById('chartModeSelect');
    return sel ? sel.value : 'cg';
  }

  function renderLegend(aircraft, watMax) {
    var legend = document.getElementById('chartLegend');
    var items;
    if (getChartMode() === 'cg') {
      items = [
        { color: '#e0615a', label: 'Envelope CG — ' + getCgEnvelope(aircraft).label },
        { color: 'rgba(70,194,186,1)', label: '● TOW → ○ LW (por perna)' },
        { color: '#58c78a', label: 'Mastro (STA 5000 mm)' }
      ];
    } else {
      items = [
        { color: 'rgba(70,194,186,1)', label: 'TOW → LW (perna)' },
        { color: '#9fb2c3', label: 'Parada (manifesto/reabastecimento)' },
        { color: '#e0615a', label: 'MTOW (' + fmt(aircraft.mtowCategory) + ' kg)' },
        { color: '#e0a94b', label: 'Máx. pouso (' + fmt(aircraft.maxLandingKg) + ' kg)' }
      ];
      if (watMax !== null) items.push({ color: '#8ab4f8', label: 'WAT máx. (' + fmt(watMax) + ' kg)' });
    }
    legend.innerHTML = items.map(function (it) {
      return '<span class="legend-item"><span class="swatch" style="background:' + it.color + '"></span>' + escapeHtml(it.label) + '</span>';
    }).join('');
  }

  function drawPoint(ctx, x, y, color) {
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }

  function setupCanvas(canvas) {
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.parentElement.getBoundingClientRect();
    var w = Math.max(rect.width, 10);
    var h = Math.max(rect.height, 10);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  function drawChart(canvas, results, aircraft, watMax, criticalIndex) {
    var c = setupCanvas(canvas);
    var ctx = c.ctx, w = c.w, h = c.h;

    if (!results.length) {
      ctx.fillStyle = '#9fb2c3';
      ctx.font = '13px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Sem dados — informe a rota para ver o gráfico.', w / 2, h / 2);
      return;
    }

    var padding = { top: 30, right: 20, bottom: 36, left: 58 };
    var plotW = w - padding.left - padding.right;
    var plotH = h - padding.top - padding.bottom;
    var n = results.length;

    var values = [];
    results.forEach(function (r) { values.push(r.tow, r.lw); });
    values.push(aircraft.mtowCategory, aircraft.maxLandingKg);
    if (watMax !== null) values.push(watMax);
    var yMin = Math.min.apply(Math, values);
    var yMax = Math.max.apply(Math, values);
    var yPad = Math.max(50, (yMax - yMin) * 0.15);
    yMin -= yPad;
    yMax += yPad;

    function xPix(x) { return padding.left + (x / n) * plotW; }
    function yPix(y) { return padding.top + (1 - (y - yMin) / (yMax - yMin)) * plotH; }

    var usedLabelYs = [];
    function reserveLabelY(y) {
      var adjusted = y;
      while (usedLabelYs.some(function (uy) { return Math.abs(uy - adjusted) < 12; })) {
        adjusted -= 12;
      }
      usedLabelYs.push(adjusted);
      return adjusted;
    }

    function drawLimitLine(value, color, label) {
      if (!isFinite(value)) return;
      var y = yPix(value);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = '11px Inter, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(label, padding.left + 4, reserveLabelY(y - 4));
      ctx.restore();
    }

    drawLimitLine(aircraft.mtowCategory, '#e0615a', 'MTOW ' + fmt(aircraft.mtowCategory) + ' kg');
    drawLimitLine(aircraft.maxLandingKg, '#e0a94b', 'Máx. pouso ' + fmt(aircraft.maxLandingKg) + ' kg');
    if (watMax !== null) drawLimitLine(watMax, '#8ab4f8', 'WAT máx. ' + fmt(watMax) + ' kg');

    ctx.strokeStyle = '#22384d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, h - padding.bottom);
    ctx.lineTo(w - padding.right, h - padding.bottom);
    ctx.stroke();

    ctx.fillStyle = '#9fb2c3';
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (var i = 0; i <= n; i++) {
      var x = xPix(i);
      var label = i === 0 ? results[0].originText : results[i - 1].destText;
      ctx.fillText(truncateLabel(label, 10), x, h - padding.bottom + 16);
    }

    results.forEach(function (r, idx) {
      var x0 = xPix(idx), y0 = yPix(r.tow);
      var x1 = xPix(idx + 1), y1 = yPix(r.lw);
      var isCritical = idx === criticalIndex;
      var lineColor = r.status === 'error' ? '#e0615a' : (isCritical ? '#e0a94b' : 'rgba(70,194,186,1)');
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = isCritical ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();

      var pointColor = r.status === 'error' ? '#e0615a' : '#46c2ba';
      drawPoint(ctx, x0, y0, pointColor);
      drawPoint(ctx, x1, y1, pointColor);

      ctx.fillStyle = '#e5eef8';
      ctx.font = '10px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(fmt(r.tow), x0, y0 - 8);
      ctx.fillText(fmt(r.lw), x1, y1 - 8);

      if (idx < n - 1) {
        var yNext = yPix(results[idx + 1].tow);
        ctx.save();
        ctx.strokeStyle = '#9fb2c3';
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1, yNext);
        ctx.stroke();
        ctx.restore();
      }
    });
  }

  function drawCgChart(canvas, results, aircraft) {
    var c = setupCanvas(canvas);
    var ctx = c.ctx, w = c.w, h = c.h;

    if (!isFinite(aircraft.bewArmMm)) {
      ctx.fillStyle = '#9fb2c3';
      ctx.font = '13px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Informe o CG do peso vazio (STA mm) no painel Aeronave', w / 2, h / 2 - 10);
      ctx.fillText('para plotar o voo no envelope da Fig. 1-1 do RFM.', w / 2, h / 2 + 10);
      return;
    }

    var cgEnv = getCgEnvelope(aircraft);
    var padding = { top: 34, right: 20, bottom: 40, left: 58 };
    var plotW = w - padding.left - padding.right;
    var plotH = h - padding.top - padding.bottom;

    var xMin = 4900, xMax = 5700;
    var yMin = 4200, yMax = cgEnv.maxKg + 200;
    results.forEach(function (r) {
      [[r.cgTowMm, r.tow], [r.cgLwMm, r.lw]].forEach(function (p) {
        if (p[0] !== null && isFinite(p[0])) {
          if (p[0] < xMin + 20) xMin = p[0] - 40;
          if (p[0] > xMax - 20) xMax = p[0] + 40;
          if (p[1] > yMax - 50) yMax = p[1] + 150;
          if (p[1] < yMin + 50) yMin = p[1] - 150;
        }
      });
    });

    function xPix(sta) { return padding.left + (sta - xMin) / (xMax - xMin) * plotW; }
    function yPix(kg) { return padding.top + (1 - (kg - yMin) / (yMax - yMin)) * plotH; }

    // grade
    ctx.strokeStyle = '#182838';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#9fb2c3';
    ctx.font = '10px Inter, system-ui, sans-serif';
    var gx;
    for (gx = Math.ceil(xMin / 100) * 100; gx <= xMax; gx += 100) {
      ctx.beginPath();
      ctx.moveTo(xPix(gx), padding.top);
      ctx.lineTo(xPix(gx), h - padding.bottom);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillText(String(gx), xPix(gx), h - padding.bottom + 14);
    }
    var gy;
    for (gy = Math.ceil(yMin / 200) * 200; gy <= yMax; gy += 200) {
      ctx.beginPath();
      ctx.moveTo(padding.left, yPix(gy));
      ctx.lineTo(w - padding.right, yPix(gy));
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(fmt(gy), padding.left - 6, yPix(gy) + 3);
    }

    // eixos e rótulos
    ctx.strokeStyle = '#22384d';
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, h - padding.bottom);
    ctx.lineTo(w - padding.right, h - padding.bottom);
    ctx.stroke();
    ctx.fillStyle = '#9fb2c3';
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('STA [mm]', padding.left + plotW / 2, h - 8);
    ctx.save();
    ctx.translate(14, padding.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Peso [kg]', 0, 0);
    ctx.restore();

    // linha do mastro
    ctx.save();
    ctx.strokeStyle = '#58c78a';
    ctx.setLineDash([8, 4, 2, 4]);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(xPix(MAST_STA_MM), padding.top);
    ctx.lineTo(xPix(MAST_STA_MM), h - padding.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#58c78a';
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('MASTRO', xPix(MAST_STA_MM) + 4, padding.top + 10);
    ctx.restore();

    // envelope certificado
    ctx.strokeStyle = '#e0615a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    cgEnv.points.forEach(function (p, i) {
      var px = xPix(p[0]), py = yPix(p[1]);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = '#e0615a';
    ctx.fill();
    ctx.restore();

    // título do envelope
    ctx.fillStyle = '#e0615a';
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(cgEnv.label + ' — E.A.S.A. Approved', padding.left + 4, padding.top - 8);

    // pontos por perna
    results.forEach(function (r, idx) {
      if (r.cgTowMm === null || !isFinite(r.cgTowMm)) return;
      var xTow = xPix(r.cgTowMm), yTow = yPix(r.tow);
      var inTow = r.tow >= cgEnv.minKg && r.tow <= cgEnv.maxKg && pointInPolygon(r.cgTowMm, r.tow, cgEnv.points);
      var color = inTow ? 'rgba(70,194,186,1)' : '#e0615a';

      if (r.cgLwMm !== null && isFinite(r.cgLwMm)) {
        var xLw = xPix(r.cgLwMm), yLw = yPix(r.lw);
        var inLw = r.lw >= cgEnv.minKg && r.lw <= cgEnv.maxKg && pointInPolygon(r.cgLwMm, r.lw, cgEnv.points);
        ctx.strokeStyle = (inTow && inLw) ? 'rgba(70,194,186,0.7)' : '#e0615a';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(xTow, yTow);
        ctx.lineTo(xLw, yLw);
        ctx.stroke();

        // LW: círculo vazado
        ctx.beginPath();
        ctx.strokeStyle = inLw ? 'rgba(70,194,186,1)' : '#e0615a';
        ctx.lineWidth = 2;
        ctx.fillStyle = '#111b26';
        ctx.arc(xLw, yLw, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // TOW: círculo cheio
      drawPoint(ctx, xTow, yTow, color);
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.arc(xTow, yTow, 5, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#e5eef8';
      ctx.font = 'bold 10px Inter, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('P' + (idx + 1), xTow + 7, yTow - 5);
    });
  }

  function renderChartsByMode() {
    if (!lastCalcResult) return;
    var mode = getChartMode();
    var results = lastCalcResult.results;
    var aircraft = lastCalcResult.aircraft;
    var canvases = [document.getElementById('weightChart')];
    if (!fullscreenOverlay.hidden) canvases.push(document.getElementById('weightChartFullscreen'));
    if (mode === 'cg') {
      canvases.forEach(function (cv) { drawCgChart(cv, results, aircraft); });
    } else {
      var criticalIndex = computeCriticalIndex(results, aircraft);
      canvases.forEach(function (cv) { drawChart(cv, results, aircraft, lastCalcResult.watMax, criticalIndex); });
    }
    var title = document.getElementById('chartTitle');
    if (title) title.textContent = mode === 'cg' ? 'Peso e balanceamento' : 'Evolução do peso';
    renderLegend(aircraft, lastCalcResult.watMax);
  }

  function redrawCharts() {
    renderChartsByMode();
  }

  function render(calcResult) {
    var aircraft = calcResult.aircraft;
    var results = calcResult.results;
    var globalIssues = calcResult.globalIssues;

    updateAircraftSummary();
    updateLegDerivedNotes(results);
    updateRouteLegsNote(calcResult.stops);

    var criticalIndex = computeCriticalIndex(results, aircraft);

    var anyError = globalIssues.some(function (x) { return x.level === 'error'; }) ||
      results.some(function (r) { return r.status === 'error'; });
    var anyWarn = results.some(function (r) { return r.status === 'warn'; });

    if (!results.length) setStatusChip('idle', 'Aguardando');
    else if (anyError) setStatusChip('error', 'Fora de limites');
    else if (anyWarn) setStatusChip('warn', 'Alerta');
    else setStatusChip('ok', 'OK');

    if (results.length) {
      var maxTow = -Infinity, maxTowIdx = -1;
      results.forEach(function (r, i) { if (r.tow > maxTow) { maxTow = r.tow; maxTowIdx = i; } });
      document.getElementById('maxTowValue').textContent = fmt(maxTow) + ' kg';
      document.getElementById('maxTowSub').textContent = 'Perna ' + (maxTowIdx + 1) + ' (' + results[maxTowIdx].originText + ' → ' + results[maxTowIdx].destText + ')';

      var mtowMargin = computeMinMtowMargin(results);
      document.getElementById('minMarginValue').textContent = fmt(mtowMargin.value) + ' kg';
      document.getElementById('minMarginSub').textContent = 'Perna ' + (mtowMargin.index + 1) + ' (' + results[mtowMargin.index].originText + ' → ' + results[mtowMargin.index].destText + ')';

      var finalFuel = results[results.length - 1].fuelAtLanding;
      document.getElementById('finalFuelValue').textContent = fmt(finalFuel) + ' kg';
      document.getElementById('finalFuelSub').textContent = 'Mínimo exigido: ' + fmt(aircraft.minLandingFuelKg) + ' kg';

      document.getElementById('totalPaxValue').textContent = fmt(calcResult.totalPaxBoardKg) + ' kg';
      document.getElementById('totalPaxSub').textContent = 'Somatório dos embarques do manifesto';
    } else {
      ['maxTowValue', 'minMarginValue', 'finalFuelValue', 'totalPaxValue'].forEach(function (id) {
        document.getElementById(id).textContent = '—';
      });
      ['maxTowSub', 'minMarginSub', 'finalFuelSub', 'totalPaxSub'].forEach(function (id) {
        document.getElementById(id).textContent = '—';
      });
    }

    renderAlerts(globalIssues, results);
    renderTable(results, criticalIndex);
    renderChartsByMode();
  }

  function scheduleRecalc() {
    clearTimeout(recalcTimer);
    recalcTimer = setTimeout(function () {
      lastCalcResult = computeWithAutofill();
      render(lastCalcResult);
      saveForm();
    }, 60);
  }

  // ---------------------------------------------------------------------
  // Contexto compartilhado (integração futura com o AW139 Companion)
  // ---------------------------------------------------------------------

  function writeSharedContext(calcResult) {
    var aircraft = calcResult.aircraft;
    var results = calcResult.results;
    if (!results.length) return;

    var criticalIndex = computeCriticalIndex(results, aircraft);
    var critical = results[criticalIndex];
    var maxTow = -Infinity;
    results.forEach(function (r) { if (r.tow > maxTow) maxTow = r.tow; });

    try {
      var existingRaw = localStorage.getItem(SHARED_KEY);
      var existing = existingRaw ? JSON.parse(existingRaw) : {};
      var updated = Object.assign({}, existing, {
        pesoTowMaxKg: round1(maxTow),
        pesoPernaCritica: criticalIndex + 1,
        pesoZfwKg: round1(critical.zfw),
        weightKg: round1(critical.tow),
        updatedAt: new Date().toISOString(),
        lastModule: 'pesos'
      });
      if (critical.cgTowMm !== null && isFinite(critical.cgTowMm)) {
        updated.pesoCgTowMm = round1(critical.cgTowMm);
      }
      var reg = document.getElementById('registrationInput').value.trim();
      if (reg) updated.pesoMatricula = reg;
      updated.pesoWeatherPorPerna = results.map(function (r) {
        return { perna: r.index + 1, destino: r.destText, weather: r.weather };
      });
      localStorage.setItem(SHARED_KEY, JSON.stringify(updated));
    } catch (e) { /* localStorage indisponível */ }
  }

  // ---------------------------------------------------------------------
  // Persistência do formulário
  // ---------------------------------------------------------------------

  function serializeForm() {
    var aircraft = {
      registration: document.getElementById('registrationInput').value,
      bewKg: document.getElementById('bewKg').value,
      crewKg: document.getElementById('crewKg').value,
      mtowCategory: document.getElementById('mtowCategory').value,
      maxLandingKg: document.getElementById('maxLandingKg').value,
      minLandingFuelKg: document.getElementById('minLandingFuelKg').value,
      bewArmMm: document.getElementById('bewArmMm').value,
      paxArmMm: document.getElementById('paxArmMm').value,
      cargoArmMm: document.getElementById('cargoArmMm').value
    };
    var manifest = $$('.manifest-row', manifestRowsContainer).map(function (row) {
      return {
        from: $('.manifest-from-select', row).value,
        to: $('.manifest-to-select', row).value,
        pax: $('.manifest-pax-input', row).value,
        bag: $('.manifest-bag-input', row).value,
        cargo: $('.manifest-cargo-input', row).value,
        unit: $('.manifest-unit-select', row).value
      };
    });
    var legs = $$('.leg-card', legsContainer).map(function (card) {
      return {
        mode: $('.consumption-mode-select', card).value,
        takeoffFuel: $('.takeoff-fuel-input', card).value,
        landingFuel: $('.landing-fuel-actual-input', card).value,
        consumption: $('.consumption-input', card).value,
        timeMin: $('.flight-time-input', card).value,
        rateKgH: $('.fuel-rate-input', card).value,
        takeoffManual: $('.takeoff-fuel-input', card).dataset.manual === '1',
        weather: getLegWeather(card)
      };
    });
    return {
      aircraft: aircraft,
      route: document.getElementById('routeInput').value,
      manifest: manifest,
      legs: legs
    };
  }

  function saveForm() {
    try {
      localStorage.setItem(FORM_KEY, JSON.stringify(serializeForm()));
    } catch (e) { /* localStorage indisponível */ }
  }

  function loadForm() {
    var data = null;
    try {
      var raw = localStorage.getItem(FORM_KEY);
      if (raw) data = JSON.parse(raw);
    } catch (e) { data = null; }

    var a = (data && data.aircraft) || {};
    if (a.registration !== undefined) document.getElementById('registrationInput').value = a.registration;
    if (a.bewKg !== undefined) document.getElementById('bewKg').value = a.bewKg;
    if (a.crewKg !== undefined) document.getElementById('crewKg').value = a.crewKg;
    if (a.mtowCategory !== undefined) document.getElementById('mtowCategory').value = a.mtowCategory;
    if (a.maxLandingKg !== undefined) document.getElementById('maxLandingKg').value = a.maxLandingKg;
    if (a.minLandingFuelKg !== undefined) document.getElementById('minLandingFuelKg').value = a.minLandingFuelKg;
    if (a.bewArmMm !== undefined) document.getElementById('bewArmMm').value = a.bewArmMm;
    if (a.paxArmMm !== undefined) document.getElementById('paxArmMm').value = a.paxArmMm;
    if (a.cargoArmMm !== undefined) document.getElementById('cargoArmMm').value = a.cargoArmMm;

    document.getElementById('routeInput').value = (data && data.route) || '';
    var stops = getStops();
    rebuildLegCards(stops);

    var legs = (data && Array.isArray(data.legs)) ? data.legs : [];
    $$('.leg-card', legsContainer).forEach(function (card, i) {
      var legData = legs[i] || {};
      $('.consumption-mode-select', card).value = legData.mode || 'actual';
      $('.takeoff-fuel-input', card).value = legData.takeoffFuel || '';
      $('.landing-fuel-actual-input', card).value = legData.landingFuel || '';
      $('.consumption-input', card).value = legData.consumption || '';
      $('.flight-time-input', card).value = legData.timeMin || '';
      $('.fuel-rate-input', card).value = legData.rateKgH || '400';
      if (legData.takeoffManual) $('.takeoff-fuel-input', card).dataset.manual = '1';
      if (legData.weather) card.dataset.weather = JSON.stringify(legData.weather);
      updateWxButton(card);
      toggleConsumptionMode(card);
    });

    var manifest = (data && Array.isArray(data.manifest) && data.manifest.length) ? data.manifest : [{}];
    manifest.forEach(function (rowData) { addManifestRow(rowData); });
  }

  // ---------------------------------------------------------------------
  // Mostrar/ocultar a tabela e o gráfico
  // ---------------------------------------------------------------------

  function setTableVisible(visible) {
    var container = document.getElementById('tableContainer');
    var btn = document.getElementById('toggleTableBtn');
    container.hidden = !visible;
    btn.textContent = visible ? 'Ocultar tabela' : 'Mostrar tabela';
    btn.setAttribute('aria-expanded', visible ? 'true' : 'false');
    try { localStorage.setItem(TABLE_VISIBLE_KEY, visible ? '1' : '0'); } catch (e) { /* noop */ }
  }

  function loadTableVisible() {
    var stored = null;
    try { stored = localStorage.getItem(TABLE_VISIBLE_KEY); } catch (e) { stored = null; }
    setTableVisible(stored !== '0');
  }

  function setChartVisible(visible) {
    var pane = document.querySelector('.viewer-pane');
    var workspace = document.querySelector('.workspace');
    var btn = document.getElementById('toggleChartBtn');
    pane.hidden = !visible;
    workspace.classList.toggle('chart-hidden', !visible);
    btn.textContent = visible ? 'Ocultar gráfico' : 'Mostrar gráfico';
    btn.setAttribute('aria-expanded', visible ? 'true' : 'false');
    try { localStorage.setItem(CHART_VISIBLE_KEY, visible ? '1' : '0'); } catch (e) { /* noop */ }
    if (visible) requestAnimationFrame(redrawCharts);
  }

  function loadChartVisible() {
    var stored = null;
    try { stored = localStorage.getItem(CHART_VISIBLE_KEY); } catch (e) { stored = null; }
    setChartVisible(stored !== '0');
  }

  // ---------------------------------------------------------------------
  // Eventos
  // ---------------------------------------------------------------------

  function isFormField(el) {
    return el && el.closest && el.closest('.sidebar');
  }

  function handleRouteInput(el) {
    var pos = el.selectionStart;
    var upper = el.value.toUpperCase();
    if (el.value !== upper) {
      el.value = upper;
      try { el.setSelectionRange(pos, pos); } catch (e) { /* noop */ }
    }
    rebuildLegCards(getStops());
    refreshManifestSelects();
  }

  function forceUppercase(el) {
    var pos = el.selectionStart;
    var upper = el.value.toUpperCase();
    if (el.value !== upper) {
      el.value = upper;
      try { el.setSelectionRange(pos, pos); } catch (e) { /* noop */ }
    }
  }

  function handleFormEvent(e) {
    var t = e.target;
    if (t.id === 'routeInput') handleRouteInput(t);
    if (t.id === 'registrationInput') forceUppercase(t);
    if (t.classList.contains('consumption-mode-select')) {
      toggleConsumptionMode(t.closest('.leg-card'));
    }
    if (t.id === 'mtowCategory') updateMaxLandingPlaceholder();
    scheduleRecalc();
  }

  function updateMaxLandingPlaceholder() {
    var cat = document.getElementById('mtowCategory').value;
    document.getElementById('maxLandingKg').placeholder = 'default: ' + cat + ' kg';
  }

  function init() {
    applyQueryParams();
    loadForm();
    updateMaxLandingPlaceholder();

    document.addEventListener('input', function (e) {
      if (!isFormField(e.target)) return;
      if (e.isTrusted && e.target.matches && e.target.matches(AUTOFILL_SELECTOR)) {
        e.target.dataset.manual = '1';
      }
      handleFormEvent(e);
    });
    document.addEventListener('change', function (e) {
      if (!isFormField(e.target)) return;
      if (e.target.matches && e.target.matches(AUTOFILL_SELECTOR) && e.target.value.trim() === '') {
        delete e.target.dataset.manual;
      }
      if (e.target.classList.contains('manifest-unit-select')) {
        convertManifestRowUnits(e.target);
      }
      handleFormEvent(e);
    });

    legsContainer.addEventListener('click', function (e) {
      var btn = e.target.closest('.wx-btn');
      if (btn) openWxDialog(btn.closest('.leg-card'));
    });

    var wxOverlay = document.getElementById('wxOverlay');
    document.getElementById('wxType').addEventListener('change', applyWxTypeVisibility);
    document.getElementById('wxSaveBtn').addEventListener('click', closeWxDialog);
    document.getElementById('wxCloseBtn').addEventListener('click', closeWxDialog);
    document.getElementById('wxClearBtn').addEventListener('click', function () {
      WX_FIELDS.forEach(function (f) { document.getElementById(f[1]).value = ''; });
    });
    wxOverlay.addEventListener('click', function (e) {
      if (e.target === wxOverlay) closeWxDialog();
    });

    manifestRowsContainer.addEventListener('click', function (e) {
      if (e.target.classList.contains('remove-manifest-row-btn')) {
        var row = e.target.closest('.manifest-row');
        if (row && $$('.manifest-row', manifestRowsContainer).length > 1) {
          row.remove();
          scheduleRecalc();
        }
      }
    });

    document.getElementById('addManifestRowBtn').addEventListener('click', function () {
      addManifestRow(null);
      scheduleRecalc();
    });

    document.getElementById('roundTripBtn').addEventListener('click', function () {
      var stops = getStops();
      if (stops.length < 2) return;
      var back = stops.slice(0, stops.length - 1).reverse();
      document.getElementById('routeInput').value = stops.concat(back).join(' ');
      rebuildLegCards(getStops());
      refreshManifestSelects();
      scheduleRecalc();
    });

    document.getElementById('runBtn').addEventListener('click', function () {
      lastCalcResult = computeWithAutofill();
      render(lastCalcResult);
      saveForm();
      writeSharedContext(lastCalcResult);
      if (window.innerWidth < 900) {
        var stack = document.querySelector('.top-stack');
        var stackH = stack ? stack.offsetHeight : 0;
        var y = document.getElementById('resultPanel').getBoundingClientRect().top + window.scrollY - stackH - 8;
        window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
      }
    });

    document.getElementById('resetBtn').addEventListener('click', function () {
      if (!window.confirm('Limpar todos os dados do formulário?')) return;
      try { localStorage.removeItem(FORM_KEY); } catch (e) { /* noop */ }
      document.getElementById('registrationInput').value = '';
      document.getElementById('bewKg').value = '';
      document.getElementById('crewKg').value = '170';
      document.getElementById('mtowCategory').value = '7000';
      document.getElementById('maxLandingKg').value = '';
      document.getElementById('minLandingFuelKg').value = '240';
      document.getElementById('bewArmMm').value = '';
      document.getElementById('paxArmMm').value = '4601';
      document.getElementById('cargoArmMm').value = '7700';
      document.getElementById('routeInput').value = '';
      manifestRowsContainer.innerHTML = '';
      legsContainer.innerHTML = '';
      rebuildLegCards([]);
      addManifestRow(null);
      document.getElementById('aircraftDetails').open = true;
      updateMaxLandingPlaceholder();
      scheduleRecalc();
    });

    document.getElementById('shareBtn').addEventListener('click', function () { window.print(); });

    document.getElementById('toggleTableBtn').addEventListener('click', function () {
      var container = document.getElementById('tableContainer');
      setTableVisible(container.hidden);
    });
    loadTableVisible();

    document.getElementById('toggleChartBtn').addEventListener('click', function () {
      var pane = document.querySelector('.viewer-pane');
      setChartVisible(pane.hidden);
    });
    loadChartVisible();

    // O PDF compartilhado deve sempre incluir o gráfico: redesenha com o
    // viewer visível antes de imprimir e restaura o estado depois.
    var chartHiddenBeforePrint = false;
    window.addEventListener('beforeprint', function () {
      var pane = document.querySelector('.viewer-pane');
      chartHiddenBeforePrint = pane.hidden;
      if (chartHiddenBeforePrint) {
        pane.hidden = false;
        redrawCharts();
      }
    });
    window.addEventListener('afterprint', function () {
      if (chartHiddenBeforePrint) {
        document.querySelector('.viewer-pane').hidden = true;
        chartHiddenBeforePrint = false;
      }
    });

    var chartModeSelect = document.getElementById('chartModeSelect');
    try {
      var storedMode = localStorage.getItem(CHART_MODE_KEY);
      if (storedMode === 'cg' || storedMode === 'weight') chartModeSelect.value = storedMode;
    } catch (e) { /* noop */ }
    chartModeSelect.addEventListener('change', function () {
      try { localStorage.setItem(CHART_MODE_KEY, chartModeSelect.value); } catch (e) { /* noop */ }
      renderChartsByMode();
    });

    var aircraftDetails = document.getElementById('aircraftDetails');
    var storedOpen = null;
    try { storedOpen = localStorage.getItem(AIRCRAFT_OPEN_KEY); } catch (e) { storedOpen = null; }
    if (storedOpen === '1') aircraftDetails.open = true;
    else if (storedOpen === '0') aircraftDetails.open = false;
    else aircraftDetails.open = document.getElementById('bewKg').value.trim() === '';
    aircraftDetails.addEventListener('toggle', function () {
      try { localStorage.setItem(AIRCRAFT_OPEN_KEY, aircraftDetails.open ? '1' : '0'); } catch (e) { /* noop */ }
    });

    document.getElementById('fullscreenBtn').addEventListener('click', function () {
      fullscreenOverlay.hidden = false;
      requestAnimationFrame(redrawCharts);
    });
    document.getElementById('closeFullscreenBtn').addEventListener('click', function () {
      fullscreenOverlay.hidden = true;
    });
    fullscreenOverlay.addEventListener('click', function (e) {
      if (e.target === fullscreenOverlay) fullscreenOverlay.hidden = true;
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var wx = document.getElementById('wxOverlay');
      if (!wx.hidden) { closeWxDialog(); return; }
      if (!fullscreenOverlay.hidden) fullscreenOverlay.hidden = true;
    });

    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(redrawCharts, 120);
    });

    lastCalcResult = computeWithAutofill();
    render(lastCalcResult);

    // hook de depuração/testes (não usado pela UI)
    window.aw139PesosDebug = function () { return lastCalcResult; };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* noop */ });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
