/* ============================== DATA LOAD ============================== */
// Data files are fetched at runtime (not embedded), so this page must be served over
// HTTP — opening index.html directly via file:// will hit the browser's fetch/CORS
// restriction on local files. Any static server works, e.g.: `python3 -m http.server`
// or `npx serve`, run from the project root.
let RAW, PNW_RAW, PNW_MONTHLY, COMPANIES, TYPES, ROWS;
let COMBO_DEFS, EXISTING_COMBO_KEYS, COMBOS;
let DWELL_ORIGIN_RAW, DWELL_DEST_RAW, DWELL_ORIGIN_MONTHLY, DWELL_DEST_MONTHLY;
let SPEED_RAW, SPEED_GRAIN_MONTHLY, SPEED_SYSTEM_MONTHLY;
let WEATHER_RAW, WEATHER_STATIONS, WEATHER_BY_STATION;
let CROP_RAW, CROP_CORN_BY_YEAR, CROP_SOYBEANS_BY_YEAR, CROP_WHEAT_BY_YEAR;
let state;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

async function loadData() {
  const [rawResp, pnwResp, dwellOriginResp, dwellDestResp, speedResp, weatherResp, cropResp] = await Promise.all([
    fetch('data/secondary_railcar_bids.json'),
    fetch('data/pnw_bulk_export_monthly.json'),
    fetch('data/rail_origin_dwell_monthly.json'),
    fetch('data/rail_terminal_dwell_monthly.json'),
    fetch('data/rail_train_speed_monthly.json'),
    fetch('data/weather_stations_monthly.json'),
    fetch('data/row_crop_production_annual.json'),
  ]);
  RAW = await rawResp.json();
  PNW_RAW = await pnwResp.json();
  // PNW_RAW = { month: ["2010-01",...], mt: [3199513.07,...] } — monthly BULK export tonnage,
  // summed across 8 core PNW grain terminals (Seattle, Tacoma, Portland OR, Vancouver WA,
  // Longview, Kalama, Aberdeen WA, Astoria), container cargo excluded per user request.
  PNW_MONTHLY = PNW_RAW.month.map((m, i) => ({ month: m, mt: PNW_RAW.mt[i] }));
  DWELL_ORIGIN_RAW = await dwellOriginResp.json();
  DWELL_DEST_RAW = await dwellDestResp.json();
  WEATHER_RAW = await weatherResp.json();
  // WEATHER_RAW = { stations: [{id,name},...], month: [...], s: [...] (station index), tavg_f: [...],
  // snow_in: [...] } — NOAA NCEI Global Summary of the Month for 4 stations along the grain-shuttle
  // corridor: Havre Airport ASOS MT, Minot Experimental Station ND, Aberdeen Regional Airport SD,
  // Kalispell Glacier Airport MT (a Whitefish-area substitute — the actual Whitefish station's own
  // record stops in 2014). WEATHER_BY_STATION[i] is a Map of month -> {tavg, snow} for stations[i],
  // used both individually and averaged together ("combined") in the Correlation model tab.
  WEATHER_STATIONS = WEATHER_RAW.stations;
  WEATHER_BY_STATION = WEATHER_STATIONS.map(() => new Map());
  WEATHER_RAW.month.forEach((month, i) => {
    WEATHER_BY_STATION[WEATHER_RAW.s[i]].set(month, { tavg: WEATHER_RAW.tavg_f[i], snow: WEATHER_RAW.snow_in[i] });
  });
  // Both dwell files: { railroads: ["BNSF","UP","CPKC"], month: ["2014-10",...], r: [0,...] (index into
  // railroads), hours: [14.3,...] } — monthly-average weekly STB Rail Service Metrics dwell hours.
  // Origin is grain-shuttle-specific (commodity='Grain'); destination is each railroad's system-wide
  // average across its 10 largest terminals (not commodity-specific — STB doesn't break dest dwell out
  // by commodity), so it's a coarser proxy when compared against grain shuttle bids.
  const dwellRowsToMap = raw => {
    const m = new Map();
    raw.month.forEach((month, i) => m.set(raw.railroads[raw.r[i]] + '|' + month, raw.hours[i]));
    return m;
  };
  DWELL_ORIGIN_MONTHLY = dwellRowsToMap(DWELL_ORIGIN_RAW);
  DWELL_DEST_MONTHLY = dwellRowsToMap(DWELL_DEST_RAW);
  SPEED_RAW = await speedResp.json();
  // SPEED_RAW = { railroads: [...], commodities: ["Grain","System"], month: [...], r: [...] (railroad
  // index), c: [...] (commodity index), mph: [...] } — same STB Rail Service Metrics collection as
  // dwell, dataset 2wy9-nmz4. "Grain" is grain-train-specific; "System" is each railroad's overall
  // average across all commodities (the speed analog of dwell's "System Average" terminal).
  SPEED_GRAIN_MONTHLY = new Map();
  SPEED_SYSTEM_MONTHLY = new Map();
  SPEED_RAW.month.forEach((month, i) => {
    const key = SPEED_RAW.railroads[SPEED_RAW.r[i]] + '|' + month;
    const target = SPEED_RAW.commodities[SPEED_RAW.c[i]] === 'Grain' ? SPEED_GRAIN_MONTHLY : SPEED_SYSTEM_MONTHLY;
    target.set(key, SPEED_RAW.mph[i]);
  });
  CROP_RAW = await cropResp.json();
  // CROP_RAW = { states: ["ND","SD","MN"], year: [1995,...], corn_bu, soybeans_bu, wheat_bu } —
  // USDA NASS QuickStats annual state-level PRODUCTION (bushels, final SURVEY estimates, not
  // in-season forecasts), summed across ND+SD+MN per crop. Kept as 3 separate variables rather
  // than one combined "row crop" total since a bushel of corn/soybeans/wheat is a different
  // physical weight — summing raw bushels across crops wouldn't be a meaningful quantity.
  CROP_CORN_BY_YEAR = new Map(); CROP_SOYBEANS_BY_YEAR = new Map(); CROP_WHEAT_BY_YEAR = new Map();
  CROP_RAW.year.forEach((y, i) => {
    CROP_CORN_BY_YEAR.set(y, CROP_RAW.corn_bu[i]);
    CROP_SOYBEANS_BY_YEAR.set(y, CROP_RAW.soybeans_bu[i]);
    CROP_WHEAT_BY_YEAR.set(y, CROP_RAW.wheat_bu[i]);
  });
  COMPANIES = RAW.companies;
  TYPES = RAW.types;

  ROWS = [];
  for (let i = 0; i < RAW.date.length; i++) {
    ROWS.push({
      date: RAW.date[i],
      t: Date.parse(RAW.date[i] + 'T00:00:00Z'),
      company: COMPANIES[RAW.c[i]],
      type: TYPES[RAW.t[i]],
      near: RAW.near[i],
      horizon: RAW.horizon[i],
      bid: RAW.bid[i],
    });
  }

  COMBO_DEFS = [
    { company: 'BNSF', type: 'Non_Shuttle', label: 'BNSF · Non-Shuttle', color: '--series-1' },
    { company: 'BNSF', type: 'Shuttle',     label: 'BNSF · Shuttle',     color: '--series-2' },
    { company: 'UP',   type: 'Non_Shuttle', label: 'UP · Non-Shuttle',   color: '--series-3' },
    { company: 'UP',   type: 'Shuttle',     label: 'UP · Shuttle',       color: '--series-4' },
    { company: 'CPKC', type: 'Shuttle',     label: 'CPKC · Shuttle',     color: '--series-5' },
  ].map(c => ({ ...c, key: c.company + '|' + c.type }));

  // only keep combos that actually exist in data
  EXISTING_COMBO_KEYS = new Set(ROWS.map(r => r.company + '|' + r.type));
  COMBOS = COMBO_DEFS.filter(c => EXISTING_COMBO_KEYS.has(c.key));

  const maxDate = ROWS.reduce((a, r) => Math.max(a, r.t), -Infinity);
  document.getElementById('meta-line').textContent =
    'Latest report: ' + new Date(maxDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) +
    '  ·  ' + ROWS.length.toLocaleString('en-US') + ' records loaded  ·  updated ' + new Date().toISOString().slice(0,10);

  /* ============================== STATE ============================== */
  state = {
    companies: new Set(COMBOS.map(c => c.company)),
    types: new Set(COMBOS.map(c => c.type)),
    activeTab: 'snapshot',
    isolated: new Set(), // legend isolate per-tab handled locally
  };
}

/* ============================== LIVE DATA REFRESH ============================== */
// Pulls any rows/months published to USDA AgTransport since the bundled snapshot was taken,
// via the same Socrata SODA endpoints documented in the README. This only updates the
// in-memory session (fetch() can't write files) — the "Download updated ..." links let the
// user grab refreshed JSON to overwrite data/ if they want the refresh to persist.
const BID_DATASET_URL = 'https://agtransport.usda.gov/resource/cvu8-kpyk.json';
const PNW_DATASET_URL = 'https://agtransport.usda.gov/resource/v58g-swkr.json';
const PNW_CORE_PORTS = ['SEATTLE', 'TACOMA', 'PORTLAND OR', 'VANCOUVER WA', 'LONGVIEW', 'KALAMA', 'ABERDEEN WA', 'ASTORIA'];

function bidRowKey(r) {
  return r.date + '|' + r.company + '|' + r.type + '|' + r.horizon;
}

function downloadJson(filename, dataObj) {
  const blob = new Blob([JSON.stringify(dataObj)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function refreshFromApi() {
  const btn = document.getElementById('refresh-data-btn');
  const status = document.getElementById('refresh-status');
  btn.disabled = true;
  btn.textContent = 'Checking…';
  status.style.display = '';
  status.textContent = 'Querying USDA AgTransport (agtransport.usda.gov)…';

  try {
    const latestBidDate = ROWS.reduce((a, r) => (r.date > a ? r.date : a), ROWS[0].date);
    const latestPnwMonth = PNW_MONTHLY.reduce((a, m) => (m.month > a ? m.month : a), PNW_MONTHLY[0].month);

    const bidWhere = "date > '" + latestBidDate + "'";
    const bidUrl = BID_DATASET_URL + '?$limit=50000&$order=date&$where=' + encodeURIComponent(bidWhere);

    const portClause = PNW_CORE_PORTS.map(p => "port='" + p + "'").join(' OR ');
    const pnwWhere = "conflag='Bulk' AND exim='Export' AND month_year > '" + latestPnwMonth + "-01' AND (" + portClause + ')';
    const pnwUrl = PNW_DATASET_URL + '?$select=year,month,sum(mt)%20as%20total_mt&$group=year,month&$order=year,month&$where=' + encodeURIComponent(pnwWhere);

    const [bidResp, pnwResp] = await Promise.all([fetch(bidUrl), fetch(pnwUrl)]);
    if (!bidResp.ok) throw new Error('Bid dataset request failed (HTTP ' + bidResp.status + ')');
    if (!pnwResp.ok) throw new Error('PNW dataset request failed (HTTP ' + pnwResp.status + ')');
    const bidRows = await bidResp.json();
    const pnwRows = await pnwResp.json();

    const existingBidKeys = new Set(ROWS.map(bidRowKey));
    let newBidCount = 0;
    bidRows.forEach(row => {
      const date = row.date.slice(0, 10);
      const company = row.company;
      const type = row.train_type;
      const bid = parseFloat(String(row.bid).replace(/,/g, ''));
      const near = row.near_month === true || row.near_month === 'true';
      const reportTotal = Number(row.year) * 12 + (Number(row.month) - 1);
      const targetTotal = Number(row.year_bid_on) * 12 + (Number(row.month_bid_on) - 1);
      const horizon = targetTotal - reportTotal;
      const rec = { date, t: Date.parse(date + 'T00:00:00Z'), company, type, near, horizon, bid };
      const key = bidRowKey(rec);
      if (existingBidKeys.has(key)) return;
      existingBidKeys.add(key);
      ROWS.push(rec);
      newBidCount++;
      if (!COMPANIES.includes(company)) COMPANIES.push(company);
      if (!TYPES.includes(type)) TYPES.push(type);
    });

    const existingMonths = new Set(PNW_MONTHLY.map(m => m.month));
    let newPnwCount = 0;
    pnwRows.forEach(row => {
      const month = String(row.year) + '-' + String(row.month).padStart(2, '0');
      if (existingMonths.has(month)) return;
      existingMonths.add(month);
      PNW_MONTHLY.push({ month, mt: Number(row.total_mt) });
      newPnwCount++;
    });
    PNW_MONTHLY.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));

    EXISTING_COMBO_KEYS = new Set(ROWS.map(r => r.company + '|' + r.type));
    COMBOS = COMBO_DEFS.filter(c => EXISTING_COMBO_KEYS.has(c.key));

    const maxDate = ROWS.reduce((a, r) => Math.max(a, r.t), -Infinity);
    document.getElementById('meta-line').textContent =
      'Latest report: ' + new Date(maxDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) +
      '  ·  ' + ROWS.length.toLocaleString('en-US') + ' records loaded  ·  updated ' + new Date().toISOString().slice(0, 10);

    if (newBidCount === 0 && newPnwCount === 0) {
      status.textContent = 'Already up to date — no new records found at agtransport.usda.gov.';
    } else {
      status.textContent = 'Added ' + newBidCount.toLocaleString('en-US') + ' new bid record' + (newBidCount === 1 ? '' : 's') +
        ' and ' + newPnwCount + ' new PNW export month' + (newPnwCount === 1 ? '' : 's') +
        '. This updates the current browser session only — reloading the page resets to the bundled snapshot. Use the links below to save the refreshed data files.';
      document.getElementById('refresh-downloads').style.display = '';
    }

    renderFilterUI();
    renderActiveTab();
  } catch (err) {
    console.error('Refresh from API failed:', err);
    status.textContent = 'Refresh failed: ' + err.message + '. Check your network connection and try again.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Check for new data';
  }
}

/* ============================== HELPERS ============================== */
function fmtMoney(v) {
  const sign = v < 0 ? '-' : '';
  const av = Math.abs(v);
  const s = av >= 1000 ? av.toLocaleString('en-US', {maximumFractionDigits: 0}) : av.toLocaleString('en-US', {maximumFractionDigits: 2, minimumFractionDigits: 0});
  return sign + '$' + s;
}
function fmtDelta(v) {
  const sign = v > 0 ? '+' : (v < 0 ? '-' : '');
  return sign + '$' + Math.abs(Math.round(v));
}
function niceNum(range, round) {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / Math.pow(10, exponent);
  let niceFraction;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * Math.pow(10, exponent);
}
function niceTicks(min, max, count) {
  if (min === max) { min -= 1; max += 1; }
  const range = niceNum(max - min, false);
  const step = niceNum(range / (count - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + step * 0.5; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { ticks, min: niceMin, max: niceMax };
}
function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

// A single labeled <input type=range> row with live onInput wiring. Shared by the Correlation
// model tab's Time frame sliders and the Outlook tab's chart zoom sliders.
function makeRangeSliderRow(labelText, min, max, step, value, accent, onInput) {
  const row = document.createElement('div'); row.style.cssText = 'display:flex; align-items:center; gap:10px; margin-bottom:8px;';
  const label = document.createElement('span'); label.style.cssText = 'width:44px; font-size:12px; color:var(--text-muted); flex:none;'; label.textContent = labelText;
  const input = document.createElement('input'); input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value);
  input.style.cssText = 'flex:1; accent-color:' + accent + ';';
  input.addEventListener('input', () => onInput(Number(input.value)));
  row.appendChild(label); row.appendChild(input);
  return row;
}
function dayOfYearWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const jan1 = Date.UTC(d.getUTCFullYear(), 0, 1);
  const doy = Math.floor((d.getTime() - jan1) / 86400000) + 1;
  return Math.ceil(doy / 7);
}

function visibleCombos() {
  return COMBOS.filter(c => state.companies.has(c.company) && state.types.has(c.type));
}

function comboRows(combo, nearOnly) {
  return ROWS.filter(r => r.company === combo.company && r.type === combo.type && (!nearOnly || r.near))
             .sort((a, b) => a.t - b.t);
}

/* ============================== GENERIC LINE CHART ============================== */
// series: [{key,label,color,points:[{x,y,raw}], muted, width, dashed}]
// opts: {xType:'time'|'week', xTicks?, yFormat, tooltipRows(xVal) -> [{label,color,value}], tooltipTitle(xVal)}
let lineChartClipId = 0;
function drawLineChart(container, series, opts) {
  container.innerHTML = '';
  const W = 900, H = opts.height || 300;
  const margin = { top: 14, right: 18, bottom: 26, left: 54 };
  const innerW = W - margin.left - margin.right;
  const innerH = H - margin.top - margin.bottom;

  const allPoints = series.flatMap(s => s.points);
  if (allPoints.length === 0) {
    container.innerHTML = '<div class="empty-state">No data for the current filter selection.</div>';
    return;
  }
  const xMin = opts.xMin !== undefined ? opts.xMin : Math.min(...allPoints.map(p => p.x));
  const xMax = opts.xMax !== undefined ? opts.xMax : Math.max(...allPoints.map(p => p.x));
  let yt;
  if (opts.yMin !== undefined && opts.yMax !== undefined) {
    // Explicit y-zoom range (e.g. Outlook tab's zoom sliders) — used as-is, no auto-padding,
    // so the sliders' own bounds (which already include padding) are what's on screen.
    yt = niceTicks(opts.yMin, opts.yMax, 5);
  } else {
    let yMin = Math.min(...allPoints.map(p => p.y), 0);
    let yMax = Math.max(...allPoints.map(p => p.y), 0);
    const yPad = (yMax - yMin) * 0.08 || 1;
    yt = niceTicks(yMin - yPad, yMax + yPad, 5);
  }

  const xScale = x => margin.left + (xMax === xMin ? innerW / 2 : (x - xMin) / (xMax - xMin) * innerW);
  const yScale = y => margin.top + (1 - (y - yt.min) / (yt.max - yt.min)) * innerH;

  const svg = svgEl('svg', { class: 'chart-svg', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' });

  // Clip series/end-dots to the inner plot rect — when zoom sliders narrow the x/y range, a
  // point outside that range projects outside the plot area (even outside the SVG entirely), and
  // since .chart-svg uses overflow:visible (so gridline/axis text can sit flush at the edges),
  // it would otherwise render past the chart's boundary instead of just being cropped off.
  const clipId = 'chart-clip-' + (++lineChartClipId);
  const clipPath = svgEl('clipPath', { id: clipId });
  clipPath.appendChild(svgEl('rect', { x: margin.left, y: margin.top, width: innerW, height: innerH }));
  const defs = svgEl('defs'); defs.appendChild(clipPath);
  svg.appendChild(defs);
  const plotGroup = svgEl('g', { 'clip-path': 'url(#' + clipId + ')' });

  // gridlines
  yt.ticks.forEach(tv => {
    const y = yScale(tv);
    svg.appendChild(svgEl('line', { class: tv === 0 ? 'baseline' : 'gridline', x1: margin.left, x2: W - margin.right, y1: y, y2: y }));
    const lbl = svgEl('text', { class: 'axis-label', x: margin.left - 8, y: y + 3, 'text-anchor': 'end' });
    lbl.textContent = (opts.yFormat ? opts.yFormat(tv) : tv);
    svg.appendChild(lbl);
  });

  // x ticks
  const xTicks = opts.xTicks ? opts.xTicks(xMin, xMax) : [];
  xTicks.forEach(t => {
    const x = xScale(t.x);
    const lbl = svgEl('text', { class: 'axis-label', x: x, y: H - 6, 'text-anchor': 'middle' });
    lbl.textContent = t.label;
    svg.appendChild(lbl);
  });

  // series paths
  series.forEach(s => {
    if (s.points.length === 0) return;
    const d = s.points.map((p, i) => (i === 0 ? 'M' : 'L') + xScale(p.x).toFixed(2) + ',' + yScale(p.y).toFixed(2)).join(' ');
    const path = svgEl('path', {
      class: 'series-path' + (s.muted ? ' muted' : ''),
      d: d,
      stroke: s.muted ? '' : s.color,
    });
    if (s.width) path.setAttribute('stroke-width', s.width);
    if (s.dashed) path.setAttribute('stroke-dasharray', '5,4');
    plotGroup.appendChild(path);

    if (!s.muted && s.points.length) {
      const last = s.points[s.points.length - 1];
      plotGroup.appendChild(svgEl('circle', { class: 'end-dot', cx: xScale(last.x), cy: yScale(last.y), r: 4, fill: s.color }));
      if (s.directLabel !== false) {
        // Left unclipped (appended to svg, not plotGroup) — direct labels intentionally sit a
        // few px past the last point, into the right margin reserved for them.
        const lbl = svgEl('text', { class: 'direct-label', x: xScale(last.x) + 8, y: yScale(last.y) + 4, fill: s.color });
        lbl.textContent = s.label;
        svg.appendChild(lbl);
      }
    }
  });
  svg.appendChild(plotGroup);

  // interaction overlay
  const overlay = svgEl('rect', { x: margin.left, y: margin.top, width: innerW, height: innerH, fill: 'transparent' });
  const crosshair = svgEl('line', { class: 'crosshair-line', x1: 0, x2: 0, y1: margin.top, y2: margin.top + innerH, style: 'display:none' });
  svg.appendChild(crosshair);
  const dotsLayer = svgEl('g', { 'clip-path': 'url(#' + clipId + ')' });
  svg.appendChild(dotsLayer);
  svg.appendChild(overlay);

  const tooltip = document.getElementById('tooltip');
  function findNearestX(mx) {
    // map back to data x
    const fx = xMin + (mx - margin.left) / innerW * (xMax - xMin);
    let best = null, bestD = Infinity;
    allPoints.forEach(p => { const d = Math.abs(p.x - fx); if (d < bestD) { bestD = d; best = p.x; } });
    return best;
  }
  function onMove(evt) {
    const rect = svg.getBoundingClientRect();
    const mx = (evt.clientX - rect.left) / rect.width * W;
    const nearestX = findNearestX(mx);
    if (nearestX === null) return;
    crosshair.style.display = '';
    crosshair.setAttribute('x1', xScale(nearestX));
    crosshair.setAttribute('x2', xScale(nearestX));
    dotsLayer.innerHTML = '';
    const rowsHtml = [];
    series.forEach(s => {
      const pt = s.points.find(p => p.x === nearestX) || s.points.reduce((a, p) => Math.abs(p.x - nearestX) < Math.abs((a || {x:Infinity}).x - nearestX) ? p : a, null);
      if (!pt) return;
      const col = s.muted ? cssVar('--text-muted') : s.color;
      dotsLayer.appendChild(svgEl('circle', { class: 'end-dot', cx: xScale(pt.x), cy: yScale(pt.y), r: 3.5, fill: col }));
      const val = pt.raw !== undefined ? pt.raw : pt.y;
      if (!s.muted) {
        // On-chart value label for the current year + model scenario lines only (muted
        // historical-year lines stay label-free — 15+ of them at once would be unreadable).
        // A stroke "halo" in the surface color stands in for a background chip, keeping the
        // text legible over criss-crossing lines without an extra DOM element per label.
        const lbl = svgEl('text', {
          class: 'hover-value-label', x: xScale(pt.x) + 7, y: yScale(pt.y) - 7, fill: col,
          style: 'paint-order: stroke; stroke: ' + cssVar('--surface-1') + '; stroke-width: 3px; stroke-linejoin: round;',
        });
        lbl.textContent = opts.yFormat ? opts.yFormat(val) : val;
        dotsLayer.appendChild(lbl);
      }
      rowsHtml.push({ label: s.label, color: col, value: val });
    });
    const title = opts.tooltipTitle ? opts.tooltipTitle(nearestX) : String(nearestX);
    tooltip.innerHTML = '';
    const t = document.createElement('div'); t.className = 'tt-date'; t.textContent = title; tooltip.appendChild(t);
    rowsHtml.forEach(r => {
      const row = document.createElement('div'); row.className = 'tt-row';
      const key = document.createElement('div'); key.className = 'tt-key'; key.style.background = r.color;
      const name = document.createElement('div'); name.className = 'tt-name'; name.textContent = r.label;
      const val = document.createElement('div'); val.className = 'tt-val'; val.textContent = (opts.yFormat ? opts.yFormat(r.value) : r.value);
      row.appendChild(key); row.appendChild(name); row.appendChild(val);
      tooltip.appendChild(row);
    });
    tooltip.style.opacity = '1';
    const contRect = container.getBoundingClientRect();
    let left = evt.clientX - contRect.left + 14;
    let top = evt.clientY - contRect.top - 10;
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  }
  overlay.addEventListener('pointermove', onMove);
  overlay.addEventListener('pointerleave', () => { tooltip.style.opacity = '0'; crosshair.style.display = 'none'; dotsLayer.innerHTML = ''; });

  container.appendChild(svg);
}

function drawSparkline(container, points, color) {
  container.innerHTML = '';
  if (points.length < 2) return;
  const W = 140, H = 30;
  const xs = points.map((p, i) => i);
  const ys = points.map(p => p.y);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const pad = (yMax - yMin) * 0.15 || 1;
  const xScale = i => i / (points.length - 1) * (W - 4) + 2;
  const yScale = y => H - 3 - (y - (yMin - pad)) / ((yMax + pad) - (yMin - pad)) * (H - 6);
  const svg = svgEl('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H });
  const d = points.map((p, i) => (i === 0 ? 'M' : 'L') + xScale(i).toFixed(1) + ',' + yScale(p.y).toFixed(1)).join(' ');
  svg.appendChild(svgEl('path', { d, fill: 'none', stroke: cssVar('--text-muted'), 'stroke-width': 1.5 }));
  const last = points[points.length - 1];
  svg.appendChild(svgEl('circle', { cx: xScale(points.length - 1), cy: yScale(last.y), r: 2.5, fill: color }));
  container.appendChild(svg);
}

/* ============================== FILTER UI ============================== */
function renderFilterUI() {
  const companyGroup = document.getElementById('company-filters');
  const typeGroup = document.getElementById('type-filters');
  companyGroup.querySelectorAll('.chip').forEach(e => e.remove());
  typeGroup.querySelectorAll('.chip').forEach(e => e.remove());

  const allCompanies = [...new Set(COMBOS.map(c => c.company))];
  allCompanies.forEach(company => {
    const chip = document.createElement('label');
    chip.className = 'chip' + (state.companies.has(company) ? ' active' : '');
    const comboForColor = COMBOS.find(c => c.company === company);
    chip.innerHTML = '<span class="dot" style="background:var(' + comboForColor.color + ')"></span>' + company;
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      if (state.companies.has(company)) { if (state.companies.size > 1) state.companies.delete(company); }
      else state.companies.add(company);
      renderFilterUI();
      renderActiveTab();
    });
    companyGroup.appendChild(chip);
  });

  const allTypes = [...new Set(COMBOS.map(c => c.type))];
  const typeLabels = { Non_Shuttle: 'Non-Shuttle', Shuttle: 'Shuttle' };
  allTypes.forEach(type => {
    const chip = document.createElement('label');
    chip.className = 'chip' + (state.types.has(type) ? ' active' : '');
    chip.innerHTML = typeLabels[type] || type;
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      if (state.types.has(type)) { if (state.types.size > 1) state.types.delete(type); }
      else state.types.add(type);
      renderFilterUI();
      renderActiveTab();
    });
    typeGroup.appendChild(chip);
  });
}

/* ============================== TABS ============================== */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    state.activeTab = btn.dataset.tab;
    document.getElementById('panel-' + state.activeTab).classList.add('active');
    renderActiveTab();
  });
});

function renderActiveTab() {
  if (state.activeTab === 'snapshot') renderSnapshot();
  else if (state.activeTab === 'history') renderHistory();
  else if (state.activeTab === 'seasonal') renderSeasonal();
  else if (state.activeTab === 'trailing') renderTrailing();
  else if (state.activeTab === 'model') renderModel();
  else if (state.activeTab === 'outlook') renderOutlook();
}

/* ---------- 2026 outlook tab ---------- */
function targetYearMonth(dateStr, horizon) {
  const y = Number(dateStr.slice(0,4)), m = Number(dateStr.slice(5,7));
  const total = (y*12 + (m-1)) + horizon;
  return { y: Math.floor(total/12), m: (total % 12) + 1 };
}
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Shared by the 2026 Outlook tab and the Seasonal Comparison tab's forward-curve extension.
// Returns { actual: [{m,bid}], projected: [{m,bid,asOf}], lastActualMonth } for one combo/year.
// "projected" months are those with no near-month (spot) data yet, filled from the most
// recently quoted forward bid that targets that specific contract month.
function getYearProjection(combo, year) {
  const allRows = ROWS.filter(r => r.company === combo.company && r.type === combo.type);
  const actualByMonth = new Map();
  allRows.forEach(r => {
    if (r.near && Number(r.date.slice(0,4)) === year) {
      const m = Number(r.date.slice(5,7));
      if (!actualByMonth.has(m)) actualByMonth.set(m, []);
      actualByMonth.get(m).push(r.bid);
    }
  });
  const actual = [...actualByMonth.entries()].map(([m, vals]) => ({ m, bid: vals.reduce((a,b)=>a+b,0)/vals.length })).sort((a,b)=>a.m-b.m);
  const lastActualMonth = actual.length ? Math.max(...actual.map(a=>a.m)) : 0;

  const projected = [];
  for (let m = 1; m <= 12; m++) {
    if (actualByMonth.has(m)) continue;
    let best = null;
    allRows.forEach(r => {
      const t = targetYearMonth(r.date, r.horizon);
      if (t.y === year && t.m === m) { if (!best || r.date > best.date) best = r; }
    });
    if (best) projected.push({ m, bid: best.bid, asOf: best.date });
  }
  return { actual, projected, lastActualMonth };
}

// Splits a sorted-by-month projected array into contiguous runs (gap = no forward quote yet),
// optionally prepending a bridge point so the first run visually continues from `bridgePoint`.
// xOfMonth(m) converts a calendar month number to whatever x-coordinate the caller's chart uses
// (month number itself for Outlook, week-of-year for Seasonal).
function projectedRuns(projected, lastActualMonth, bridgePoint, xOfMonth) {
  const sorted = [...projected].sort((a,b) => a.m - b.m);
  const runs = []; let current = [];
  sorted.forEach(p => {
    if (current.length && p.m !== current[current.length-1].m + 1) { runs.push(current); current = []; }
    current.push(p);
  });
  if (current.length) runs.push(current);
  return runs.map((run, i) => {
    let pts = run.map(p => ({ x: xOfMonth(p.m), y: p.bid, raw: p.bid, m: p.m }));
    if (i === 0 && bridgePoint && run[0].m === lastActualMonth + 1) pts = [bridgePoint].concat(pts);
    return pts;
  });
}

// Default single-combo focus for the 4 tabs that show one railroad/service at a time
// (outlook, correlation model, seasonal comparison, trailing average) — BNSF Shuttle unless
// the railroad/service filters have hidden it, in which case fall back to whatever's first.
function defaultComboKey(combos) {
  const preferred = combos.find(c => c.key === 'BNSF|Shuttle');
  return (preferred || combos[0]).key;
}

function renderOutlook() {
  const panel = document.getElementById('panel-outlook');
  panel.innerHTML = '';
  const combos = visibleCombos();
  if (combos.length === 0) { panel.innerHTML = '<div class="empty-state">Select at least one railroad and service type above.</div>'; return; }
  if (!state.outlookFocus || !combos.find(c => c.key === state.outlookFocus)) state.outlookFocus = defaultComboKey(combos);
  const combo = combos.find(c => c.key === state.outlookFocus);
  const accent = cssVar(combo.color);
  const THIS_YEAR = 2026; // most recent year with data in this dataset

  const allRows = ROWS.filter(r => r.company === combo.company && r.type === combo.type);
  const { actual, projected, lastActualMonth } = getYearProjection(combo, THIS_YEAR);
  const asOfDates = new Set(projected.map(p => p.asOf));
  const priorYearData = getYearProjection(combo, THIS_YEAR - 1);
  const prior = priorYearData.actual;

  const head = document.createElement('div'); head.className = 'card';
  const h = document.createElement('div'); h.className = 'card-head';
  h.innerHTML = '<div><p class="card-title">' + THIS_YEAR + ' spot bid vs. forward-market projection</p>' +
    '<p class="card-caption">Solid line: actual monthly-average near-month (spot) bid. Dashed line: the most recently quoted forward bid for that specific contract month — real market pricing already in the data, not a statistical forecast. Gray: all other available years, for historical context — click a year in the legend below to hide/show it.</p></div>';
  const selRow = document.createElement('div'); selRow.className = 'select-row';
  selRow.innerHTML = 'Series <select id="outlook-select"></select>';
  h.appendChild(selRow);
  head.appendChild(h);
  panel.appendChild(head);

  const sel = selRow.querySelector('#outlook-select');
  combos.forEach(c => {
    const opt = document.createElement('option'); opt.value = c.key; opt.textContent = c.label;
    if (c.key === state.outlookFocus) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => { state.outlookFocus = sel.value; renderOutlook(); });

  // stat tiles
  const latestSpot = allRows.filter(r=>r.near).sort((a,b)=>a.t-b.t).slice(-1)[0];
  const ytdAvg = actual.length ? actual.reduce((a,r)=>a+r.bid,0)/actual.length : null;
  const projAvg = projected.length ? projected.reduce((a,r)=>a+r.bid,0)/projected.length : null;
  const delta = (projAvg !== null && ytdAvg !== null) ? projAvg - ytdAvg : null;
  const deltaClass = delta === null ? 'flat' : (delta > 0 ? 'up' : (delta < 0 ? 'down' : 'flat'));

  const kpiCard = document.createElement('div'); kpiCard.className = 'card';
  const kpiRow = document.createElement('div'); kpiRow.className = 'kpi-row';
  kpiRow.innerHTML =
    '<div class="stat-tile"><div class="st-label">Latest spot bid</div><div class="st-value">' + (latestSpot ? fmtMoney(latestSpot.bid) : 'n/a') + '</div><div class="st-date">as of ' + (latestSpot ? latestSpot.date : '—') + '</div></div>' +
    '<div class="stat-tile"><div class="st-label">' + THIS_YEAR + ' YTD average (actual)</div><div class="st-value">' + (ytdAvg !== null ? fmtMoney(ytdAvg) : 'n/a') + '</div><div class="st-date">' + (actual.length ? MONTH_NAMES[actual[0].m-1] + '–' + MONTH_NAMES[lastActualMonth-1] : '') + '</div></div>' +
    '<div class="stat-tile"><div class="st-label">Projected remaining-' + THIS_YEAR + ' average</div><div class="st-value">' + (projAvg !== null ? fmtMoney(projAvg) : 'no forward quotes yet') + '</div>' + (delta !== null ? ('<div class="st-delta ' + deltaClass + '">' + fmtDelta(delta) + ' vs YTD actual</div>') : '') + '</div>';
  kpiCard.appendChild(kpiRow);
  panel.appendChild(kpiCard);

  // ---- model-based scenario: best-fit correlation model, high/avg/low reference lines ----
  const dataMinYear = Number(ROWS.reduce((a, r) => (r.date < a ? r.date : a), ROWS[0].date).slice(0, 4));
  const dataMaxYear = Number(ROWS.reduce((a, r) => (r.date > a ? r.date : a), ROWS[0].date).slice(0, 4));
  state.outlookVarLevel = state.outlookVarLevel || {}; // per-variable key -> 'low'|'avg'|'high' for the custom line, defaults to 'avg'
  const scenarioCard = document.createElement('div'); scenarioCard.className = 'card';
  const scHead = document.createElement('div'); scHead.className = 'card-head';
  const scenarioStartMonth = lastActualMonth + 1; // first month with no actual data yet — a "forecast" for already-actual months is moot
  scHead.innerHTML = '<div><p class="card-title">Model-based scenario</p>' +
    '<p class="card-caption">Runs the same best-fit search as the Correlation model tab for ' + combo.label + ' over its full history, then predicts the bid — from ' + (scenarioStartMonth <= 12 ? MONTH_NAMES[scenarioStartMonth-1] + ' onward' : 'no remaining months this year') + ' — with every input pinned to that <em>calendar month\'s own</em> historical high (90th percentile), average (mean), or low (10th percentile) — so a January-vs-July difference in e.g. snowfall shows up as a seasonal wave, not a flat annual number. A 4th "Custom" line lets each input use its own low/avg/high independently (via the Level column below) instead of moving together. Plotted as reference lines on the chart below. A lead to compare against, not a forecast.</p></div>';
  const scBtn = document.createElement('button'); scBtn.className = 'table-toggle-btn'; scBtn.type = 'button';
  scBtn.textContent = (state.outlookScenario && state.outlookScenario.comboKey === combo.key) || state.outlookScenarioEmpty === combo.key ? 'Re-run scenario' : 'Run best-fit scenario';
  scHead.appendChild(scBtn);
  scenarioCard.appendChild(scHead);

  if (state.outlookScenario && state.outlookScenario.comboKey === combo.key) {
    const sc = state.outlookScenario;
    const varLabels = sc.subset.map(k => MODEL_VARS.find(v => v.key === k).label).join(' + ');
    const usesWeather = sc.subset.includes('temp') || sc.subset.includes('snow');
    const stationNote = usesWeather ? (sc.station === 'combined' ? ' (combined station)' : ' (' + WEATHER_STATIONS[Number(sc.station)].name + ')') : '';
    const infoP = document.createElement('p'); infoP.className = 'card-caption'; infoP.style.margin = '8px 0 10px 0';
    infoP.textContent = (sc.manuallyAdjusted ? 'Current inputs (manually adjusted — click "Re-run scenario" to return to the auto-detected best fit): ' : 'Best-fit inputs: ') + varLabels + stationNote + ' — R² ' + sc.r2.toFixed(2) + ', adjusted R² ' + sc.adjR2.toFixed(2) + ', n=' + sc.n + ' months.';
    scenarioCard.appendChild(infoP);

    sc.customMonthly = customMonthlyFor(sc, state.outlookVarLevel);
    const customColor = cssVar('--series-2');

    const remainingMonths = []; for (let m = scenarioStartMonth; m <= 12; m++) remainingMonths.push(m);
    const meanRemaining = arr => remainingMonths.length ? remainingMonths.reduce((s, m) => s + arr[m - 1], 0) / remainingMonths.length : null;
    const remHigh = meanRemaining(sc.monthlyHigh), remAvg = meanRemaining(sc.monthlyAvg), remLow = meanRemaining(sc.monthlyLow);
    const remCustom = meanRemaining(sc.customMonthly);
    const rangeLabel = remainingMonths.length ? MONTH_NAMES[remainingMonths[0]-1] + '–' + MONTH_NAMES[remainingMonths[remainingMonths.length-1]-1] : 'none';

    const scenarioRow = document.createElement('div'); scenarioRow.className = 'kpi-row';
    if (remainingMonths.length) {
      scenarioRow.innerHTML =
        '<div class="stat-tile"><div class="st-label">High scenario</div><div class="st-value" style="color:' + cssVar('--good') + '">' + fmtMoney(remHigh) + '</div><div class="st-date">avg, ' + rangeLabel + '</div></div>' +
        '<div class="stat-tile"><div class="st-label">Average scenario</div><div class="st-value">' + fmtMoney(remAvg) + '</div><div class="st-date">avg, ' + rangeLabel + '</div></div>' +
        '<div class="stat-tile"><div class="st-label">Low scenario</div><div class="st-value" style="color:' + cssVar('--diverging-down') + '">' + fmtMoney(remLow) + '</div><div class="st-date">avg, ' + rangeLabel + '</div></div>' +
        '<div class="stat-tile"><div class="st-label">Custom scenario</div><div class="st-value" style="color:' + customColor + '">' + fmtMoney(remCustom) + '</div><div class="st-date">per-input levels below, avg ' + rangeLabel + '</div></div>';
    } else {
      scenarioRow.innerHTML = '<div class="stat-tile"><div class="st-label">Scenario</div><div class="st-value" style="font-size:14px;">No remaining months</div><div class="st-date">' + THIS_YEAR + ' is fully reported</div></div>';
    }
    scenarioCard.appendChild(scenarioRow);

    const tableCaption = document.createElement('p'); tableCaption.className = 'card-caption'; tableCaption.style.margin = '10px 0 4px 0';
    tableCaption.textContent = 'Check/uncheck an input to add or remove it from the model (re-fits live). Use "Level" to set that input\'s contribution to the Custom line — each input can independently be Low, Avg, or High, unlike the 3 scenarios above which move every input together. Low/Average/High columns are annual (pooled) figures for reference — the chart above uses each month\'s own seasonal range. Unchecked inputs show their own historical range but no coefficient, since they aren\'t part of the current fit.';
    scenarioCard.appendChild(tableCaption);

    const tableScroll = document.createElement('div'); tableScroll.className = 'table-scroll';
    const table = document.createElement('table'); table.className = 'data-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th style="text-align:left;">Use</th><th>Input</th><th>Low</th><th>Average</th><th>High</th><th>Coefficient</th><th style="text-align:left;">Level (Custom line)</th></tr>';
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    MODEL_VARS.forEach(def => {
      const included = sc.subset.includes(def.key);
      const v = included ? sc.varStats.find(vs => vs.key === def.key) : standaloneVarStats(combo, def.key, sc.station);
      const tr = document.createElement('tr');
      const useTd = document.createElement('td'); useTd.style.textAlign = 'left';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = included;
      checkbox.addEventListener('change', () => {
        const attemptedInclude = checkbox.checked; // what the user just tried to set
        const nextSet = new Set(sc.subset);
        if (attemptedInclude) nextSet.add(def.key); else nextSet.delete(def.key);
        if (nextSet.size === 0) { checkbox.checked = true; return; }
        const refit = fitScenarioForSubset(combo, [...nextSet], sc.station, dataMinYear, dataMaxYear);
        if (refit) {
          refit.manuallyAdjusted = true;
          state.outlookScenario = refit;
          renderOutlook();
        } else {
          checkbox.checked = !attemptedInclude; // revert to prior state
          state.outlookScenarioAdjustError = 'Not enough overlapping data with ' + def.label + (attemptedInclude ? ' added' : ' removed') + ' — left unchanged.';
          renderOutlook();
        }
      });
      useTd.appendChild(checkbox);
      tr.appendChild(useTd);
      const cell = (text, alignRight) => { const td = document.createElement('td'); if (alignRight === false) td.style.textAlign = 'left'; td.textContent = text; return td; };
      tr.appendChild(cell(def.label, false));
      tr.appendChild(cell(v ? def.fmt(v.low) : '—'));
      tr.appendChild(cell(v ? def.fmt(v.avg) : '—'));
      tr.appendChild(cell(v ? def.fmt(v.high) : '—'));
      tr.appendChild(cell(included ? fmtMoney(v.coef) : '—'));
      const levelTd = document.createElement('td'); levelTd.style.cssText = 'text-align:left; white-space:nowrap;';
      if (included) {
        const currentLevel = state.outlookVarLevel[def.key] || 'avg';
        const levelGroupName = 'level-' + def.key;
        ['low', 'avg', 'high'].forEach(lvl => {
          const lbl = document.createElement('label'); lbl.style.cssText = 'display:inline-flex; align-items:center; margin-right:6px; cursor:pointer; font-size:11.5px; color:var(--text-secondary); white-space:nowrap;';
          const radio = document.createElement('input'); radio.type = 'radio'; radio.name = levelGroupName; radio.value = lvl;
          radio.checked = currentLevel === lvl;
          radio.style.cssText = 'margin-right:3px;';
          radio.addEventListener('change', () => {
            state.outlookVarLevel[def.key] = lvl;
            renderOutlook();
          });
          lbl.appendChild(radio);
          lbl.appendChild(document.createTextNode(lvl === 'low' ? 'Low' : lvl === 'avg' ? 'Avg' : 'High'));
          levelTd.appendChild(lbl);
        });
      } else {
        levelTd.textContent = '—';
        levelTd.style.color = 'var(--text-muted)';
      }
      tr.appendChild(levelTd);
      if (!included) tr.style.opacity = '0.55';
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableScroll.appendChild(table);
    scenarioCard.appendChild(tableScroll);

    if (state.outlookScenarioAdjustError) {
      const errP = document.createElement('p'); errP.className = 'card-caption'; errP.style.cssText = 'margin-top:6px; color:var(--diverging-down);';
      errP.textContent = state.outlookScenarioAdjustError;
      scenarioCard.appendChild(errP);
      state.outlookScenarioAdjustError = null;
    }
  } else if (state.outlookScenarioEmpty === combo.key) {
    const empty = document.createElement('p'); empty.className = 'card-caption'; empty.style.margin = '8px 0 0 0';
    empty.textContent = 'No qualifying model found for ' + combo.label + ' — every input combination fell short of 30 complete-case months.';
    scenarioCard.appendChild(empty);
  }
  panel.appendChild(scenarioCard);

  scBtn.addEventListener('click', () => {
    scBtn.disabled = true; scBtn.textContent = 'Running…';
    setTimeout(() => {
      const result = computeModelScenario(combo, dataMinYear, dataMaxYear);
      state.outlookScenario = result;
      state.outlookScenarioEmpty = result ? null : combo.key;
      state.outlookVarLevel = {}; // fresh search — go back to every input at its average
      renderOutlook();
    }, 0);
  });

  // chart: x = month 1-12, series: prior year (muted), actual (solid accent), projected (dashed accent)
  const chartCard = document.createElement('div'); chartCard.className = 'card';
  chartCard.innerHTML = '<div class="card-head"><div><p class="card-title">Month-by-month, ' + THIS_YEAR + '</p></div></div>';
  const chartDiv = document.createElement('div'); chartDiv.className = 'chart-wrap';
  chartCard.appendChild(chartDiv);
  const legendDiv = document.createElement('div'); legendDiv.className = 'legend';
  chartCard.appendChild(legendDiv);
  panel.appendChild(chartCard);

  state.outlookHiddenYears = state.outlookHiddenYears || new Set();
  const allYears = [...new Set(allRows.filter(r => r.near).map(r => Number(r.date.slice(0, 4))))].sort((a, b) => a - b);

  const series = [];
  allYears.forEach(y => {
    if (y === THIS_YEAR || state.outlookHiddenYears.has(y)) return;
    const yearActual = getYearProjection(combo, y).actual;
    if (!yearActual.length) return;
    series.push({ key: 'y' + y, label: String(y), muted: true, points: yearActual.map(p => ({ x: p.m, y: p.bid, raw: p.bid })), directLabel: false, width: 1.5 });
  });
  if (!state.outlookHiddenYears.has(THIS_YEAR)) {
    if (actual.length) series.push({ key:'actual', label: THIS_YEAR + ' actual (spot)', color: accent, points: actual.map(p=>({x:p.m,y:p.bid,raw:p.bid})), directLabel:false, width:2.5 });
    if (projected.length) {
      // Break into contiguous month runs so a missing month (no forward quote yet) shows as a
      // real gap rather than a straight line silently bridging over it. Only the first run —
      // if it starts right after the last actual month — gets the actual line's endpoint
      // prepended, so the dashed segment visually continues from the solid line.
      const bridge = actual.length ? { x: lastActualMonth, y: actual.find(a=>a.m===lastActualMonth).bid, raw: actual.find(a=>a.m===lastActualMonth).bid } : null;
      const runs = projectedRuns(projected, lastActualMonth, bridge, m => m);
      runs.forEach((pts, i) => {
        series.push({ key: 'projected-' + i, label: THIS_YEAR + ' forward-quoted', color: accent, points: pts, directLabel: false, width: 2.5, dashed: true });
      });
    }
  }
  const scenarioForChart = state.outlookScenario && state.outlookScenario.comboKey === combo.key ? state.outlookScenario : null;
  if (scenarioForChart) {
    const goodColor = cssVar('--good'), upColor = cssVar('--diverging-up'), downColor = cssVar('--diverging-down');
    // Only plot from the first month with no actual data yet — a "forecast" line drawn back
    // over already-reported months would be redundant with the solid actual line and misleading.
    const toMonthlyPoints = arr => arr.map((y, i) => ({ x: i + 1, y, raw: y })).filter(p => p.x >= lastActualMonth + 1);
    series.push({ key: 'scenario-high', label: 'Model: high scenario', color: goodColor, points: toMonthlyPoints(scenarioForChart.monthlyHigh), directLabel: false, width: 2, dashed: true });
    series.push({ key: 'scenario-avg', label: 'Model: average scenario', color: upColor, points: toMonthlyPoints(scenarioForChart.monthlyAvg), directLabel: false, width: 2, dashed: true });
    series.push({ key: 'scenario-low', label: 'Model: low scenario', color: downColor, points: toMonthlyPoints(scenarioForChart.monthlyLow), directLabel: false, width: 2, dashed: true });
    const customColorForChart = cssVar('--series-2');
    series.push({ key: 'scenario-custom', label: 'Model: custom scenario', color: customColorForChart, points: toMonthlyPoints(scenarioForChart.customMonthly), directLabel: false, width: 2, dashed: true });
  }

  // ---- zoom: natural (fully-zoomed-out) bounds, matching drawLineChart's own auto-scale math,
  // so the default slider positions exactly reproduce the unzoomed view. Resets whenever the
  // combo changes (the $ scale differs a lot railroad to railroad) but persists across legend
  // year-toggles and scenario runs, since those don't change what "zoomed out" should mean.
  const chartPoints = series.flatMap(s => s.points);
  const rawYMin = Math.min(...chartPoints.map(p => p.y), 0);
  const rawYMax = Math.max(...chartPoints.map(p => p.y), 0);
  const rawYPad = (rawYMax - rawYMin) * 0.08 || 1;
  const fullYMin = Math.floor(rawYMin - rawYPad);
  const fullYMax = Math.ceil(rawYMax + rawYPad);
  if (state.outlookZoomCombo !== combo.key) {
    state.outlookZoomCombo = combo.key;
    state.outlookXMin = 1; state.outlookXMax = 12;
    state.outlookYMin = fullYMin; state.outlookYMax = fullYMax;
  }

  drawLineChart(chartDiv, series, {
    height: 300, yFormat: fmtMoney,
    xMin: state.outlookXMin, xMax: state.outlookXMax,
    yMin: state.outlookYMin, yMax: state.outlookYMax,
    xTicks: () => MONTH_NAMES.map((name,i) => ({ x: i+1, label: name })),
    tooltipTitle: (x) => MONTH_NAMES[Math.round(x)-1] + ' ' + THIS_YEAR,
  });

  legendDiv.innerHTML = '';
  allYears.forEach(y => {
    const isCurrent = y === THIS_YEAR;
    const isHidden = state.outlookHiddenYears.has(y);
    const color = isCurrent ? accent : cssVar('--text-muted');
    const item = document.createElement('div');
    item.className = 'legend-item' + (isHidden ? ' isolated-off' : '');
    item.innerHTML = '<span class="key" style="background:' + color + '"></span>' + y + (isCurrent ? ' (current, solid)' : '');
    item.addEventListener('click', () => {
      if (state.outlookHiddenYears.has(y)) state.outlookHiddenYears.delete(y); else state.outlookHiddenYears.add(y);
      renderOutlook();
    });
    legendDiv.appendChild(item);
  });
  if (projected.length && !state.outlookHiddenYears.has(THIS_YEAR)) {
    const fq = document.createElement('div'); fq.className = 'legend-item'; fq.style.cursor = 'default';
    fq.innerHTML = '<span class="key" style="background:' + accent + ';background-image:linear-gradient(90deg,' + accent + ' 60%,transparent 0);background-size:8px 2px;"></span>' + THIS_YEAR + ' forward-quoted (dashed)';
    legendDiv.appendChild(fq);
  }
  if (scenarioForChart) {
    [['Model: high scenario', cssVar('--good')], ['Model: average scenario', cssVar('--diverging-up')], ['Model: low scenario', cssVar('--diverging-down')], ['Model: custom scenario', cssVar('--series-2')]].forEach(([label, color]) => {
      const item = document.createElement('div'); item.className = 'legend-item'; item.style.cursor = 'default';
      item.innerHTML = '<span class="key" style="background:' + color + ';background-image:linear-gradient(90deg,' + color + ' 60%,transparent 0);background-size:8px 2px;"></span>' + label;
      legendDiv.appendChild(item);
    });
  }

  // ---- zoom controls: narrow the X (month) or Y (bid) range shown above ----
  const zoomWrap = document.createElement('div'); zoomWrap.style.cssText = 'margin-top:14px; padding-top:14px; border-top:1px solid var(--border);';
  const zoomHead = document.createElement('div'); zoomHead.style.cssText = 'display:flex; align-items:baseline; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:8px;';
  const zoomTitle = document.createElement('p'); zoomTitle.className = 'card-title'; zoomTitle.style.cssText = 'font-size:13px; margin:0;'; zoomTitle.textContent = 'Chart zoom';
  const resetZoomBtn = document.createElement('button'); resetZoomBtn.className = 'table-toggle-btn'; resetZoomBtn.type = 'button'; resetZoomBtn.textContent = 'Reset zoom';
  zoomHead.appendChild(zoomTitle); zoomHead.appendChild(resetZoomBtn);
  zoomWrap.appendChild(zoomHead);

  const xRangeLabel = document.createElement('p'); xRangeLabel.className = 'card-caption'; xRangeLabel.style.cssText = 'font-size:12.5px; color:var(--text-primary); margin:0 0 4px 0;';
  xRangeLabel.textContent = 'X: ' + MONTH_NAMES[state.outlookXMin - 1] + '–' + MONTH_NAMES[state.outlookXMax - 1];
  zoomWrap.appendChild(xRangeLabel);
  zoomWrap.appendChild(makeRangeSliderRow('X from', 1, 12, 1, state.outlookXMin, accent, v => {
    state.outlookXMin = Math.min(v, state.outlookXMax); renderOutlook();
  }));
  zoomWrap.appendChild(makeRangeSliderRow('X to', 1, 12, 1, state.outlookXMax, accent, v => {
    state.outlookXMax = Math.max(v, state.outlookXMin); renderOutlook();
  }));

  const yStep = Math.max(1, Math.round((fullYMax - fullYMin) / 200));
  const yRangeLabel = document.createElement('p'); yRangeLabel.className = 'card-caption'; yRangeLabel.style.cssText = 'font-size:12.5px; color:var(--text-primary); margin:8px 0 4px 0;';
  yRangeLabel.textContent = 'Y: ' + fmtMoney(state.outlookYMin) + ' – ' + fmtMoney(state.outlookYMax);
  zoomWrap.appendChild(yRangeLabel);
  zoomWrap.appendChild(makeRangeSliderRow('Y min', fullYMin, fullYMax, yStep, state.outlookYMin, accent, v => {
    state.outlookYMin = Math.min(v, state.outlookYMax - yStep); renderOutlook();
  }));
  zoomWrap.appendChild(makeRangeSliderRow('Y max', fullYMin, fullYMax, yStep, state.outlookYMax, accent, v => {
    state.outlookYMax = Math.max(v, state.outlookYMin + yStep); renderOutlook();
  }));
  resetZoomBtn.addEventListener('click', () => {
    state.outlookXMin = 1; state.outlookXMax = 12;
    state.outlookYMin = fullYMin; state.outlookYMax = fullYMax;
    renderOutlook();
  });
  chartCard.appendChild(zoomWrap);

  if (projected.length) {
    const note = document.createElement('p'); note.className = 'card-caption'; note.style.marginTop = '10px';
    const latestAsOf = [...asOfDates].sort().slice(-1)[0];
    note.textContent = 'Forward quotes as of report dates through ' + latestAsOf + '. Months with no forward quote yet (bids beyond the market\'s current quoting horizon) are left blank rather than estimated.';
    chartCard.appendChild(note);
  }

  // table view
  const tableToggle = document.createElement('button'); tableToggle.className = 'table-toggle-btn'; tableToggle.textContent = 'Table view'; tableToggle.style.marginTop = '10px';
  chartCard.appendChild(tableToggle);
  const tableDiv = document.createElement('div'); tableDiv.style.display = 'none'; tableDiv.style.marginTop = '10px';
  chartCard.appendChild(tableDiv);
  let shown = false;
  tableToggle.addEventListener('click', () => {
    shown = !shown; tableToggle.classList.toggle('active', shown); tableDiv.style.display = shown ? '' : 'none';
    if (shown && tableDiv.innerHTML === '') {
      let html = '<div class="table-scroll"><table class="data-table"><thead><tr><th>Month</th><th>' + (THIS_YEAR-1) + ' actual</th><th>' + THIS_YEAR + ' actual</th><th>' + THIS_YEAR + ' forward-quoted</th></tr></thead><tbody>';
      for (let m = 1; m <= 12; m++) {
        const pv = prior.find(p=>p.m===m), av = actual.find(p=>p.m===m), pj = projected.find(p=>p.m===m);
        html += '<tr><td>' + MONTH_NAMES[m-1] + '</td><td>' + (pv?fmtMoney(pv.bid):'—') + '</td><td>' + (av?fmtMoney(av.bid):'—') + '</td><td>' + (pj?fmtMoney(pj.bid):'—') + '</td></tr>';
      }
      html += '</tbody></table></div>';
      tableDiv.innerHTML = html;
    }
  });
}

/* ============================== Correlation helpers ============================== */
function pearsonR(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a,b)=>a+b,0) / n, my = ys.reduce((a,b)=>a+b,0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]-mx, dy = ys[i]-my;
    num += dx*dy; dx2 += dx*dx; dy2 += dy*dy;
  }
  const denom = Math.sqrt(dx2*dy2);
  return denom === 0 ? null : num/denom;
}
function linRegress(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a,b)=>a+b,0) / n, my = ys.reduce((a,b)=>a+b,0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i]-mx)*(ys[i]-my); den += (xs[i]-mx)*(xs[i]-mx); }
  const slope = den === 0 ? 0 : num/den;
  const intercept = my - slope*mx;
  return { slope, intercept };
}
function corrStrengthLabel(r) {
  const a = Math.abs(r);
  const dir = r >= 0 ? 'positive' : 'negative';
  let strength;
  if (a < 0.2) strength = 'very weak';
  else if (a < 0.4) strength = 'weak';
  else if (a < 0.6) strength = 'moderate';
  else if (a < 0.8) strength = 'strong';
  else strength = 'very strong';
  return strength + ' ' + dir;
}
function fmtMt(v) {
  return (v/1e6).toLocaleString('en-US', {maximumFractionDigits: 2}) + 'M MT';
}

/* ---------- Shared value formatters & per-railroad/station lookups (used by the integrated model) ---------- */
function fmtHours(v) {
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' hrs';
}
function fmtMph(v) {
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' mph';
}

// Looks up one railroad's monthly series for the chosen metric. "both" averages origin and
// destination dwell hours for months where both are reported. Dwell and speed metrics come
// from two different STB Rail Service Metrics datasets, joined only by railroad + month.
function metricSeriesForRailroad(railroad, metric) {
  const prefix = railroad + '|';
  const out = [];
  if (metric === 'origin' || metric === 'dest') {
    const map = metric === 'origin' ? DWELL_ORIGIN_MONTHLY : DWELL_DEST_MONTHLY;
    map.forEach((value, key) => { if (key.startsWith(prefix)) out.push({ month: key.slice(prefix.length), value }); });
  } else if (metric === 'both') {
    DWELL_ORIGIN_MONTHLY.forEach((oValue, key) => {
      if (!key.startsWith(prefix)) return;
      if (DWELL_DEST_MONTHLY.has(key)) out.push({ month: key.slice(prefix.length), value: (oValue + DWELL_DEST_MONTHLY.get(key)) / 2 });
    });
  } else {
    const map = metric === 'speedGrain' ? SPEED_GRAIN_MONTHLY : SPEED_SYSTEM_MONTHLY;
    map.forEach((value, key) => { if (key.startsWith(prefix)) out.push({ month: key.slice(prefix.length), value }); });
  }
  return out.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
}

function fmtDegF(v) {
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 }) + '°F';
}
function fmtInches(v) {
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' in';
}

// Returns one station's (or "combined"'s) monthly {month, tavg, snow} series. "combined"
// averages tavg and snow independently across whichever stations report data for a given
// month — it does NOT require all 4 to report, so a station with a shorter or gappier
// record still contributes to whichever months it does have without truncating the rest.
function weatherSeriesForSelection(selection) {
  if (selection !== 'combined') {
    const idx = Number(selection);
    return [...WEATHER_BY_STATION[idx].entries()]
      .map(([month, v]) => ({ month, tavg: v.tavg, snow: v.snow }))
      .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  }
  const allMonths = new Set();
  WEATHER_BY_STATION.forEach(map => map.forEach((v, month) => allMonths.add(month)));
  const out = [];
  [...allMonths].sort().forEach(month => {
    const tavgs = [], snows = [];
    WEATHER_BY_STATION.forEach(map => {
      const v = map.get(month);
      if (!v) return;
      if (v.tavg !== null && v.tavg !== undefined) tavgs.push(v.tavg);
      if (v.snow !== null && v.snow !== undefined) snows.push(v.snow);
    });
    out.push({
      month,
      tavg: tavgs.length ? tavgs.reduce((a, b) => a + b, 0) / tavgs.length : null,
      snow: snows.length ? snows.reduce((a, b) => a + b, 0) / snows.length : null,
    });
  });
  return out;
}

/* ============================== LINEAR ALGEBRA (for the multi-variable model) ============================== */
function transpose(A) {
  return A[0].map((_, j) => A.map(row => row[j]));
}
function matMul(A, B) {
  const result = [];
  for (let i = 0; i < A.length; i++) {
    const row = [];
    for (let j = 0; j < B[0].length; j++) {
      let sum = 0;
      for (let k = 0; k < B.length; k++) sum += A[i][k] * B[k][j];
      row.push(sum);
    }
    result.push(row);
  }
  return result;
}
function matVecMul(A, v) {
  return A.map(row => row.reduce((s, a, i) => s + a * v[i], 0));
}
// Solves A*x = b via Gaussian elimination with partial pivoting. Returns null if singular
// (e.g. two selected inputs are perfectly collinear for the current combo/station).
function solveLinearSystem(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r;
    if (Math.abs(M[pivotRow][col]) < 1e-9) return null;
    [M[col], M[pivotRow]] = [M[pivotRow], M[col]];
    const pivotVal = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= pivotVal;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let j = col; j <= n; j++) M[r][j] -= factor * M[col][j];
    }
  }
  return M.map(row => row[n]);
}
function stddev(arr) {
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) * (x - m), 0) / arr.length);
}
// Ordinary least squares: rows are complete-case objects, xKeys are predictor field names.
// Returns null if the design matrix is singular. stdBetas let differently-scaled predictors
// (mph vs hours vs $) be compared for relative influence on the same footing.
function fitOLS(rows, yKey, xKeys) {
  const n = rows.length;
  const k = xKeys.length;
  const X = rows.map(r => [1, ...xKeys.map(xk => r[xk])]);
  const y = rows.map(r => r[yKey]);
  const XtX = matMul(transpose(X), X);
  const Xty = matVecMul(transpose(X), y);
  const beta = solveLinearSystem(XtX, Xty);
  if (!beta) return null;
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  const predictions = X.map(row => row.reduce((s, x, i) => s + x * beta[i], 0));
  const ssRes = y.reduce((s, yi, i) => s + (yi - predictions[i]) ** 2, 0);
  const ssTot = y.reduce((s, yi) => s + (yi - yMean) ** 2, 0);
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  const adjR2 = (n - k - 1) > 0 ? 1 - (1 - r2) * (n - 1) / (n - k - 1) : null;
  const ySd = stddev(y);
  const stdBetas = xKeys.map((xk, i) => {
    const xSd = stddev(rows.map(r => r[xk]));
    return ySd === 0 ? 0 : beta[i + 1] * xSd / ySd;
  });
  return { n, k, beta, predictions, r2, adjR2, stdBetas };
}

/* ---------- Integrated correlation model tab ---------- */
function fmtBu(v) {
  const abs = Math.abs(v);
  if (abs >= 1e9) return (v / 1e9).toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'B bu';
  return (v / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'M bu';
}
// Broadcasts one annual value across all 12 months of that year — NASS crop production is
// reported once per year, not monthly, so this treats it as a step function (same value every
// month of the year it was measured) rather than trying to guess an in-year distribution.
function annualToMonthly(yearMap) {
  const out = [];
  yearMap.forEach((value, year) => {
    for (let m = 1; m <= 12; m++) out.push({ month: year + '-' + String(m).padStart(2, '0'), value });
  });
  return out;
}

// One flat list of selectable inputs spanning what used to be 3 separate tabs (PNW exports,
// dwell & speed, weather). "Dwell: Both (avg)" was dropped from this list — in a multi-variable
// model it would just be a linear combination of the Origin/Destination rows already offered,
// which adds collinearity risk without adding information.
const MODEL_VARS = [
  { key: 'pnw', label: 'PNW export volume', fmt: fmtMt, color: '--series-1',
    seriesFor: () => PNW_MONTHLY.map(p => ({ month: p.month, value: p.mt })) },
  { key: 'dwellOrigin', label: 'Dwell: Origin', fmt: fmtHours, color: '--series-2',
    seriesFor: combo => metricSeriesForRailroad(combo.company, 'origin') },
  { key: 'dwellDest', label: 'Dwell: Destination', fmt: fmtHours, color: '--series-3',
    seriesFor: combo => metricSeriesForRailroad(combo.company, 'dest') },
  { key: 'speedGrain', label: 'Speed: Grain trains', fmt: fmtMph, color: '--series-4',
    seriesFor: combo => metricSeriesForRailroad(combo.company, 'speedGrain') },
  { key: 'speedSystem', label: 'Speed: System-wide', fmt: fmtMph, color: '--series-5',
    seriesFor: combo => metricSeriesForRailroad(combo.company, 'speedSystem') },
  { key: 'temp', label: 'Weather: Avg temp', fmt: fmtDegF, color: '--series-1',
    seriesFor: () => weatherSeriesForSelection(state.modelStation).filter(w => w.tavg !== null && w.tavg !== undefined).map(w => ({ month: w.month, value: w.tavg })) },
  { key: 'snow', label: 'Weather: Snowfall', fmt: fmtInches, color: '--series-2',
    seriesFor: () => weatherSeriesForSelection(state.modelStation).filter(w => w.snow !== null && w.snow !== undefined).map(w => ({ month: w.month, value: w.snow })) },
  { key: 'cropCorn', label: 'Crop: Corn production (ND+SD+MN)', fmt: fmtBu, color: '--series-3',
    seriesFor: () => annualToMonthly(CROP_CORN_BY_YEAR) },
  { key: 'cropSoybeans', label: 'Crop: Soybean production (ND+SD+MN)', fmt: fmtBu, color: '--series-4',
    seriesFor: () => annualToMonthly(CROP_SOYBEANS_BY_YEAR) },
  { key: 'cropWheat', label: 'Crop: Wheat production (ND+SD+MN)', fmt: fmtBu, color: '--series-5',
    seriesFor: () => annualToMonthly(CROP_WHEAT_BY_YEAR) },
];

// Shared by the "Time frame" preset chips and the "Find best combination" search, so both
// always offer/search the same set of windows.
function getTimeFramePresets(dataMinYear, dataMaxYear) {
  return [
    ['All history', dataMinYear, dataMaxYear],
    ['Last 3 years', Math.max(dataMinYear, dataMaxYear - 2), dataMaxYear],
    ['Last 5 years', Math.max(dataMinYear, dataMaxYear - 4), dataMaxYear],
    ['2021–present', Math.max(dataMinYear, 2021), dataMaxYear],
  ];
}

// Builds the complete-case dataset for the active variable set: one row per month where the
// bid AND every checked input has a non-null value. Multiple regression can't tolerate holes
// per-predictor the way pairwise correlation could, so this is a strict intersection.
function buildModelDataset(combo, activeKeys, fromYear, toYear) {
  const rows = comboRows(combo, true);
  const byMonth = new Map();
  rows.forEach(r => {
    const m = r.date.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(r.bid);
  });
  const railMonthly = new Map();
  byMonth.forEach((vals, m) => railMonthly.set(m, vals.reduce((a, b) => a + b, 0) / vals.length));

  const varMaps = {};
  activeKeys.forEach(k => {
    const def = MODEL_VARS.find(v => v.key === k);
    const m = new Map();
    def.seriesFor(combo).forEach(r => { if (r.value !== null && r.value !== undefined) m.set(r.month, r.value); });
    varMaps[k] = m;
  });

  const out = [];
  [...railMonthly.keys()].sort().forEach(month => {
    const y = Number(month.slice(0, 4));
    if (fromYear !== undefined && y < fromYear) return;
    if (toYear !== undefined && y > toYear) return;
    if (!activeKeys.every(k => varMaps[k].has(month))) return;
    const row = { month, bid: railMonthly.get(month) };
    activeKeys.forEach(k => { row[k] = varMaps[k].get(month); });
    out.push(row);
  });
  return out;
}

// Brute-forces every non-empty subset of MODEL_VARS (127) against every weather station (5,
// only when temp/snow is in the subset) — up to ~511 fits — within the CALLER'S current time
// frame (fromYear/toYear are fixed inputs, not searched — the "Find best combination" button
// deliberately leaves the Time frame slider alone rather than silently jumping to a different
// window), and returns the one with the highest ADJUSTED R² among candidates with at least
// MIN_ROWS complete-case months. Ranking by adjusted (not raw) R² is what keeps this from just
// always picking "check everything": raw R² can only go up as predictors are added, adjusted R²
// only rewards a predictor if it earns its keep. The row-count floor exists because a handful of
// months and several predictors can otherwise "fit" a very high but meaningless R² — this is
// still an exhaustive search over ~500 candidates, so even the floor doesn't fully rule out a
// lucky-looking result; treat the winner as a lead to verify, not a proven relationship.
// Mutates state.modelStation while probing weather-dependent subsets; restores it before
// returning so callers can read off the winning station from the returned result.
const MODEL_SEARCH_MIN_ROWS = 30;
function findBestCombination(combo, fromYear, toYear) {
  const MIN_ROWS = MODEL_SEARCH_MIN_ROWS;
  const allKeys = MODEL_VARS.map(v => v.key);
  const stations = ['0', '1', '2', '3', 'combined'];
  const savedStation = state.modelStation;

  let tried = 0;
  let best = null;
  for (let mask = 1; mask < (1 << allKeys.length); mask++) {
    const subset = allKeys.filter((_, i) => mask & (1 << i));
    const usesWeather = subset.includes('temp') || subset.includes('snow');
    const stationList = usesWeather ? stations : [savedStation];
    for (const station of stationList) {
      state.modelStation = station;
      tried++;
      const dataset = buildModelDataset(combo, subset, fromYear, toYear);
      if (dataset.length < Math.max(MIN_ROWS, subset.length + 5)) continue;
      const fit = fitOLS(dataset, 'bid', subset);
      if (!fit) continue;
      if (!best || fit.adjR2 > best.adjR2) {
        best = { subset, station, n: fit.n, r2: fit.r2, adjR2: fit.adjR2 };
      }
    }
  }
  state.modelStation = savedStation;
  return { best, tried };
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return null;
  const idx = (p / 100) * (sortedArr.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
}

// One variable's high/average/low by CALENDAR MONTH (Jan..Dec), drawn from its own full
// history — not the multi-variable intersection used to fit coefficients, which is usually
// too thin per calendar-month bucket for stable percentiles (e.g. a 38-row intersection split
// 12 ways is ~3 rows/month). Returns an array of 12 entries, null for any month with no data
// at all for this variable (annual/crop inputs are broadcast identically across all 12 months
// of a year, so grouping them by month just resamples the same annual figures — harmless, just
// doesn't add real seasonal information, which is correct since they have none).
function monthlySeasonalStats(combo, key) {
  const def = MODEL_VARS.find(v => v.key === key);
  const byMonth = Array.from({ length: 12 }, () => []);
  def.seriesFor(combo).forEach(r => {
    if (r.value === null || r.value === undefined) return;
    byMonth[Number(r.month.slice(5, 7)) - 1].push(r.value);
  });
  return byMonth.map(vals => {
    if (vals.length === 0) return null;
    const sorted = [...vals].sort((a, b) => a - b);
    return { low: percentile(sorted, 10), avg: vals.reduce((a, b) => a + b, 0) / vals.length, high: percentile(sorted, 90), n: vals.length };
  });
}

// One variable's low/average/high computed from its OWN full history, independent of any
// particular multi-variable fit or intersection. Used for the "Input variables" table's
// unchecked (not-in-model) rows, where there's no fitted coefficient/dataset to draw from.
// `station` is required for temp/snow — their seriesFor() reads the shared state.modelStation
// global rather than taking a parameter, so it must be set (and restored) around the call;
// callers pass whatever station the current scenario is using, not necessarily what's left
// over in state.modelStation from a Correlation-model-tab visit (which may be unset entirely).
function standaloneVarStats(combo, key, station) {
  const def = MODEL_VARS.find(v => v.key === key);
  const savedStation = state.modelStation;
  state.modelStation = station;
  const vals = def.seriesFor(combo).map(r => r.value).filter(v => v !== null && v !== undefined).sort((a, b) => a - b);
  state.modelStation = savedStation;
  if (vals.length === 0) return null;
  return { low: percentile(vals, 10), avg: vals.reduce((a, b) => a + b, 0) / vals.length, high: percentile(vals, 90) };
}

// Fits OLS for exactly `subset` (no searching) and computes the full seasonal high/average/low
// scenario — the shared core behind both computeModelScenario (search then fit) and the Outlook
// tab's per-variable checkboxes (fit whatever the user currently has checked, no search). See
// computeModelScenario's comment for the seasonal-prediction methodology. Returns null if there
// isn't enough complete-case data for this specific subset (n < subset.length + 5).
function fitScenarioForSubset(combo, subset, station, dataMinYear, dataMaxYear) {
  const savedStation = state.modelStation;
  state.modelStation = station;
  const dataset = buildModelDataset(combo, subset, dataMinYear, dataMaxYear);
  if (dataset.length < subset.length + 5) { state.modelStation = savedStation; return null; }
  const fit = fitOLS(dataset, 'bid', subset);
  if (!fit) { state.modelStation = savedStation; return null; }

  // Annual (pooled) stats — the "Input variables" table, and the fallback for any calendar
  // month with zero history for a given variable.
  const varStats = subset.map((key, i) => {
    const vals = dataset.map(d => d[key]).sort((a, b) => a - b);
    return { key, low: percentile(vals, 10), avg: vals.reduce((a, b) => a + b, 0) / vals.length, high: percentile(vals, 90), coef: fit.beta[i + 1] };
  });
  const monthlyVarStatsArr = subset.map(key => monthlySeasonalStats(combo, key));
  const monthlyVarStats = {}; subset.forEach((key, i) => { monthlyVarStats[key] = monthlyVarStatsArr[i]; });
  state.modelStation = savedStation;

  const predictMonth = (m, which) => {
    let sum = fit.beta[0];
    subset.forEach((key, i) => {
      const monthStat = monthlyVarStats[key][m - 1];
      sum += fit.beta[i + 1] * (monthStat ? monthStat[which] : varStats[i][which]);
    });
    return sum;
  };
  const monthlyHigh = [], monthlyAvg = [], monthlyLow = [];
  for (let m = 1; m <= 12; m++) {
    monthlyHigh.push(predictMonth(m, 'high'));
    monthlyAvg.push(predictMonth(m, 'avg'));
    monthlyLow.push(predictMonth(m, 'low'));
  }
  const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;

  return {
    comboKey: combo.key, subset, station, intercept: fit.beta[0],
    r2: fit.r2, adjR2: fit.adjR2, n: fit.n, varStats, monthlyVarStats,
    monthlyHigh, monthlyAvg, monthlyLow,
    predHigh: mean(monthlyHigh), predAvg: mean(monthlyAvg), predLow: mean(monthlyLow),
  };
}

// Predicts one month-by-month line where EACH variable independently uses its own low/avg/high
// (per `levels[key]`, defaulting to 'avg' for anything unset) — unlike monthlyHigh/Avg/Low,
// which move every variable together. Lets the Outlook tab build a mixed "what if PNW is high
// but dwell stays average" scenario instead of only the three all-together postures.
function customMonthlyFor(sc, levels) {
  const out = [];
  for (let m = 1; m <= 12; m++) {
    let sum = sc.intercept;
    sc.subset.forEach(key => {
      const vs = sc.varStats.find(v => v.key === key);
      const level = levels[key] || 'avg';
      const monthStat = sc.monthlyVarStats[key][m - 1];
      sum += vs.coef * (monthStat ? monthStat[level] : vs[level]);
    });
    out.push(sum);
  }
  return out;
}

// Runs the same best-fit search as the Correlation model tab for `combo` over its full
// history, then fits that winning combination via fitScenarioForSubset to get the full
// seasonal high/average/low scenario (high/average/low computed per calendar month — see
// fitScenarioForSubset / monthlySeasonalStats). Used by the 2026 outlook tab's "Run best-fit
// scenario" button; the per-variable checkboxes in that tab's table re-fit directly via
// fitScenarioForSubset afterward without re-running this search. Returns null if no combination
// qualifies (see MODEL_SEARCH_MIN_ROWS).
function computeModelScenario(combo, dataMinYear, dataMaxYear) {
  const { best } = findBestCombination(combo, dataMinYear, dataMaxYear);
  if (!best) return null;
  return fitScenarioForSubset(combo, best.subset, best.station, dataMinYear, dataMaxYear);
}

function renderModel() {
  const panel = document.getElementById('panel-model');
  panel.innerHTML = '';
  const combos = visibleCombos();
  if (combos.length === 0) { panel.innerHTML = '<div class="empty-state">Select at least one railroad and service type above.</div>'; return; }
  if (!state.modelFocus || !combos.find(c => c.key === state.modelFocus)) state.modelFocus = defaultComboKey(combos);
  if (!state.modelStation) state.modelStation = 'combined';
  if (!state.modelVars) state.modelVars = new Set(MODEL_VARS.map(v => v.key));
  const combo = combos.find(c => c.key === state.modelFocus);
  const accent = cssVar(combo.color);

  const dataMinYear = Number(ROWS.reduce((a, r) => (r.date < a ? r.date : a), ROWS[0].date).slice(0, 4));
  const dataMaxYear = Number(ROWS.reduce((a, r) => (r.date > a ? r.date : a), ROWS[0].date).slice(0, 4));
  if (state.modelFromYear === undefined || state.modelFromYear < dataMinYear) state.modelFromYear = dataMinYear;
  if (state.modelToYear === undefined || state.modelToYear > dataMaxYear) state.modelToYear = dataMaxYear;
  if (state.modelFromYear > state.modelToYear) state.modelFromYear = state.modelToYear;

  const head = document.createElement('div'); head.className = 'card';
  const h = document.createElement('div'); h.className = 'card-head';
  h.innerHTML = '<div><p class="card-title">Integrated correlation model</p>' +
    '<p class="card-caption">Fits ' + combo.label + '\'s monthly-average near-month bid against whichever inputs are checked below — PNW export volume, rail car dwell, train speed, corridor weather, and ND+SD+MN row-crop production all in one model. Check exactly one input for a simple correlation (Pearson r); check two or more for multiple linear regression (OLS), reporting R&sup2; and each input\'s coefficient. Only months with complete data for every checked input are used, so checking more inputs (or picking a shorter-history station) can shrink the usable window — PNW starts 2010, dwell/speed start 2014-10, weather varies by station, crop production is annual (USDA NASS, broadcast across each year\'s 12 months) and only covers 1995 onward. Highly correlated inputs checked together can also produce unstable coefficients.</p></div>';
  const selRow = document.createElement('div'); selRow.className = 'select-row';
  selRow.innerHTML = 'Series <select id="model-select"></select> Weather station <select id="model-station-select"></select>';
  h.appendChild(selRow);
  head.appendChild(h);
  panel.appendChild(head);

  const sel = selRow.querySelector('#model-select');
  combos.forEach(c => {
    const opt = document.createElement('option'); opt.value = c.key; opt.textContent = c.label;
    if (c.key === state.modelFocus) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => { state.modelFocus = sel.value; state.modelBestResultMsg = null; renderModel(); });

  const stationSel = selRow.querySelector('#model-station-select');
  WEATHER_STATIONS.forEach((st, i) => {
    const opt = document.createElement('option'); opt.value = String(i); opt.textContent = st.name;
    if (String(i) === state.modelStation) opt.selected = true;
    stationSel.appendChild(opt);
  });
  const combinedOpt = document.createElement('option'); combinedOpt.value = 'combined'; combinedOpt.textContent = 'All 4 combined (avg)';
  if (state.modelStation === 'combined') combinedOpt.selected = true;
  stationSel.appendChild(combinedOpt);
  stationSel.addEventListener('change', () => { state.modelStation = stationSel.value; state.modelBestResultMsg = null; renderModel(); });

  // ---- time frame card: two range sliders (from/to year) + quick presets ----
  const tfCard = document.createElement('div'); tfCard.className = 'card';
  const tfTitle = document.createElement('p'); tfTitle.className = 'card-title'; tfTitle.style.marginBottom = '2px'; tfTitle.textContent = 'Time frame';
  const tfCaption = document.createElement('p'); tfCaption.className = 'card-caption'; tfCaption.style.marginBottom = '10px';
  tfCaption.textContent = 'Restrict the model to a date range — e.g. drag "From" forward to test whether correlations are stronger in more recent years than over the full history.';
  tfCard.appendChild(tfTitle); tfCard.appendChild(tfCaption);

  const tfRangeLabel = document.createElement('p'); tfRangeLabel.className = 'card-caption'; tfRangeLabel.style.fontSize = '13px'; tfRangeLabel.style.color = 'var(--text-primary)'; tfRangeLabel.style.margin = '0 0 8px 0';
  tfRangeLabel.textContent = state.modelFromYear + ' – ' + state.modelToYear;
  tfCard.appendChild(tfRangeLabel);

  tfCard.appendChild(makeRangeSliderRow('From', dataMinYear, dataMaxYear, 1, state.modelFromYear, accent, v => {
    state.modelFromYear = Math.min(v, state.modelToYear);
    state.modelBestResultMsg = null;
    renderModel();
  }));
  tfCard.appendChild(makeRangeSliderRow('To', dataMinYear, dataMaxYear, 1, state.modelToYear, accent, v => {
    state.modelToYear = Math.max(v, state.modelFromYear);
    state.modelBestResultMsg = null;
    renderModel();
  }));

  const presetRow = document.createElement('div'); presetRow.className = 'filter-group'; presetRow.style.marginTop = '4px';
  getTimeFramePresets(dataMinYear, dataMaxYear).forEach(([label, from, to]) => {
    const chip = document.createElement('label');
    const isActive = state.modelFromYear === from && state.modelToYear === to;
    chip.className = 'chip' + (isActive ? ' active' : '');
    chip.textContent = label;
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      state.modelFromYear = from; state.modelToYear = to;
      state.modelBestResultMsg = null;
      renderModel();
    });
    presetRow.appendChild(chip);
  });
  tfCard.appendChild(presetRow);
  panel.appendChild(tfCard);

  const varCard = document.createElement('div'); varCard.className = 'card';
  const varHead = document.createElement('div'); varHead.className = 'card-head';
  varHead.innerHTML = '<div><p class="card-title">Input variables</p><p class="card-caption">Check any combination yourself, or let the search try all of them for the current series.</p></div>';
  const findBtn = document.createElement('button'); findBtn.className = 'table-toggle-btn'; findBtn.type = 'button'; findBtn.textContent = 'Find best combination';
  varHead.appendChild(findBtn);
  varCard.appendChild(varHead);

  const chipRow = document.createElement('div'); chipRow.className = 'filter-group';
  MODEL_VARS.forEach(v => {
    const chip = document.createElement('label');
    chip.className = 'chip' + (state.modelVars.has(v.key) ? ' active' : '');
    chip.innerHTML = '<span class="dot" style="background:var(' + v.color + ')"></span>' + v.label;
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      if (state.modelVars.has(v.key)) { if (state.modelVars.size > 1) state.modelVars.delete(v.key); }
      else state.modelVars.add(v.key);
      state.modelBestResultMsg = null;
      renderModel();
    });
    chipRow.appendChild(chip);
  });
  varCard.appendChild(chipRow);

  if (state.modelBestResultMsg) {
    const banner = document.createElement('p'); banner.className = 'card-caption';
    banner.style.cssText = 'margin-top:10px; color:var(--text-primary); font-size:12.5px;';
    banner.textContent = state.modelBestResultMsg;
    varCard.appendChild(banner);
  }
  panel.appendChild(varCard);

  findBtn.addEventListener('click', () => {
    findBtn.disabled = true; findBtn.textContent = 'Searching…';
    setTimeout(() => {
      const { best, tried } = findBestCombination(combo, state.modelFromYear, state.modelToYear);
      if (!best) {
        state.modelBestResultMsg = 'Searched ' + tried + ' combinations within ' + state.modelFromYear + '–' + state.modelToYear + ' — none had at least ' + MODEL_SEARCH_MIN_ROWS + ' complete-case months. Try widening the time frame above, then search again.';
      } else {
        state.modelVars = new Set(best.subset);
        state.modelStation = best.station;
        const varLabels = best.subset.map(k => MODEL_VARS.find(v => v.key === k).label).join(' + ');
        const usesWeather = best.subset.includes('temp') || best.subset.includes('snow');
        const stationNote = usesWeather ? (best.station === 'combined' ? ' (combined station)' : ' (' + WEATHER_STATIONS[Number(best.station)].name + ')') : '';
        state.modelBestResultMsg = 'Best found within ' + state.modelFromYear + '–' + state.modelToYear + ': ' + varLabels + stationNote + ' — R² ' + best.r2.toFixed(2) + ', adjusted R² ' + best.adjR2.toFixed(2) + ', n=' + best.n + '. Searched ' + tried + ' combinations (require ≥' + MODEL_SEARCH_MIN_ROWS + ' complete-case months to qualify, ranked by adjusted R²) — treat this as a lead to verify, not a proven relationship. Change the time frame above to search a different window.';
      }
      renderModel();
    }, 0);
  });

  const activeVars = MODEL_VARS.filter(v => state.modelVars.has(v.key));
  const activeKeys = activeVars.map(v => v.key);
  const dataset = buildModelDataset(combo, activeKeys, state.modelFromYear, state.modelToYear);

  if (dataset.length < activeKeys.length + 2) {
    const empty = document.createElement('div'); empty.className = 'empty-state';
    empty.textContent = 'Not enough overlapping months with complete data for all checked inputs in ' + state.modelFromYear + '–' + state.modelToYear + ' (' + dataset.length + ' available). Uncheck an input, widen the time frame, or try a different series/station.';
    panel.appendChild(empty);
    return;
  }

  const monthToMs = m => Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1);
  const xTicksFn = (min, max) => {
    const startY = new Date(min).getUTCFullYear(); const endY = new Date(max).getUTCFullYear();
    const step = Math.max(1, Math.round((endY - startY) / 8));
    const ticks = [];
    for (let y = Math.ceil(startY / step) * step; y <= endY; y += step) ticks.push({ x: Date.UTC(y, 0, 1), label: String(y) });
    return ticks;
  };
  const tooltipTitle = x => new Date(x).toLocaleDateString('en-US', { year: 'numeric', month: 'short', timeZone: 'UTC' });

  if (activeKeys.length === 1) {
    // ---- exactly one input: simple correlation ----
    const v = activeVars[0];
    const r = pearsonR(dataset.map(d => d[v.key]), dataset.map(d => d.bid));
    const corrCard = document.createElement('div'); corrCard.className = 'card';
    corrCard.innerHTML = '<div class="kpi-row">' +
      '<div class="stat-tile"><div class="st-label">Correlation (Pearson r)</div><div class="st-value">' + (r === null ? 'n/a' : r.toFixed(2)) + '</div><div class="st-date">' + (r === null ? 'not enough overlapping months' : corrStrengthLabel(r)) + '</div></div>' +
      '<div class="stat-tile"><div class="st-label">Overlapping months</div><div class="st-value">' + dataset.length + '</div><div class="st-date">' + dataset[0].month + ' to ' + dataset[dataset.length - 1].month + '</div></div>' +
      '</div>';
    panel.appendChild(corrCard);

    const tsCard = document.createElement('div'); tsCard.className = 'card';
    tsCard.innerHTML = '<div class="card-head"><div><p class="card-title">Both series over time</p><p class="card-caption">Two separate axes by design — different units aren\'t comparable on one scale.</p></div></div>';
    const varChartDiv = document.createElement('div'); varChartDiv.className = 'chart-wrap';
    const varLabel = document.createElement('p'); varLabel.className = 'card-caption'; varLabel.style.margin = '2px 0 6px 0'; varLabel.textContent = v.label + ' /month';
    tsCard.appendChild(varLabel); tsCard.appendChild(varChartDiv);
    const railLabel = document.createElement('p'); railLabel.className = 'card-caption'; railLabel.style.margin = '14px 0 6px 0'; railLabel.textContent = combo.label + ' — monthly-average near-month bid ($)';
    tsCard.appendChild(railLabel);
    const railChartDiv = document.createElement('div'); railChartDiv.className = 'chart-wrap';
    tsCard.appendChild(railChartDiv);
    panel.appendChild(tsCard);

    drawLineChart(varChartDiv, [{ key: v.key, label: v.label, color: cssVar(v.color), points: dataset.map(d => ({ x: monthToMs(d.month), y: d[v.key], raw: d[v.key] })), directLabel: false, width: 2 }], {
      height: 190, yFormat: v.fmt, xTicks: xTicksFn, tooltipTitle,
    });
    drawLineChart(railChartDiv, [{ key: 'rail', label: combo.label, color: accent, points: dataset.map(d => ({ x: monthToMs(d.month), y: d.bid, raw: d.bid })), directLabel: false, width: 2 }], {
      height: 190, yFormat: fmtMoney, xTicks: xTicksFn, tooltipTitle,
    });

    const scCard = document.createElement('div'); scCard.className = 'card';
    scCard.innerHTML = '<div class="card-head"><div><p class="card-title">Scatter: ' + v.label.toLowerCase() + ' vs. bid</p><p class="card-caption">Each point is one month. Line is the least-squares fit.</p></div></div>';
    const scDiv = document.createElement('div'); scDiv.className = 'chart-wrap';
    scCard.appendChild(scDiv);
    panel.appendChild(scCard);
    drawScatterChart(scDiv, dataset.map(d => ({ x: d[v.key], y: d.bid, label: d.month })), {
      height: 320, color: accent, xFormat: v.fmt, yFormat: fmtMoney,
      xLabel: v.label, yLabel: combo.label + ' bid',
    });
    return;
  }

  // ---- two or more inputs: multiple linear regression ----
  const fit = fitOLS(dataset, 'bid', activeKeys);
  if (!fit) {
    const empty = document.createElement('div'); empty.className = 'empty-state';
    empty.textContent = 'Couldn\'t fit a model — the checked inputs are too collinear with each other to solve. Try a different combination of inputs.';
    panel.appendChild(empty);
    return;
  }
  const rMultiple = Math.sqrt(Math.max(fit.r2, 0));
  const corrCard = document.createElement('div'); corrCard.className = 'card';
  corrCard.innerHTML = '<div class="kpi-row">' +
    '<div class="stat-tile"><div class="st-label">R&sup2; (variance explained)</div><div class="st-value">' + fit.r2.toFixed(2) + '</div><div class="st-date">multiple R ' + rMultiple.toFixed(2) + '</div></div>' +
    '<div class="stat-tile"><div class="st-label">Adjusted R&sup2;</div><div class="st-value">' + (fit.adjR2 === null ? 'n/a' : fit.adjR2.toFixed(2)) + '</div><div class="st-date">penalized for ' + activeKeys.length + ' inputs</div></div>' +
    '<div class="stat-tile"><div class="st-label">Rows used (complete cases)</div><div class="st-value">' + fit.n + '</div><div class="st-date">' + dataset[0].month + ' to ' + dataset[dataset.length - 1].month + '</div></div>' +
    '</div>';
  panel.appendChild(corrCard);

  const coefCard = document.createElement('div'); coefCard.className = 'card';
  const coefTitle = document.createElement('p'); coefTitle.className = 'card-title'; coefTitle.style.marginBottom = '8px'; coefTitle.textContent = 'Coefficients';
  coefCard.appendChild(coefTitle);
  let tableHtml = '<div class="table-scroll"><table class="data-table"><thead><tr><th>Input</th><th>Coefficient ($ per unit)</th><th>Standardized &beta;</th><th>Direction</th></tr></thead><tbody>';
  tableHtml += '<tr><td>Intercept</td><td>' + fmtMoney(fit.beta[0]) + '</td><td>&mdash;</td><td>&mdash;</td></tr>';
  activeVars.forEach((v, i) => {
    const coef = fit.beta[i + 1];
    const dirClass = coef > 0 ? 'up' : coef < 0 ? 'down' : 'flat';
    const dirText = coef > 0 ? '▲ raises bid' : coef < 0 ? '▼ lowers bid' : '—';
    tableHtml += '<tr><td>' + v.label + '</td><td>' + fmtMoney(coef) + '</td><td>' + fit.stdBetas[i].toFixed(2) + '</td><td class="st-delta ' + dirClass + '">' + dirText + '</td></tr>';
  });
  tableHtml += '</tbody></table></div>';
  coefCard.innerHTML += tableHtml;
  panel.appendChild(coefCard);

  const tsCard = document.createElement('div'); tsCard.className = 'card';
  tsCard.innerHTML = '<div class="card-head"><div><p class="card-title">All series over time</p><p class="card-caption">Separate axes throughout — different units aren\'t comparable on one scale.</p></div></div>';
  activeVars.forEach(v => {
    const chartDiv = document.createElement('div'); chartDiv.className = 'chart-wrap';
    const label = document.createElement('p'); label.className = 'card-caption'; label.style.margin = '10px 0 6px 0'; label.textContent = v.label + ' /month';
    tsCard.appendChild(label); tsCard.appendChild(chartDiv);
    drawLineChart(chartDiv, [{ key: v.key, label: v.label, color: cssVar(v.color), points: dataset.map(d => ({ x: monthToMs(d.month), y: d[v.key], raw: d[v.key] })), directLabel: false, width: 2 }], {
      height: 150, yFormat: v.fmt, xTicks: xTicksFn, tooltipTitle,
    });
  });
  const railLabel = document.createElement('p'); railLabel.className = 'card-caption'; railLabel.style.margin = '10px 0 6px 0'; railLabel.textContent = combo.label + ' — monthly-average near-month bid ($)';
  tsCard.appendChild(railLabel);
  const railChartDiv = document.createElement('div'); railChartDiv.className = 'chart-wrap';
  tsCard.appendChild(railChartDiv);
  drawLineChart(railChartDiv, [{ key: 'rail', label: combo.label, color: accent, points: dataset.map(d => ({ x: monthToMs(d.month), y: d.bid, raw: d.bid })), directLabel: false, width: 2 }], {
    height: 190, yFormat: fmtMoney, xTicks: xTicksFn, tooltipTitle,
  });
  panel.appendChild(tsCard);

  const scCard = document.createElement('div'); scCard.className = 'card';
  scCard.innerHTML = '<div class="card-head"><div><p class="card-title">Model fit: predicted vs. actual bid</p><p class="card-caption">Each point is one month. Dashed line is the least-squares fit of predicted vs. actual — a perfect model would sit on the 45&deg; diagonal. Click a point for details.</p></div></div>';
  const scDiv = document.createElement('div'); scDiv.className = 'chart-wrap';
  scCard.appendChild(scDiv);
  const scExplain = document.createElement('p'); scExplain.className = 'card-caption';
  scExplain.style.cssText = 'margin-top:10px; color:var(--text-primary); font-size:12.5px; min-height:16px;';
  scExplain.textContent = 'Click a point above to see which month it represents.';
  scCard.appendChild(scExplain);
  panel.appendChild(scCard);
  drawScatterChart(scDiv, dataset.map((d, i) => ({ x: fit.predictions[i], y: d.bid, label: d.month })), {
    height: 320, color: accent, xFormat: fmtMoney, yFormat: fmtMoney,
    xLabel: 'Predicted bid', yLabel: 'Actual bid',
    onPointClick: (p) => {
      const y = Number(p.label.slice(0, 4)), m = Number(p.label.slice(5, 7));
      const monthLabel = MONTH_NAMES[m - 1] + ' ' + y;
      const residual = p.y - p.x;
      const dir = residual > 0 ? 'above' : residual < 0 ? 'below' : 'exactly at';
      scExplain.textContent = monthLabel + ' — ' + combo.label + ': actual bid was ' + fmtMoney(p.y) +
        ', ' + fmtMoney(Math.abs(residual)) + ' ' + dir + ' the model\'s predicted ' + fmtMoney(p.x) + '.';
    },
  });
}

/* ============================== GENERIC SCATTER CHART ============================== */
function drawScatterChart(container, points, opts) {
  container.innerHTML = '';
  const W = 900, H = opts.height || 320;
  const margin = { top: 14, right: 18, bottom: 30, left: 64 };
  const innerW = W - margin.left - margin.right, innerH = H - margin.top - margin.bottom;
  if (points.length < 2) { container.innerHTML = '<div class="empty-state">Not enough overlapping data to plot.</div>'; return; }

  const xMin = Math.min(...points.map(p=>p.x)), xMax = Math.max(...points.map(p=>p.x));
  const yMin = Math.min(...points.map(p=>p.y), 0), yMax = Math.max(...points.map(p=>p.y), 0);
  const xPad = (xMax-xMin)*0.06 || 1, yPad = (yMax-yMin)*0.08 || 1;
  const xt = niceTicks(xMin-xPad, xMax+xPad, 5);
  const yt = niceTicks(yMin-yPad, yMax+yPad, 5);
  const xScale = x => margin.left + (x - xt.min)/(xt.max-xt.min)*innerW;
  const yScale = y => margin.top + (1 - (y - yt.min)/(yt.max-yt.min))*innerH;

  const svg = svgEl('svg', { class:'chart-svg', viewBox:'0 0 '+W+' '+H, preserveAspectRatio:'none' });
  yt.ticks.forEach(tv => {
    const y = yScale(tv);
    svg.appendChild(svgEl('line', { class: tv===0?'baseline':'gridline', x1:margin.left, x2:W-margin.right, y1:y, y2:y }));
    const lbl = svgEl('text', { class:'axis-label', x:margin.left-8, y:y+3, 'text-anchor':'end' });
    lbl.textContent = opts.yFormat ? opts.yFormat(tv) : tv;
    svg.appendChild(lbl);
  });
  xt.ticks.forEach(tv => {
    const x = xScale(tv);
    const lbl = svgEl('text', { class:'axis-label', x:x, y:H-8, 'text-anchor':'middle' });
    lbl.textContent = opts.xFormat ? opts.xFormat(tv) : tv;
    svg.appendChild(lbl);
  });

  // trend line
  const { slope, intercept } = linRegress(points.map(p=>p.x), points.map(p=>p.y));
  const tx1 = xt.min, tx2 = xt.max;
  svg.appendChild(svgEl('line', {
    x1:xScale(tx1), y1:yScale(slope*tx1+intercept), x2:xScale(tx2), y2:yScale(slope*tx2+intercept),
    stroke: cssVar('--text-muted'), 'stroke-width':1.5, 'stroke-dasharray':'5,4'
  }));

  const tooltip = document.getElementById('tooltip');
  points.forEach(p => {
    const cx = xScale(p.x), cy = yScale(p.y);
    const dot = svgEl('circle', { cx, cy, r:4, fill: opts.color, opacity:0.75 });
    const hit = svgEl('circle', { cx, cy, r:12, fill:'transparent', style:'cursor:pointer' });
    hit.addEventListener('pointerenter', () => {
      dot.setAttribute('r', 6);
      tooltip.innerHTML = '';
      const t = document.createElement('div'); t.className='tt-date'; t.textContent = p.label; tooltip.appendChild(t);
      const row1 = document.createElement('div'); row1.className='tt-row';
      row1.innerHTML = '<div class="tt-name">'+(opts.xLabel||'x')+'</div><div class="tt-val"></div>';
      row1.querySelector('.tt-val').textContent = opts.xFormat ? opts.xFormat(p.x) : p.x;
      const row2 = document.createElement('div'); row2.className='tt-row';
      row2.innerHTML = '<div class="tt-name">'+(opts.yLabel||'y')+'</div><div class="tt-val"></div>';
      row2.querySelector('.tt-val').textContent = opts.yFormat ? opts.yFormat(p.y) : p.y;
      tooltip.appendChild(row1); tooltip.appendChild(row2);
      tooltip.style.opacity = '1';
      const contRect = container.getBoundingClientRect();
      const svgRect = svg.getBoundingClientRect();
      tooltip.style.left = (cx/W*svgRect.width + (svgRect.left-contRect.left) + 14) + 'px';
      tooltip.style.top = (cy/H*svgRect.height + (svgRect.top-contRect.top) - 10) + 'px';
    });
    hit.addEventListener('pointerleave', () => { dot.setAttribute('r',4); tooltip.style.opacity='0'; });
    if (opts.onPointClick) hit.addEventListener('click', () => opts.onPointClick(p));
    svg.appendChild(dot); svg.appendChild(hit);
  });

  container.appendChild(svg);
}

/* ---------- Snapshot tab ---------- */
function renderSnapshot() {
  const panel = document.getElementById('panel-snapshot');
  panel.innerHTML = '';
  const combos = visibleCombos();

  const kpiCard = document.createElement('div');
  kpiCard.className = 'card';
  kpiCard.innerHTML = '<div class="card-head"><div><p class="card-title">Latest near-month bid by railroad &amp; service</p>' +
    '<p class="card-caption">Most recent reported bid for the nearest-month contract, vs. the prior report for the same combination.</p></div></div>';
  const kpiRow = document.createElement('div');
  kpiRow.className = 'kpi-row';
  kpiCard.appendChild(kpiRow);

  combos.forEach(combo => {
    const rows = comboRows(combo, true);
    if (rows.length === 0) return;
    const last = rows[rows.length - 1];
    const prev = rows.length > 1 ? rows[rows.length - 2] : null;
    const delta = prev ? last.bid - prev.bid : 0;
    const tile = document.createElement('div');
    tile.className = 'stat-tile';
    const deltaClass = delta > 0 ? 'up' : (delta < 0 ? 'down' : 'flat');
    tile.innerHTML =
      '<div class="st-label"><span class="dot" style="background:var(' + combo.color + ')"></span>' + combo.label + '</div>' +
      '<div class="st-value">' + fmtMoney(last.bid) + '</div>' +
      '<div class="st-delta ' + deltaClass + '">' + (prev ? (fmtDelta(delta) + ' vs prior report') : 'no prior report') + '</div>' +
      '<div class="st-spark" id="spark-' + combo.key.replace('|','-') + '"></div>' +
      '<div class="st-date">as of ' + last.date + '</div>';
    kpiRow.appendChild(tile);
    setTimeout(() => {
      const el = tile.querySelector('.st-spark');
      const pts = rows.slice(-12).map((r, i) => ({ x: i, y: r.bid }));
      drawSparkline(el, pts, cssVar(combo.color));
    }, 0);
  });
  panel.appendChild(kpiCard);

  // forward curve
  const curveCard = document.createElement('div');
  curveCard.className = 'card';
  curveCard.innerHTML = '<div class="card-head"><div><p class="card-title">Current forward curve</p>' +
    '<p class="card-caption">Bid by contract month horizon, from each combination\'s most recent report date &mdash; the secondary market\'s current term structure.</p></div></div>';
  const curveChart = document.createElement('div');
  curveChart.className = 'chart-wrap';
  curveCard.appendChild(curveChart);
  const legendDiv = document.createElement('div'); legendDiv.className = 'legend';
  curveCard.appendChild(legendDiv);
  panel.appendChild(curveCard);

  const series = combos.map(combo => {
    const rows = ROWS.filter(r => r.company === combo.company && r.type === combo.type);
    if (rows.length === 0) return null;
    const latestDate = rows.reduce((a, r) => r.date > a ? r.date : a, rows[0].date);
    const pts = rows.filter(r => r.date === latestDate).sort((a, b) => a.horizon - b.horizon)
      .map(r => ({ x: r.horizon, y: r.bid, raw: r.bid }));
    return { key: combo.key, label: combo.label + ' (' + latestDate + ')', color: cssVar(combo.color), points: pts, directLabel: false };
  }).filter(Boolean);

  drawLineChart(curveChart, series, {
    height: 260,
    yFormat: fmtMoney,
    xTicks: (min, max) => {
      const t = [];
      for (let h = Math.ceil(min); h <= Math.floor(max); h++) t.push({ x: h, label: h + ' mo' });
      return t;
    },
    tooltipTitle: (x) => x + ' month' + (x === 1 ? '' : 's') + ' out',
  });
  series.forEach(s => {
    const item = document.createElement('div'); item.className = 'legend-item';
    item.innerHTML = '<span class="key" style="background:' + s.color + '"></span>' + s.label;
    legendDiv.appendChild(item);
  });

  if (combos.length === 0) {
    panel.innerHTML = '<div class="empty-state">Select at least one railroad and service type above.</div>';
  }
}

/* ---------- Full history tab ---------- */
function renderHistory() {
  const panel = document.getElementById('panel-history');
  panel.innerHTML = '';
  const combos = visibleCombos();
  if (combos.length === 0) { panel.innerHTML = '<div class="empty-state">Select at least one railroad and service type above.</div>'; return; }

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<div class="card-head"><div><p class="card-title">Near-month bid, full history (1997&ndash;2026)</p>' +
    '<p class="card-caption">Weekly reported bid for the nearest-month secondary market contract. Click a railroad/service below to isolate it, or a year to hide it.</p></div>' +
    '<button class="table-toggle-btn" id="history-table-btn">Table view</button></div>';
  const chartDiv = document.createElement('div'); chartDiv.className = 'chart-wrap';
  card.appendChild(chartDiv);
  const legendDiv = document.createElement('div'); legendDiv.className = 'legend';
  card.appendChild(legendDiv);
  const yearLegendWrap = document.createElement('div');
  yearLegendWrap.style.cssText = 'display:flex; align-items:flex-start; gap:6px; margin-top:8px;';
  const yearLegendLabel = document.createElement('span'); yearLegendLabel.className = 'fg-label'; yearLegendLabel.style.marginTop = '3px'; yearLegendLabel.textContent = 'Years';
  yearLegendWrap.appendChild(yearLegendLabel);
  const yearLegendDiv = document.createElement('div'); yearLegendDiv.className = 'legend'; yearLegendDiv.style.marginTop = '0';
  yearLegendWrap.appendChild(yearLegendDiv);
  card.appendChild(yearLegendWrap);
  const tableDiv = document.createElement('div'); tableDiv.style.display = 'none'; tableDiv.style.marginTop = '12px';
  card.appendChild(tableDiv);
  panel.appendChild(card);

  state.isolatedOff = state.isolatedOff || new Set();
  state.historyHiddenYears = state.historyHiddenYears || new Set();

  const comboSeries = combos.map(combo => {
    const rows = comboRows(combo, true);
    return { key: combo.key, label: combo.label, color: cssVar(combo.color), _rows: rows, directLabel: false };
  });

  // Splits one combo's rows into contiguous runs, breaking wherever a hidden year falls,
  // so hiding a year leaves a real gap in the line instead of bridging over it.
  function splitByHiddenYears(rows) {
    const runs = []; let current = [];
    rows.forEach(r => {
      if (state.historyHiddenYears.has(Number(r.date.slice(0, 4)))) {
        if (current.length) { runs.push(current); current = []; }
        return;
      }
      current.push(r);
    });
    if (current.length) runs.push(current);
    return runs;
  }

  function draw() {
    const active = comboSeries.filter(s => !state.isolatedOff.has(s.key));
    const chartSeries = [];
    active.forEach(s => {
      const runs = splitByHiddenYears(s._rows);
      runs.forEach((run, i) => {
        chartSeries.push({ key: s.key + '-run' + i, label: s.label, color: s.color, points: run.map(r => ({ x: r.t, y: r.bid, raw: r.bid })), directLabel: false });
      });
    });
    drawLineChart(chartDiv, chartSeries, {
      height: 320,
      yFormat: fmtMoney,
      xTicks: (min, max) => {
        const startY = new Date(min).getUTCFullYear();
        const endY = new Date(max).getUTCFullYear();
        const step = Math.max(1, Math.round((endY - startY) / 8));
        const ticks = [];
        for (let y = Math.ceil(startY / step) * step; y <= endY; y += step) {
          ticks.push({ x: Date.UTC(y, 0, 1), label: String(y) });
        }
        return ticks;
      },
      tooltipTitle: (x) => new Date(x).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }),
    });
  }
  draw();

  legendDiv.innerHTML = '';
  comboSeries.forEach(s => {
    const item = document.createElement('div');
    item.className = 'legend-item' + (state.isolatedOff.has(s.key) ? ' isolated-off' : '');
    item.innerHTML = '<span class="key" style="background:' + s.color + '"></span>' + s.label;
    item.addEventListener('click', () => {
      if (state.isolatedOff.has(s.key)) state.isolatedOff.delete(s.key); else state.isolatedOff.add(s.key);
      renderHistory();
    });
    legendDiv.appendChild(item);
  });

  const allYears = [...new Set(comboSeries.flatMap(s => s._rows.map(r => Number(r.date.slice(0, 4)))))].sort((a, b) => a - b);
  yearLegendDiv.innerHTML = '';
  allYears.forEach(y => {
    const item = document.createElement('div');
    item.className = 'legend-item' + (state.historyHiddenYears.has(y) ? ' isolated-off' : '');
    item.innerHTML = '<span class="key" style="background:' + cssVar('--text-muted') + '"></span>' + y;
    item.addEventListener('click', () => {
      if (state.historyHiddenYears.has(y)) state.historyHiddenYears.delete(y); else state.historyHiddenYears.add(y);
      renderHistory();
    });
    yearLegendDiv.appendChild(item);
  });

  const tableBtn = document.getElementById('history-table-btn');
  let tableShown = false;
  tableBtn.addEventListener('click', () => {
    tableShown = !tableShown;
    tableBtn.classList.toggle('active', tableShown);
    tableDiv.style.display = tableShown ? '' : 'none';
    if (tableShown && tableDiv.innerHTML === '') {
      // wide pivot: date x combo, excluding hidden years
      const dateMap = new Map();
      comboSeries.forEach(s => s._rows.forEach(r => {
        if (state.historyHiddenYears.has(Number(r.date.slice(0, 4)))) return;
        if (!dateMap.has(r.date)) dateMap.set(r.date, {});
        dateMap.get(r.date)[s.key] = r.bid;
      }));
      const dates = [...dateMap.keys()].sort().reverse();
      let html = '<div class="table-scroll"><table class="data-table"><thead><tr><th>Date</th>';
      comboSeries.forEach(s => html += '<th>' + s.label + '</th>');
      html += '</tr></thead><tbody>';
      dates.forEach(d => {
        html += '<tr><td>' + d + '</td>';
        comboSeries.forEach(s => {
          const v = dateMap.get(d)[s.key];
          html += '<td>' + (v === undefined ? '&mdash;' : fmtMoney(v)) + '</td>';
        });
        html += '</tr>';
      });
      html += '</tbody></table></div>';
      tableDiv.innerHTML = html;
    }
  });
}

/* ---------- Seasonal comparison tab ---------- */
function renderSeasonal() {
  const panel = document.getElementById('panel-seasonal');
  panel.innerHTML = '';
  const combos = visibleCombos();
  if (combos.length === 0) { panel.innerHTML = '<div class="empty-state">Select at least one railroad and service type above.</div>'; return; }

  if (!state.seasonalFocus || !combos.find(c => c.key === state.seasonalFocus)) state.seasonalFocus = defaultComboKey(combos);

  const card = document.createElement('div');
  card.className = 'card';
  const head = document.createElement('div'); head.className = 'card-head';
  head.innerHTML = '<div><p class="card-title">Current year vs. prior years, by week</p>' +
    '<p class="card-caption">Each gray line is one historical year; the current year is highlighted (solid = actual near-month bid). The dashed continuation is the most recently quoted forward bid for months the market has already priced but haven\'t arrived yet — real market pricing, not a statistical forecast. Click a year in the legend below to hide/show it.</p></div>';
  const selRow = document.createElement('div'); selRow.className = 'select-row';
  selRow.innerHTML = 'Series <select id="seasonal-select"></select>';
  head.appendChild(selRow);
  card.appendChild(head);
  const chartDiv = document.createElement('div'); chartDiv.className = 'chart-wrap';
  card.appendChild(chartDiv);
  const legendDiv = document.createElement('div'); legendDiv.className = 'legend';
  card.appendChild(legendDiv);
  panel.appendChild(card);

  const sel = selRow.querySelector('#seasonal-select');
  combos.forEach(c => {
    const opt = document.createElement('option'); opt.value = c.key; opt.textContent = c.label;
    if (c.key === state.seasonalFocus) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => { state.seasonalFocus = sel.value; renderSeasonal(); });

  const combo = combos.find(c => c.key === state.seasonalFocus);
  const rows = comboRows(combo, true);
  const byYear = new Map();
  rows.forEach(r => {
    const y = Number(r.date.slice(0, 4));
    const wk = dayOfYearWeek(r.date);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push({ x: wk, y: r.bid, raw: r.bid, date: r.date });
  });
  const years = [...byYear.keys()].sort();
  const currentYear = years[years.length - 1];
  const accent = cssVar(combo.color);
  state.seasonalHiddenYears = state.seasonalHiddenYears || new Set();

  // forward-curve extension for the current year: most recent quote per remaining month,
  // placed at the week-of-year of that month's 15th (a representative mid-month position)
  const { projected, lastActualMonth } = getYearProjection(combo, currentYear);
  const weekOfMonth15 = m => dayOfYearWeek(currentYear + '-' + String(m).padStart(2,'0') + '-15');
  const currentYearPts = byYear.get(currentYear).sort((a,b) => a.x - b.x);
  const lastActualPt = currentYearPts.length ? currentYearPts[currentYearPts.length-1] : null;
  const projRuns = projected.length
    ? projectedRuns(projected, lastActualMonth, lastActualPt ? { x: lastActualPt.x, y: lastActualPt.y, raw: lastActualPt.y } : null, weekOfMonth15)
    : [];

  const visibleYears = years.filter(y => !state.seasonalHiddenYears.has(y));
  const series = visibleYears.map(y => {
    const pts = byYear.get(y).sort((a, b) => a.x - b.x);
    const isCurrent = y === currentYear;
    return { key: 'y' + y, label: String(y), color: isCurrent ? accent : '', muted: !isCurrent, points: pts, directLabel: isCurrent && projRuns.length === 0, width: isCurrent ? 2.5 : 1.5 };
  });
  if (!state.seasonalHiddenYears.has(currentYear)) {
    projRuns.forEach((pts, i) => {
      series.push({ key: 'proj-' + i, label: String(currentYear), color: accent, points: pts, directLabel: i === projRuns.length - 1, width: 2.5, dashed: true });
    });
  }

  drawLineChart(chartDiv, series, {
    height: 320,
    yFormat: fmtMoney,
    xTicks: (min, max) => {
      const monthStarts = [1,5,9,14,18,23,27,31,36,40,44,48];
      const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return monthStarts.map((w, i) => ({ x: w, label: names[i] }));
    },
    tooltipTitle: (x) => 'Week ' + x,
  });

  legendDiv.innerHTML = '';
  years.forEach(y => {
    const isCurrent = y === currentYear;
    const isHidden = state.seasonalHiddenYears.has(y);
    const color = isCurrent ? accent : cssVar('--text-muted');
    const item = document.createElement('div');
    item.className = 'legend-item' + (isHidden ? ' isolated-off' : '');
    item.innerHTML = '<span class="key" style="background:' + color + '"></span>' + y + (isCurrent ? ' (current)' : '');
    item.addEventListener('click', () => {
      if (state.seasonalHiddenYears.has(y)) state.seasonalHiddenYears.delete(y); else state.seasonalHiddenYears.add(y);
      renderSeasonal();
    });
    legendDiv.appendChild(item);
  });

  const cap = document.createElement('p'); cap.className = 'card-caption'; cap.style.marginTop = '10px';
  let capText = combo.label + ' data available from ' + years[0] + ' onward (' + visibleYears.length + ' of ' + years.length + ' years shown).';
  if (projected.length && !state.seasonalHiddenYears.has(currentYear)) {
    const latestAsOf = [...new Set(projected.map(p=>p.asOf))].sort().slice(-1)[0];
    capText += ' Forward-quoted months as of report dates through ' + latestAsOf + '; months beyond the market\'s current quoting horizon are left blank.';
  }
  cap.textContent = capText;
  card.appendChild(cap);
}

/* ---------- Trailing average tab ---------- */
function renderTrailing() {
  const panel = document.getElementById('panel-trailing');
  panel.innerHTML = '';
  const combos = visibleCombos();
  if (combos.length === 0) { panel.innerHTML = '<div class="empty-state">Select at least one railroad and service type above.</div>'; return; }

  if (!state.trailingFocus || !combos.find(c => c.key === state.trailingFocus)) state.trailingFocus = defaultComboKey(combos);

  const combo = combos.find(c => c.key === state.trailingFocus);
  const rows = comboRows(combo, true);
  const WINDOW = 52;
  const rolling = rows.map((r, i) => {
    const start = Math.max(0, i - WINDOW + 1);
    const slice = rows.slice(start, i + 1);
    const avg = slice.reduce((a, x) => a + x.bid, 0) / slice.length;
    return avg;
  });
  const allTimeAvg = rows.reduce((a, r) => a + r.bid, 0) / rows.length;
  const last = rows[rows.length - 1];
  const lastRolling = rolling[rolling.length - 1];
  const deltaVsRolling = last.bid - lastRolling;

  const kpiCard = document.createElement('div');
  kpiCard.className = 'card';
  const head = document.createElement('div'); head.className = 'card-head';
  head.innerHTML = '<div><p class="card-title">Current value vs. trailing average</p>' +
    '<p class="card-caption">Near-month bid compared against its own rolling and all-time average.</p></div>';
  const selRow = document.createElement('div'); selRow.className = 'select-row';
  selRow.innerHTML = 'Series <select id="trailing-select"></select>';
  head.appendChild(selRow);
  kpiCard.appendChild(head);

  const kpiRow = document.createElement('div'); kpiRow.className = 'kpi-row';
  const deltaClass = deltaVsRolling > 0 ? 'up' : (deltaVsRolling < 0 ? 'down' : 'flat');
  const deltaVsAllTime = lastRolling - allTimeAvg;
  const deltaAllTimeClass = deltaVsAllTime > 0 ? 'up' : (deltaVsAllTime < 0 ? 'down' : 'flat');
  kpiRow.innerHTML =
    '<div class="stat-tile"><div class="st-label">Latest bid</div><div class="st-value">' + fmtMoney(last.bid) + '</div><div class="st-delta ' + deltaClass + '">' + fmtDelta(deltaVsRolling) + ' vs 52-wk average</div><div class="st-date">as of ' + last.date + '</div></div>' +
    '<div class="stat-tile"><div class="st-label">52-week trailing average</div><div class="st-value">' + fmtMoney(lastRolling) + '</div><div class="st-delta ' + deltaAllTimeClass + '">' + fmtDelta(deltaVsAllTime) + ' vs all-time average</div></div>' +
    '<div class="stat-tile"><div class="st-label">All-time average</div><div class="st-value">' + fmtMoney(allTimeAvg) + '</div><div class="st-date">since ' + rows[0].date + '</div></div>';
  kpiCard.appendChild(kpiRow);
  panel.appendChild(kpiCard);

  const chartCard = document.createElement('div'); chartCard.className = 'card';
  chartCard.innerHTML = '<div class="card-head"><div><p class="card-title">Weekly bid with 52-week rolling average</p></div></div>';
  const chartDiv = document.createElement('div'); chartDiv.className = 'chart-wrap';
  chartCard.appendChild(chartDiv);
  const legendDiv = document.createElement('div'); legendDiv.className = 'legend';
  chartCard.appendChild(legendDiv);
  panel.appendChild(chartCard);

  const sel = selRow.querySelector('#trailing-select');
  combos.forEach(c => {
    const opt = document.createElement('option'); opt.value = c.key; opt.textContent = c.label;
    if (c.key === state.trailingFocus) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => { state.trailingFocus = sel.value; renderTrailing(); });

  const accent = cssVar(combo.color);
  const series = [
    { key: 'raw', label: 'Weekly bid', color: '', muted: true, points: rows.map(r => ({ x: r.t, y: r.bid, raw: r.bid })), directLabel: false },
    { key: 'roll', label: '52-week average', color: accent, points: rows.map((r, i) => ({ x: r.t, y: rolling[i], raw: rolling[i] })), width: 2.5, directLabel: false },
  ];
  drawLineChart(chartDiv, series, {
    height: 300,
    yFormat: fmtMoney,
    xTicks: (min, max) => {
      const startY = new Date(min).getUTCFullYear();
      const endY = new Date(max).getUTCFullYear();
      const step = Math.max(1, Math.round((endY - startY) / 8));
      const ticks = [];
      for (let y = Math.ceil(startY / step) * step; y <= endY; y += step) ticks.push({ x: Date.UTC(y, 0, 1), label: String(y) });
      return ticks;
    },
    tooltipTitle: (x) => new Date(x).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }),
  });
  legendDiv.innerHTML =
    '<div class="legend-item"><span class="key" style="background:' + cssVar('--text-muted') + '"></span>Weekly bid</div>' +
    '<div class="legend-item"><span class="key" style="background:' + accent + '"></span>52-week average</div>';
}

/* ============================== THEME TOGGLE ============================== */
const themeBtn = document.getElementById('theme-toggle');
let isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
function applyTheme() {
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  themeBtn.textContent = isDark ? 'Light mode' : 'Dark mode';
}
themeBtn.addEventListener('click', () => { isDark = !isDark; applyTheme(); renderActiveTab(); });
applyTheme();

/* ============================== REFRESH / DOWNLOAD WIRING ============================== */
document.getElementById('refresh-data-btn').addEventListener('click', refreshFromApi);

document.getElementById('download-bids-btn').addEventListener('click', () => {
  const sorted = [...ROWS].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const companies = [...new Set(sorted.map(r => r.company))];
  const types = [...new Set(sorted.map(r => r.type))];
  downloadJson('secondary_railcar_bids.json', {
    companies, types,
    date: sorted.map(r => r.date),
    c: sorted.map(r => companies.indexOf(r.company)),
    t: sorted.map(r => types.indexOf(r.type)),
    near: sorted.map(r => r.near),
    horizon: sorted.map(r => r.horizon),
    bid: sorted.map(r => r.bid),
  });
});

document.getElementById('download-pnw-btn').addEventListener('click', () => {
  const sorted = [...PNW_MONTHLY].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  downloadJson('pnw_bulk_export_monthly.json', { month: sorted.map(m => m.month), mt: sorted.map(m => m.mt) });
});

/* ============================== INIT ============================== */
loadData().then(() => {
  renderFilterUI();
  renderActiveTab();
  console.log('LOADED_OK', ROWS.length, COMBOS.length);
}).catch(err => {
  console.error('Failed to load dashboard data:', err);
  document.getElementById('meta-line').textContent = 'Failed to load data — see console. If you opened this file directly (file://), serve it over HTTP instead (e.g. `python3 -m http.server`).';
});
