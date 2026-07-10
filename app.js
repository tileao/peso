'use strict';

(function () {
  var FORM_KEY = 'aw139_pesos_form_v1';
  var SHARED_KEY = 'aw139_companion_shared_context_v1';

  var legsContainer = document.getElementById('legsContainer');
  var legTemplate = document.getElementById('legTemplate');
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
  // Leg card management
  // ---------------------------------------------------------------------

  function createLegCard() {
    var frag = legTemplate.content.cloneNode(true);
    return frag.querySelector('.leg-card');
  }

  function toggleConsumptionMode(card) {
    var mode = $('.consumption-mode-select', card).value;
    $('.consumption-manual-row', card).hidden = mode !== 'manual';
    $('.consumption-time-row', card).hidden = mode !== 'time';
  }

  function applyLegData(card, data) {
    if (data.dest !== undefined) $('.dest-input', card).value = data.dest;
    if (data.consumptionKg !== undefined && isFinite(data.consumptionKg)) {
      $('.consumption-mode-select', card).value = 'manual';
      $('.consumption-input', card).value = String(round1(data.consumptionKg)).replace('.', ',');
    }
  }

  function addLeg(initial, silent) {
    var card = createLegCard();
    legsContainer.appendChild(card);
    if (initial) applyLegData(card, initial);
    toggleConsumptionMode(card);
    renumberLegs();
    if (!silent) {
      scheduleRecalc();
      saveForm();
    }
    return card;
  }

  function removeLeg(card) {
    if (legsContainer.children.length <= 1) return;
    card.remove();
    renumberLegs();
    scheduleRecalc();
    saveForm();
  }

  function moveLeg(card, dir) {
    if (dir === -1 && card.previousElementSibling) {
      legsContainer.insertBefore(card, card.previousElementSibling);
    } else if (dir === 1 && card.nextElementSibling) {
      legsContainer.insertBefore(card.nextElementSibling, card);
    }
    renumberLegs();
    scheduleRecalc();
    saveForm();
  }

  function renumberLegs() {
    var cards = $$('.leg-card', legsContainer);
    cards.forEach(function (card, i) {
      var isFirst = i === 0;
      var isLast = i === cards.length - 1;
      $('.leg-number', card).textContent = 'Perna ' + (i + 1);
      $('.leg-first-only', card).hidden = !isFirst;
      $('.computed-origin-note', card).hidden = isFirst;
      $('.stopover-block', card).hidden = isLast;
      $('.move-up-btn', card).disabled = isFirst;
      $('.move-down-btn', card).disabled = isLast;
      $('.remove-leg-btn', card).disabled = cards.length <= 1;
    });
    updateStopoverLabels();
  }

  function updateStopoverLabels() {
    $$('.leg-card', legsContainer).forEach(function (card) {
      var dest = $('.dest-input', card).value.trim() || '—';
      $('.stopover-dest-label', card).textContent = dest;
    });
  }

  function updateComputedOriginLabels(results) {
    $$('.leg-card', legsContainer).forEach(function (card, i) {
      if (i === 0) return;
      var label = $('.computed-origin-text', card);
      label.textContent = results[i] ? results[i].originText : '—';
    });
  }

  function updateMaxLandingPlaceholder() {
    var cat = document.getElementById('mtowCategory').value;
    document.getElementById('maxLandingKg').placeholder = 'default: ' + cat + ' kg';
  }

  // ---------------------------------------------------------------------
  // "Voo de volta" — duplica a rota invertida como atalho
  // ---------------------------------------------------------------------

  function addRoundTrip() {
    var state = compute();
    var results = state.results;
    if (!results.length) return;

    var n = results.length;
    var stops = [results[0].originText];
    results.forEach(function (r) { stops.push(r.destText); });
    var reversedStops = stops.slice().reverse();

    for (var k = 0; k < n; k++) {
      var toName = reversedStops[k + 1];
      var forwardLegIdx = n - 1 - k;
      var consumption = results[forwardLegIdx].consumption;
      addLeg({ dest: toName, consumptionKg: consumption }, true);
    }
    renumberLegs();
    scheduleRecalc();
    saveForm();
  }

  // ---------------------------------------------------------------------
  // Leitura do estado a partir do DOM
  // ---------------------------------------------------------------------

  function readAircraft() {
    return {
      bewKg: parseNum(document.getElementById('bewKg').value),
      crewKg: numWithDefault('crewKg', 170),
      mtowCategory: parseNum(document.getElementById('mtowCategory').value),
      maxLandingKg: numWithDefault('maxLandingKg', parseNum(document.getElementById('mtowCategory').value)),
      paxWeightKg: numWithDefault('paxWeightKg', 90),
      minLandingFuelKg: numWithDefault('minLandingFuelKg', 240)
    };
  }

  function readLegsFromDOM() {
    return $$('.leg-card', legsContainer).map(function (card, i) {
      var mode = $('.consumption-mode-select', card).value;
      var consumption;
      if (mode === 'time') {
        var timeMin = parseNum($('.flight-time-input', card).value);
        var rate = parseNum($('.fuel-rate-input', card).value);
        consumption = (isFinite(timeMin) && isFinite(rate)) ? (timeMin / 60) * rate : NaN;
      } else {
        consumption = parseNum($('.consumption-input', card).value);
      }
      return {
        origin: i === 0 ? ($('.origin-input', card).value.trim() || 'Origem') : null,
        dest: $('.dest-input', card).value.trim() || ('Destino ' + (i + 1)),
        startFuelKg: i === 0 ? parseNum($('.start-fuel-input', card).value) : null,
        startPax: i === 0 ? parseNum($('.start-pax-input', card).value) : null,
        startCargoKg: i === 0 ? parseNum($('.start-cargo-input', card).value) : null,
        consumptionKg: consumption,
        paxOff: parseNum($('.pax-off-input', card).value),
        paxOn: parseNum($('.pax-on-input', card).value),
        cargoOffKg: parseNum($('.cargo-off-input', card).value),
        cargoOnKg: parseNum($('.cargo-on-input', card).value),
        refuelKg: parseNum($('.refuel-input', card).value)
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
    var rawLegs = readLegsFromDOM();
    var shared = readSharedContext();
    var watMax = (shared && isFinite(parseFloat(shared.watMaxWeightKg))) ? parseFloat(shared.watMaxWeightKg) : null;
    var mtow = aircraft.mtowCategory;

    var globalIssues = [];
    if (!isFinite(aircraft.bewKg)) {
      globalIssues.push({ level: 'error', message: 'Informe o peso básico da aeronave (BEW).' });
    }

    var results = [];
    if (!rawLegs.length) return { aircraft: aircraft, results: results, watMax: watMax, globalIssues: globalIssues, totalPaxBoardings: 0 };

    var paxOnBoard = numOr0(rawLegs[0].startPax);
    var cargoOnBoard = numOr0(rawLegs[0].startCargoKg);
    var fuelAtStart = rawLegs[0].startFuelKg;
    var originText = rawLegs[0].origin || 'Origem';
    var totalPaxBoardings = paxOnBoard;

    rawLegs.forEach(function (leg, i) {
      var legIssues = [];
      var isLast = i === rawLegs.length - 1;

      var zfw = numOr0(aircraft.bewKg) + aircraft.crewKg + paxOnBoard * aircraft.paxWeightKg + cargoOnBoard;
      var startFuel = isFinite(fuelAtStart) ? fuelAtStart : 0;
      if (!isFinite(fuelAtStart)) {
        legIssues.push({ level: 'error', message: 'Combustível na decolagem não informado.' });
      }
      var tow = zfw + startFuel;
      var consumption = isFinite(leg.consumptionKg) ? leg.consumptionKg : 0;
      if (!isFinite(leg.consumptionKg)) {
        legIssues.push({ level: 'error', message: 'Consumo da perna não informado.' });
      }
      var lw = tow - consumption;
      var fuelAtLanding = startFuel - consumption;

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

      var paxOff = 0, paxOn = 0, cargoOffKg = 0, cargoOnKg = 0, refuelKg = 0;
      if (!isLast) {
        paxOff = numOr0(leg.paxOff);
        paxOn = numOr0(leg.paxOn);
        cargoOffKg = numOr0(leg.cargoOffKg);
        cargoOnKg = numOr0(leg.cargoOnKg);
        refuelKg = numOr0(leg.refuelKg);
        if (paxOff > paxOnBoard + 1e-9) {
          legIssues.push({ level: 'error', message: 'Pax a desembarcar (' + fmt(paxOff) + ') maior que pax a bordo (' + fmt(paxOnBoard) + ')' });
        }
        if (cargoOffKg > cargoOnBoard + 1e-9) {
          legIssues.push({ level: 'error', message: 'Carga a sair (' + fmt(cargoOffKg) + ' kg) maior que carga a bordo (' + fmt(cargoOnBoard) + ' kg)' });
        }
      }

      var worst = 'ok';
      if (legIssues.some(function (x) { return x.level === 'error'; })) worst = 'error';
      else if (legIssues.some(function (x) { return x.level === 'warn'; })) worst = 'warn';

      results.push({
        index: i,
        originText: originText,
        destText: leg.dest,
        zfw: zfw,
        tow: tow,
        consumption: consumption,
        lw: lw,
        fuelAtStart: startFuel,
        fuelAtLanding: fuelAtLanding,
        paxOnBoard: paxOnBoard,
        cargoOnBoard: cargoOnBoard,
        marginToMtow: marginToMtow,
        watMargin: watMargin,
        issues: legIssues,
        status: worst
      });

      if (!isLast) {
        paxOnBoard = Math.max(0, paxOnBoard - paxOff + paxOn);
        cargoOnBoard = Math.max(0, cargoOnBoard - cargoOffKg + cargoOnKg);
        fuelAtStart = fuelAtLanding + refuelKg;
        originText = leg.dest;
        totalPaxBoardings += paxOn;
      }
    });

    return { aircraft: aircraft, results: results, watMax: watMax, globalIssues: globalIssues, totalPaxBoardings: totalPaxBoardings };
  }

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  function setStatusChip(state, text) {
    var chip = document.getElementById('statusChip');
    chip.dataset.state = state;
    chip.textContent = text;
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
      div.textContent = results.length ? 'Nenhum alerta — todas as pernas dentro dos limites.' : 'Adicione pernas e calcule para ver o resultado.';
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
        '<td>' + fmt(r.zfw) + '</td>' +
        '<td>' + fmt(r.fuelAtStart) + '</td>' +
        '<td>' + fmt(r.tow) + '</td>' +
        '<td>' + fmt(r.consumption) + '</td>' +
        '<td>' + fmt(r.lw) + '</td>' +
        '<td>' + fmt(r.fuelAtLanding) + '</td>' +
        '<td>' + fmt(r.paxOnBoard) + '</td>' +
        '<td><span class="table-status-pill ' + r.status + '">' + statusLabel + '</span></td>';
      tbody.appendChild(tr);
    });
  }

  function renderLegend(aircraft, watMax) {
    var legend = document.getElementById('chartLegend');
    var items = [
      { color: 'rgba(70,194,186,1)', label: 'TOW → LW (perna)' },
      { color: '#9fb2c3', label: 'Parada (pax/carga/reabastecimento)' },
      { color: '#e0615a', label: 'MTOW (' + fmt(aircraft.mtowCategory) + ' kg)' },
      { color: '#e0a94b', label: 'Máx. pouso (' + fmt(aircraft.maxLandingKg) + ' kg)' }
    ];
    if (watMax !== null) items.push({ color: '#8ab4f8', label: 'WAT máx. (' + fmt(watMax) + ' kg)' });
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

  function drawChart(canvas, results, aircraft, watMax, criticalIndex) {
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

    if (!results.length) {
      ctx.fillStyle = '#9fb2c3';
      ctx.font = '13px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Sem dados — calcule o voo para ver o gráfico.', w / 2, h / 2);
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

  function redrawCharts() {
    if (!lastCalcResult) return;
    var criticalIndex = computeCriticalIndex(lastCalcResult.results, lastCalcResult.aircraft);
    drawChart(document.getElementById('weightChart'), lastCalcResult.results, lastCalcResult.aircraft, lastCalcResult.watMax, criticalIndex);
    if (!fullscreenOverlay.hidden) {
      drawChart(document.getElementById('weightChartFullscreen'), lastCalcResult.results, lastCalcResult.aircraft, lastCalcResult.watMax, criticalIndex);
    }
  }

  function render(calcResult) {
    var aircraft = calcResult.aircraft;
    var results = calcResult.results;
    var watMax = calcResult.watMax;
    var globalIssues = calcResult.globalIssues;

    updateComputedOriginLabels(results);
    updateStopoverLabels();

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

      document.getElementById('totalPaxValue').textContent = fmt(calcResult.totalPaxBoardings);
      document.getElementById('totalPaxSub').textContent = 'Embarques ao longo do voo';
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
    renderLegend(aircraft, watMax);
    drawChart(document.getElementById('weightChart'), results, aircraft, watMax, criticalIndex);
    if (!fullscreenOverlay.hidden) {
      drawChart(document.getElementById('weightChartFullscreen'), results, aircraft, watMax, criticalIndex);
    }
  }

  function scheduleRecalc() {
    clearTimeout(recalcTimer);
    recalcTimer = setTimeout(function () {
      lastCalcResult = compute();
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
      localStorage.setItem(SHARED_KEY, JSON.stringify(updated));
    } catch (e) { /* localStorage indisponível */ }
  }

  // ---------------------------------------------------------------------
  // Persistência do formulário
  // ---------------------------------------------------------------------

  function serializeForm() {
    var aircraft = {
      bewKg: document.getElementById('bewKg').value,
      crewKg: document.getElementById('crewKg').value,
      mtowCategory: document.getElementById('mtowCategory').value,
      maxLandingKg: document.getElementById('maxLandingKg').value,
      paxWeightKg: document.getElementById('paxWeightKg').value,
      minLandingFuelKg: document.getElementById('minLandingFuelKg').value
    };
    var legs = $$('.leg-card', legsContainer).map(function (card) {
      return {
        origin: $('.origin-input', card).value,
        startFuelKg: $('.start-fuel-input', card).value,
        startPax: $('.start-pax-input', card).value,
        startCargoKg: $('.start-cargo-input', card).value,
        dest: $('.dest-input', card).value,
        consumptionMode: $('.consumption-mode-select', card).value,
        consumptionKg: $('.consumption-input', card).value,
        flightTimeMin: $('.flight-time-input', card).value,
        fuelRateKgH: $('.fuel-rate-input', card).value,
        paxOff: $('.pax-off-input', card).value,
        paxOn: $('.pax-on-input', card).value,
        cargoOffKg: $('.cargo-off-input', card).value,
        cargoOnKg: $('.cargo-on-input', card).value,
        refuelKg: $('.refuel-input', card).value
      };
    });
    return { aircraft: aircraft, legs: legs };
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
    if (a.bewKg !== undefined) document.getElementById('bewKg').value = a.bewKg;
    if (a.crewKg !== undefined) document.getElementById('crewKg').value = a.crewKg;
    if (a.mtowCategory !== undefined) document.getElementById('mtowCategory').value = a.mtowCategory;
    if (a.maxLandingKg !== undefined) document.getElementById('maxLandingKg').value = a.maxLandingKg;
    if (a.paxWeightKg !== undefined) document.getElementById('paxWeightKg').value = a.paxWeightKg;
    if (a.minLandingFuelKg !== undefined) document.getElementById('minLandingFuelKg').value = a.minLandingFuelKg;

    var legs = (data && Array.isArray(data.legs) && data.legs.length) ? data.legs : [{}];
    legs.forEach(function (legData) {
      var card = createLegCard();
      legsContainer.appendChild(card);
      $('.origin-input', card).value = legData.origin || '';
      $('.start-fuel-input', card).value = legData.startFuelKg || '';
      $('.start-pax-input', card).value = legData.startPax !== undefined ? legData.startPax : '0';
      $('.start-cargo-input', card).value = legData.startCargoKg !== undefined ? legData.startCargoKg : '0';
      $('.dest-input', card).value = legData.dest || '';
      $('.consumption-mode-select', card).value = legData.consumptionMode || 'manual';
      $('.consumption-input', card).value = legData.consumptionKg || '';
      $('.flight-time-input', card).value = legData.flightTimeMin || '';
      $('.fuel-rate-input', card).value = legData.fuelRateKgH || '400';
      $('.pax-off-input', card).value = legData.paxOff !== undefined ? legData.paxOff : '0';
      $('.pax-on-input', card).value = legData.paxOn !== undefined ? legData.paxOn : '0';
      $('.cargo-off-input', card).value = legData.cargoOffKg !== undefined ? legData.cargoOffKg : '0';
      $('.cargo-on-input', card).value = legData.cargoOnKg !== undefined ? legData.cargoOnKg : '0';
      $('.refuel-input', card).value = legData.refuelKg !== undefined ? legData.refuelKg : '0';
      toggleConsumptionMode(card);
    });
    renumberLegs();
  }

  // ---------------------------------------------------------------------
  // Eventos
  // ---------------------------------------------------------------------

  function isFormField(el) {
    return el && el.closest && el.closest('.sidebar');
  }

  function handleFormEvent(e) {
    var t = e.target;
    if (t.classList.contains('consumption-mode-select')) {
      toggleConsumptionMode(t.closest('.leg-card'));
    }
    if (t.classList.contains('dest-input')) {
      updateStopoverLabels();
    }
    if (t.id === 'mtowCategory') {
      updateMaxLandingPlaceholder();
    }
    scheduleRecalc();
  }

  function init() {
    applyQueryParams();
    loadForm();
    updateMaxLandingPlaceholder();

    document.addEventListener('input', function (e) { if (isFormField(e.target)) handleFormEvent(e); });
    document.addEventListener('change', function (e) { if (isFormField(e.target)) handleFormEvent(e); });

    legsContainer.addEventListener('click', function (e) {
      var card = e.target.closest('.leg-card');
      if (!card) return;
      if (e.target.classList.contains('remove-leg-btn')) removeLeg(card);
      else if (e.target.classList.contains('move-up-btn')) moveLeg(card, -1);
      else if (e.target.classList.contains('move-down-btn')) moveLeg(card, 1);
    });

    document.getElementById('addLegBtn').addEventListener('click', function () { addLeg(); });
    document.getElementById('roundTripBtn').addEventListener('click', addRoundTrip);

    document.getElementById('runBtn').addEventListener('click', function () {
      lastCalcResult = compute();
      render(lastCalcResult);
      saveForm();
      writeSharedContext(lastCalcResult);
      if (window.innerWidth < 900) {
        document.getElementById('resultPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    document.getElementById('resetBtn').addEventListener('click', function () {
      if (!window.confirm('Limpar todos os dados do formulário?')) return;
      try { localStorage.removeItem(FORM_KEY); } catch (e) { /* noop */ }
      legsContainer.innerHTML = '';
      document.getElementById('bewKg').value = '';
      document.getElementById('crewKg').value = '170';
      document.getElementById('mtowCategory').value = '7000';
      document.getElementById('maxLandingKg').value = '';
      document.getElementById('paxWeightKg').value = '90';
      document.getElementById('minLandingFuelKg').value = '240';
      addLeg(null, true);
      updateMaxLandingPlaceholder();
      scheduleRecalc();
    });

    document.getElementById('shareBtn').addEventListener('click', function () { window.print(); });

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
      if (e.key === 'Escape' && !fullscreenOverlay.hidden) fullscreenOverlay.hidden = true;
    });

    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(redrawCharts, 120);
    });

    lastCalcResult = compute();
    render(lastCalcResult);

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
