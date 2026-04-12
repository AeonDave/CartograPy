// ==============================================================
// i18n — Internationalisation
// ==============================================================
let _lang = {};
let _currentLang = 'en';

function t(key, ...args) {
  let s = _lang[key] || key;
  args.forEach((a, i) => { s = s.replace(`{${i}}`, a); });
  return s;
}

async function loadLanguage(code) {
  try {
    const res = await fetch(`/lang/${encodeURIComponent(code)}.json`);
    if (!res.ok) return;
    _lang = await res.json();
    _currentLang = code;
    applyTranslations();
  } catch(e) { console.error('Failed to load language:', code, e); }
}

function applyTranslations() {
  document.title = t('title');
  document.documentElement.lang = _currentLang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    if (el.tagName === 'OPTION') el.textContent = t(el.dataset.i18n);
    else el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  document.querySelectorAll('[data-i18n-label]').forEach(el => {
    el.label = t(el.dataset.i18nLabel);
  });
  renderWaypointList();
}

// ==============================================================
// Constants & State
// ==============================================================
const PAPERS = { A4:[210,297], A3:[297,420], A2:[420,594], A1:[594,841], Letter:[216,279], Legal:[216,356] };
const TOOL_COLORS = { ruler: '#dc2626', protractor: '#7c3aed', line: '#0891b2', compass: '#ea580c' };
let printRect = null;
let gridLayer = null;
let gridTimeout = null;

// Tool state
let activeTool = null;  // null | 'ruler' | 'protractor' | 'line' | 'compass' | 'waypoint'

// Search
let searchResults = [];
let searchHistory = [];  // {name, lat, lon}
let suggestTimeout = null;

// Ruler
let rulerPoints = [];
let rulerMarkers = [];
let rulerLine = null;
let rulerMoveHandler = null;
let rulerTempLine = null;
let rulerLabel = null;
let rulerLiveDist = null;
const rulerHistory = []; // {layers:[], text:''}

// Protractor (goniometro)
let protPoints = [];
let protMarkers = [];
let protLines = [];
let protArc = null;
let protLabel = null;
let protArm1Label = null;
let protArm2Label = null;
let protMoveHandler = null;
let protTempLine = null;
const protHistory = [];

// Line tool (squadra)
let linePoints = [];
let lineMarkers = [];
let lineSegments = [];
let lineSegLabels = [];
let lineMoveHandler = null;
let lineTempLine = null;
let lineLiveDist = null;
const lineHistory = [];

// Compass (compasso)
let compassCenter = null;
let compassCenterMarker = null;
let compassCircle = null;
let compassRadiusLine = null;
let compassMoveHandler = null;
let compassFixed = false;
let compassRadiusLabel = null;
let compassCircumfLabel = null;
let compassAreaLabel = null;
const compassHistory = [];

// Waypoints
const waypoints = [];
let wpMarkerLayer = L.layerGroup();
let selectedWpId = null;

// Available icons
const WP_ICONS = [
  { fa: 'fa-location-dot',   labelKey: 'wpIcon.pin' },
  { fa: 'fa-flag',           labelKey: 'wpIcon.flag' },
  { fa: 'fa-campground',     labelKey: 'wpIcon.camp' },
  { fa: 'fa-mountain',       labelKey: 'wpIcon.mountain' },
  { fa: 'fa-house',          labelKey: 'wpIcon.house' },
  { fa: 'fa-tree',           labelKey: 'wpIcon.tree' },
  { fa: 'fa-car',            labelKey: 'wpIcon.car' },
  { fa: 'fa-person-hiking',  labelKey: 'wpIcon.hike' },
  { fa: 'fa-star',           labelKey: 'wpIcon.star' },
  { fa: 'fa-circle-exclamation', labelKey: 'wpIcon.warning' },
  { fa: 'fa-camera',         labelKey: 'wpIcon.photo' },
  { fa: 'fa-utensils',       labelKey: 'wpIcon.restaurant' },
  { fa: 'fa-water',          labelKey: 'wpIcon.water' },
  { fa: 'fa-binoculars',     labelKey: 'wpIcon.viewpoint' },
  { fa: 'fa-cross',          labelKey: 'wpIcon.cross' },
];
const WP_COLORS = ['#dc2626','#ea580c','#d97706','#16a34a','#0891b2','#2563eb','#7c3aed','#db2777','#1e293b'];
let selectedIcon = WP_ICONS[0].fa;
let selectedColor = WP_COLORS[0];

// ==============================================================
// Map init
// ==============================================================
const tileLayers = {
  OpenTopoMap: L.tileLayer('https://tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17, attribution: '© OpenTopoMap (CC-BY-SA)' }),
  OpenStreetMap: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap contributors' }),
  CyclOSM: L.tileLayer('https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© CyclOSM — © OSM' }),
  'OSM DE': L.tileLayer('https://tile.openstreetmap.de/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: '© OpenStreetMap.de' }),
  'OSM France': L.tileLayer('https://a.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
    maxZoom: 20, attribution: '© OSM France' }),
  'OSM HOT': L.tileLayer('https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© Humanitarian OSM Team' }),
  'Esri WorldStreetMap': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: '© Esri' }),
  'Esri WorldTopoMap': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: '© Esri' }),
  'Esri WorldImagery': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: '© Esri' }),
  'CartoDB Positron': L.tileLayer('https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
    maxZoom: 20, attribution: '© OSM © CARTO' }),
  'CartoDB Voyager': L.tileLayer('https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', {
    maxZoom: 20, attribution: '© OSM © CARTO' }),
  'CartoDB Dark': L.tileLayer('https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
    maxZoom: 20, attribution: '© OSM © CARTO' }),
  TopPlusOpen: L.tileLayer('https://sgx.geodatenzentrum.de/wmts_topplus_open/tile/1.0.0/web/default/WEBMERCATOR/{z}/{y}/{x}.png', {
    maxZoom: 18, attribution: '© dl-de/by-2-0' }),
  'BaseMap DE': L.tileLayer('https://sgx.geodatenzentrum.de/wmts_basemapde/tile/1.0.0/de_basemapde_web_raster_farbe/default/GLOBAL_WEBMERCATOR/{z}/{y}/{x}.png', {
    maxZoom: 18, attribution: '© dl-de/by-2-0' }),
  GeoportailFrance: L.tileLayer('https://data.geopf.fr/wmts?REQUEST=GetTile&SERVICE=WMTS&VERSION=1.0.0&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/png&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}', {
    maxZoom: 18, attribution: '© Geoportail France' }),
  'GeoportailFrance Ortho': L.tileLayer('https://data.geopf.fr/wmts?REQUEST=GetTile&SERVICE=WMTS&VERSION=1.0.0&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/jpeg&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}', {
    maxZoom: 19, attribution: '© Geoportail France' }),
  Swisstopo: L.tileLayer('https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg', {
    maxZoom: 18, attribution: '© swisstopo' }),
  'Swisstopo Satellite': L.tileLayer('https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg', {
    maxZoom: 19, attribution: '© swisstopo' }),
  BasemapAT: L.tileLayer('https://mapsneu.wien.gv.at/basemap/geolandbasemap/normal/google3857/{z}/{y}/{x}.png', {
    maxZoom: 20, attribution: '© basemap.at' }),
  'BasemapAT Ortho': L.tileLayer('https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg', {
    maxZoom: 20, attribution: '© basemap.at' }),
  'NL Kadaster': L.tileLayer('https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© Kadaster' }),
  'USGS Topo': L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 20, attribution: '© USGS' }),
  'USGS Imagery': L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 20, attribution: '© USGS' }),
  OPNVKarte: L.tileLayer('https://tileserver.memomaps.de/tilegen/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: '© memomaps.de (CC-BY-SA)' }),
};

const map = L.map('map', { zoomControl: false, attributionControl: true })
              .setView([44.49, 11.34], 13);
tileLayers.OpenTopoMap.addTo(map);
wpMarkerLayer.addTo(map);

map.on('moveend', scheduleGridUpdate);
map.on('zoomend', scheduleGridUpdate);

// ==============================================================
// DOM refs
// ==============================================================
const $search      = document.getElementById('search');
const $scale       = document.getElementById('scale');
const $paper       = document.getElementById('paper');
const $sheets      = document.getElementById('sheets');
const $landscape   = document.getElementById('landscape');
const $source      = document.getElementById('source');
const $gridType    = document.getElementById('gridType');
const $gridScale   = document.getElementById('gridScale');
const $fullLabels  = document.getElementById('fullLabels');
const $dpi         = document.getElementById('dpi');
const $mapTextScale= document.getElementById('mapTextScale');
const $status      = document.getElementById('status');
const $results     = document.getElementById('results');
const $resList     = document.getElementById('resultsList');
const $btnExport   = document.getElementById('btnExport');
const $btnRuler      = document.getElementById('btnRuler');
const $btnProtractor = document.getElementById('btnProtractor');
const $btnLine       = document.getElementById('btnLine');
const $btnCompass    = document.getElementById('btnCompass');
const $btnWpAddOnMap = document.getElementById('btnWpAddOnMap');

// ==============================================================
// Sidebar toggle
// ==============================================================
document.getElementById('toggleSidebar').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('collapsed');
  document.body.classList.toggle('sidebar-hidden');
  setTimeout(() => map.invalidateSize(), 300);
});

// ==============================================================
// Events
// ==============================================================
document.getElementById('btnSearch').addEventListener('click', doSearch);
$search.addEventListener('keydown', e => {
  if (e.key === 'Enter') { hideSuggestions(); doSearch(); }
  if (e.key === 'Escape') hideSuggestions();
});
$search.addEventListener('input', () => {
  if (suggestTimeout) clearTimeout(suggestTimeout);
  const q = $search.value.trim();
  if (q.length < 3) { hideSuggestions(); return; }
  suggestTimeout = setTimeout(() => fetchSuggestions(q), 350);
});
$scale.addEventListener('change', updateOverlays);
$paper.addEventListener('change', updateOverlays);
$sheets.addEventListener('input', updateOverlays);
$landscape.addEventListener('change', updateOverlays);
$gridType.addEventListener('change', () => {
  const show = $gridType.value !== 'none';
  document.getElementById('gridScaleGroup').style.display = show ? 'flex' : 'none';
  document.getElementById('fullLabelsGroup').style.display = show ? 'flex' : 'none';
  document.getElementById('wpDatumLabel').textContent =
    document.getElementById('gridType').selectedOptions[0].textContent;
  updateOverlays();
});
$fullLabels.addEventListener('change', updateOverlays);
$source.addEventListener('change', () => {
  Object.values(tileLayers).forEach(l => map.removeLayer(l));
  tileLayers[$source.value].addTo(map);
});
$resList.addEventListener('change', () => {
  const r = searchResults[$resList.selectedIndex];
  if (r) goToPlace(r.name, r.lat, r.lon);
});
$btnExport.addEventListener('click', exportPDF);

// ==============================================================
// Search
// ==============================================================
async function doSearch() {
  const q = $search.value.trim();
  if (!q) return;
  hideSuggestions();
  status(t('status.searching'));
  try {
    const res = await fetch('/api/search?q=' + encodeURIComponent(q));
    searchResults = await res.json();
    if (searchResults.error) throw new Error(searchResults.error);
    if (!searchResults.length) { status(t('status.noResults')); $results.style.display='none'; return; }
    $resList.innerHTML = searchResults.map(r =>
      `<option>${r.name.substring(0,120)}</option>`).join('');
    $results.style.display = 'block';
    $resList.selectedIndex = 0;
    const r = searchResults[0];
    goToPlace(r.name, r.lat, r.lon);
  } catch(e) { status(t('msg.error') + e.message); }
}

function goToPlace(name, lat, lon) {
  map.setView([lat, lon], 14);
  updateOverlays();
  status(`${lat.toFixed(5)}°N  ${Math.abs(lon).toFixed(5)}°${lon>=0?'E':'W'}`);
  // Add to history (avoid duplicates)
  const short = name.substring(0, 80);
  if (!searchHistory.some(h => h.name === short && Math.abs(h.lat - lat) < 0.0001))
    searchHistory.unshift({ name: short, lat, lon });
  if (searchHistory.length > 30) searchHistory.pop();
  renderHistory();
}

async function fetchSuggestions(q) {
  try {
    const res = await fetch('/api/search?q=' + encodeURIComponent(q));
    const data = await res.json();
    if (data.error || !data.length) { hideSuggestions(); return; }
    const box = document.getElementById('searchSuggestions');
    box.innerHTML = data.slice(0, 8).map((r, i) =>
      `<div class="sg-item" data-idx="${i}">${r.name.substring(0, 100)}</div>`
    ).join('');
    box.style.display = 'block';
    // Store for click
    box._data = data.slice(0, 8);
    box.querySelectorAll('.sg-item').forEach(el => {
      el.addEventListener('click', () => {
        const d = box._data[parseInt(el.dataset.idx)];
        $search.value = d.name.substring(0, 80);
        hideSuggestions();
        goToPlace(d.name, d.lat, d.lon);
      });
    });
  } catch(e) { hideSuggestions(); }
}

function hideSuggestions() {
  document.getElementById('searchSuggestions').style.display = 'none';
}

function renderHistory() {
  const sec = document.getElementById('historySection');
  const list = document.getElementById('histList');
  if (!searchHistory.length) { sec.style.display = 'none'; return; }
  sec.style.display = '';
  list.innerHTML = searchHistory.map((h, i) =>
    `<div class="hist-item">
       <i class="fa-solid fa-location-dot" style="color:#64748b; font-size:12px;"></i>
       <span class="hist-name" data-idx="${i}">${h.name}</span>
       <span class="hist-del" data-idx="${i}"><i class="fa-solid fa-xmark"></i></span>
     </div>`
  ).join('');
  list.querySelectorAll('.hist-name').forEach(el => {
    el.addEventListener('click', () => {
      const h = searchHistory[parseInt(el.dataset.idx)];
      map.setView([h.lat, h.lon], 14);
      updateOverlays();
      status(`${h.lat.toFixed(5)}°N  ${Math.abs(h.lon).toFixed(5)}°${h.lon>=0?'E':'W'}`);
    });
  });
  list.querySelectorAll('.hist-del').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      searchHistory.splice(parseInt(el.dataset.idx), 1);
      renderHistory();
    });
  });
}

// ==============================================================
// Print rectangle + Grid
// ==============================================================
let sheetDividers = [];

function computeSheetLayout(n, landscape) {
  if (n <= 1) return { cols: 1, rows: 1 };
  let cols, rows;
  if (landscape) {
    cols = Math.ceil(Math.sqrt(n));
    rows = Math.ceil(n / cols);
  } else {
    rows = Math.ceil(Math.sqrt(n));
    cols = Math.ceil(n / rows);
  }
  return { cols, rows };
}

function getPrintAreaMetres() {
  const scale = parseInt($scale.value) || 25000;
  const pKey = $paper.value;
  let [pw, ph] = PAPERS[pKey] || [210, 297];
  if ($landscape.checked) [pw, ph] = [ph, pw];
  const margins = 10;
  const sheetW = (pw - 2*margins) * scale / 1000;
  const sheetH = (ph - 2*margins - 20) * scale / 1000;
  const n = Math.max(1, parseInt($sheets.value) || 1);
  const { cols, rows } = computeSheetLayout(n, $landscape.checked);
  const overlap_mm = 10;
  const stepW = (pw - 2*margins - overlap_mm) * scale / 1000;
  const stepH = (ph - 2*margins - 20 - overlap_mm) * scale / 1000;
  const wM = sheetW + (cols - 1) * stepW;
  const hM = sheetH + (rows - 1) * stepH;
  return { wM, hM, scale, cols, rows, sheetW, sheetH, stepW, stepH };
}
function updateOverlays() { drawPrintRect(); scheduleGridUpdate(); }

function drawPrintRect() {
  if (printRect) { map.removeLayer(printRect); printRect = null; }
  sheetDividers.forEach(l => map.removeLayer(l));
  sheetDividers = [];
  const center = map.getCenter();
  const { wM, hM, cols, rows, stepW, stepH } = getPrintAreaMetres();
  const dLat = (hM / 2) / 111320;
  const dLon = (wM / 2) / (111320 * Math.cos(center.lat * Math.PI / 180));
  const south = center.lat - dLat, north = center.lat + dLat;
  const west = center.lng - dLon, east = center.lng + dLon;
  printRect = L.rectangle(
    [[south, west],[north, east]],
    { color: '#e11d48', weight: 3, fill: false, dashArray: '10 6', interactive: false }
  ).addTo(map);
  const cosLat = Math.cos(center.lat * Math.PI / 180);
  // vertical dividers
  for (let c = 1; c < cols; c++) {
    const lon = west + (stepW * c) / (111320 * cosLat);
    const line = L.polyline([[south, lon],[north, lon]],
      { color: '#e11d48', weight: 1.5, dashArray: '6 4', interactive: false }).addTo(map);
    sheetDividers.push(line);
  }
  // horizontal dividers
  for (let r = 1; r < rows; r++) {
    const lat = north - (stepH * r) / 111320;
    const line = L.polyline([[lat, west],[lat, east]],
      { color: '#e11d48', weight: 1.5, dashArray: '6 4', interactive: false }).addTo(map);
    sheetDividers.push(line);
  }
}

function scheduleGridUpdate() {
  drawPrintRect();
  if (gridTimeout) clearTimeout(gridTimeout);
  gridTimeout = setTimeout(fetchGrid, 400);
}

async function fetchGrid() {
  if (gridLayer) { map.removeLayer(gridLayer); gridLayer = null; }
  const gridType = $gridType.value;
  if (gridType === 'none') return;
  const c = map.getCenter();
  const scale = parseInt($scale.value) || 25000;
  const paper = $paper.value;
  const landscape = $landscape.checked ? '1' : '0';
  try {
    const sheets = parseInt($sheets.value) || 1;
    const url = `/api/grid?lat=${c.lat}&lon=${c.lng}&scale=${scale}&paper=${paper}&landscape=${landscape}&grid_type=${gridType}&full_labels=${$fullLabels.checked ? '1' : '0'}&sheets=${sheets}`;
    const res = await fetch(url);
    const geojson = await res.json();
    if (geojson.error) return;
    gridLayer = L.geoJSON(geojson, {
      style: { color: '#1e40af', weight: 1.5, opacity: 0.6 },
      onEachFeature: (feature, layer) => {
        if (feature.properties.label) {
          layer.bindTooltip(feature.properties.label, {
            permanent: true, direction: feature.properties.direction === 'v' ? 'top' : 'left',
            className: 'grid-label', offset: [0, 0] });
        }
      }
    }).addTo(map);
    const sysName = geojson.system || gridType;
    const info = `${sysName.toUpperCase()} ${geojson.zone ? '— '+geojson.zone+' ' : ''}${geojson.epsg ? '— EPSG:'+geojson.epsg+' ' : ''}${geojson.spacing ? '— '+t('msg.gridStep')+' '+geojson.spacing+'m' : ''}`;
    status(info);
  } catch(e) {}
}

// ==============================================================
// TOOL: Ruler
// ==============================================================
$btnRuler.addEventListener('click', () => toggleTool('ruler'));

function activateRuler() {
  document.getElementById('rulerInfo').style.display = 'block';
  document.getElementById('rulerResult').textContent = '';
  map.getContainer().classList.add('ruler-cursor');
  map.on('click', rulerClick);
}

function deactivateRuler() {
  document.getElementById('rulerInfo').style.display = 'none';
  map.getContainer().classList.remove('ruler-cursor');
  map.off('click', rulerClick);
  resetRulerDraw();
}

function rulerClick(e) {
  if (rulerPoints.length >= 2) resetRulerDraw();
  const pt = snapToWaypoint(e.latlng);
  rulerPoints.push(pt);
  const color = TOOL_COLORS.ruler;
  const m = L.circleMarker(pt, { radius: 5, color, fillColor: color, fillOpacity: 1 }).addTo(map);
  rulerMarkers.push(m);

  if (rulerPoints.length === 1) {
    rulerTempLine = L.polyline([pt, pt], { color, weight: 2, dashArray: '6 4' }).addTo(map);
    rulerMoveHandler = (ev) => {
      const sp = snapToWaypoint(ev.latlng);
      rulerTempLine.setLatLngs([rulerPoints[0], sp]);
      const d = rulerPoints[0].distanceTo(sp);
      // Live distance label at midpoint
      if (rulerLiveDist) map.removeLayer(rulerLiveDist);
      const mLat = (rulerPoints[0].lat + sp.lat) / 2;
      const mLng = (rulerPoints[0].lng + sp.lng) / 2;
      rulerLiveDist = L.marker([mLat, mLng], { interactive: false, icon: L.divIcon({ className: 'ruler-label', html: `<span style="background:rgba(255,255,255,0.85);color:#dc2626;font-weight:bold;font-size:12px;padding:1px 5px;border-radius:3px;white-space:nowrap;pointer-events:none">${formatDist(d)}</span>`, iconAnchor: [0, 12] }) }).addTo(map);
      status(`${t('msg.distance')}: ${formatDist(d)} — ${t('msg.clickEndPoint')}`);
    };
    map.on('mousemove', rulerMoveHandler);
  }

  if (rulerPoints.length === 2) {
    if (rulerTempLine) { map.removeLayer(rulerTempLine); rulerTempLine = null; }
    if (rulerMoveHandler) { map.off('mousemove', rulerMoveHandler); rulerMoveHandler = null; }
    if (rulerLiveDist) { map.removeLayer(rulerLiveDist); rulerLiveDist = null; }
    rulerLine = L.polyline(rulerPoints, { color, weight: 2.5 }).addTo(map);
    const dist = rulerPoints[0].distanceTo(rulerPoints[1]);
    const txt = formatDist(dist);
    // Distance label at midpoint
    const midLat = (rulerPoints[0].lat + rulerPoints[1].lat) / 2;
    const midLng = (rulerPoints[0].lng + rulerPoints[1].lng) / 2;
    rulerLabel = L.marker([midLat, midLng], { interactive: false, icon: L.divIcon({ className: 'ruler-label', html: `<span style="background:rgba(255,255,255,0.9);color:#dc2626;font-weight:bold;font-size:12px;padding:2px 6px;border-radius:3px;white-space:nowrap;pointer-events:none">${txt}</span>`, iconAnchor: [0, 12] }) }).addTo(map);
    document.getElementById('rulerResult').textContent = txt;
    status(`${t('msg.measuredDistance')}: ${txt}`);
    // Save to history
    rulerHistory.push({ layers: [...rulerMarkers, rulerLine, rulerLabel], text: txt,
      data: { type: 'ruler', points: rulerPoints.map(p => [p.lat, p.lng]) } });
    rulerMarkers = []; rulerLine = null; rulerLabel = null; rulerPoints = [];
    renderToolHistory('ruler', rulerHistory, TOOL_COLORS.ruler);
  }
}

function resetRulerDraw() {
  rulerMarkers.forEach(m => map.removeLayer(m));
  rulerMarkers = []; rulerPoints = [];
  if (rulerLine) { map.removeLayer(rulerLine); rulerLine = null; }
  if (rulerTempLine) { map.removeLayer(rulerTempLine); rulerTempLine = null; }
  if (rulerMoveHandler) { map.off('mousemove', rulerMoveHandler); rulerMoveHandler = null; }
  if (rulerLabel) { map.removeLayer(rulerLabel); rulerLabel = null; }
  if (rulerLiveDist) { map.removeLayer(rulerLiveDist); rulerLiveDist = null; }
  document.getElementById('rulerResult').textContent = '';
}

function formatDist(m) {
  if (m >= 1000) return (m/1000).toFixed(2) + ' km';
  return m.toFixed(1) + ' m';
}

function formatArea(m2) {
  if (m2 >= 1e6) return (m2/1e6).toFixed(3) + ' km²';
  if (m2 >= 1e4) return (m2/1e4).toFixed(2) + ' ha';
  return m2.toFixed(1) + ' m²';
}

function bearing(a, b) {
  const dLon = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// Snap to nearest waypoint if within pixel threshold
const SNAP_PX = 15;
function snapToWaypoint(latlng) {
  if (!document.getElementById('chkSnapWp').checked || waypoints.length === 0) return latlng;
  const pt = map.latLngToContainerPoint(latlng);
  let best = null, bestDist = Infinity;
  waypoints.forEach(wp => {
    const wp_pt = map.latLngToContainerPoint(L.latLng(wp.lat, wp.lng));
    const d = pt.distanceTo(wp_pt);
    if (d < bestDist) { bestDist = d; best = wp; }
  });
  if (best && bestDist <= SNAP_PX) return L.latLng(best.lat, best.lng);
  return latlng;
}

// Shared: render history list for any tool
function renderToolHistory(toolName, histArr, color) {
  const container = document.getElementById(toolName + 'History');
  container.innerHTML = '';
  histArr.forEach((entry, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:3px 6px;margin-bottom:2px;border-radius:4px;font-size:12px;font-weight:600;background:#f1f5f9;color:' + color;
    const txt = document.createElement('span');
    txt.textContent = `#${i + 1}  ${entry.text}`;
    txt.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;cursor:pointer';
    txt.title = t('msg.clickToCenter');
    txt.addEventListener('click', () => {
      // Zoom to the drawing's bounds
      const fg = L.featureGroup(entry.layers);
      try { map.fitBounds(fg.getBounds().pad(0.2)); } catch(e) {}
    });
    const del = document.createElement('span');
    del.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    del.title = t('msg.delete');
    del.style.cssText = 'cursor:pointer;margin-left:6px;color:#94a3b8;padding:0 3px';
    del.addEventListener('mouseenter', () => del.style.color = '#dc2626');
    del.addEventListener('mouseleave', () => del.style.color = '#94a3b8');
    del.addEventListener('click', () => {
      entry.layers.forEach(l => { try { map.removeLayer(l); } catch(e) {} });
      histArr.splice(i, 1);
      renderToolHistory(toolName, histArr, color);
    });
    row.appendChild(txt);
    row.appendChild(del);
    container.appendChild(row);
  });
  // Show/hide separator between tool info and history
  const sep = document.getElementById('toolHistorySep');
  const hasAny = rulerHistory.length || protHistory.length || lineHistory.length || compassHistory.length;
  sep.style.display = hasAny ? '' : 'none';
  // Keep line undo button in sync
  updateLineUndoBtn();
}

function renderAllToolHistories() {
  renderToolHistory('ruler', rulerHistory, TOOL_COLORS.ruler);
  renderToolHistory('protractor', protHistory, TOOL_COLORS.protractor);
  renderToolHistory('line', lineHistory, TOOL_COLORS.line);
  renderToolHistory('compass', compassHistory, TOOL_COLORS.compass);
}

// Restore a single tool entry from serialized data and add to the appropriate history
function restoreToolEntry(d) {
  const color = TOOL_COLORS[d.type];
  if (!color) return;
  const layers = [];
  if (d.type === 'ruler') {
    const pts = d.points.map(p => L.latLng(p[0], p[1]));
    pts.forEach(p => layers.push(L.circleMarker(p, { radius: 4, color, fillColor: color, fillOpacity: 1 }).addTo(map)));
    layers.push(L.polyline(pts, { color, weight: 2.5 }).addTo(map));
    const dist = pts[0].distanceTo(pts[1]);
    const txt = formatDist(dist);
    const midLat = (pts[0].lat + pts[1].lat) / 2, midLng = (pts[0].lng + pts[1].lng) / 2;
    layers.push(L.marker([midLat, midLng], { interactive: false, icon: L.divIcon({ className: 'ruler-label', html: `<span style="background:rgba(255,255,255,0.9);color:${color};font-weight:bold;font-size:12px;padding:2px 6px;border-radius:3px;white-space:nowrap;pointer-events:none">${txt}</span>`, iconAnchor: [0, 12] }) }).addTo(map));
    rulerHistory.push({ layers, text: txt, data: d });
  } else if (d.type === 'protractor') {
    const pts = d.points.map(p => L.latLng(p[0], p[1]));
    pts.forEach(p => layers.push(L.circleMarker(p, { radius: 4, color, fillColor: color, fillOpacity: 1 }).addTo(map)));
    layers.push(L.polyline([pts[0], pts[1]], { color, weight: 2 }).addTo(map));
    layers.push(L.polyline([pts[1], pts[2]], { color, weight: 2 }).addTo(map));
    const angle = computeAngle(pts[0], pts[1], pts[2]);
    const arc = drawAngleArc(pts[1], pts[0], pts[2], angle, color);
    if (arc) layers.push(arc);
    const txt = `${angle.toFixed(1)}°`;
    layers.push(L.marker([pts[1].lat, pts[1].lng], { interactive: false, icon: L.divIcon({ className: 'prot-label', html: `<span style="background:rgba(255,255,255,0.9);color:${color};font-weight:bold;font-size:12px;padding:2px 6px;border-radius:3px;white-space:nowrap;pointer-events:none">${txt}</span>`, iconAnchor: [-8, 12] }) }).addTo(map));
    const d1 = pts[1].distanceTo(pts[0]), d2 = pts[1].distanceTo(pts[2]);
    protHistory.push({ layers, text: `${txt} (${formatDist(d1)} / ${formatDist(d2)})`, data: d });
  } else if (d.type === 'line') {
    const pts = d.points.map(p => L.latLng(p[0], p[1]));
    const segLayers = [], segLabels = [];
    pts.forEach(p => layers.push(L.circleMarker(p, { radius: 4, color, fillColor: color, fillOpacity: 1 }).addTo(map)));
    for (let i = 1; i < pts.length; i++) {
      segLayers.push(L.polyline([pts[i - 1], pts[i]], { color, weight: 2.5 }).addTo(map));
      const sd = pts[i - 1].distanceTo(pts[i]);
      const ml = (pts[i - 1].lat + pts[i].lat) / 2, mg = (pts[i - 1].lng + pts[i].lng) / 2;
      segLabels.push(L.marker([ml, mg], { interactive: false, icon: L.divIcon({ className: 'line-label', html: `<span style="background:rgba(255,255,255,0.9);color:${color};font-weight:bold;font-size:11px;padding:1px 5px;border-radius:3px;white-space:nowrap;pointer-events:none">${formatDist(sd)}</span>`, iconAnchor: [0, 12] }) }).addTo(map));
    }
    layers.push(...segLayers, ...segLabels);
    let total = 0; for (let i = 1; i < pts.length; i++) total += pts[i - 1].distanceTo(pts[i]);
    const txt = `${pts.length} pt — ${formatDist(total)}`;
    lineHistory.push({ layers, text: txt, data: d });
  } else if (d.type === 'compass') {
    const center = L.latLng(d.center[0], d.center[1]);
    const edge = L.latLng(d.edge[0], d.edge[1]);
    const r = center.distanceTo(edge);
    layers.push(L.circleMarker(center, { radius: 5, color, fillColor: color, fillOpacity: 1 }).addTo(map));
    layers.push(L.circle(center, { radius: r, color, weight: 2.5, fill: true, fillColor: color, fillOpacity: 0.08 }).addTo(map));
    layers.push(L.polyline([center, edge], { color, weight: 2 }).addTo(map));
    layers.push(L.circleMarker(edge, { radius: 4, color, fillColor: color, fillOpacity: 1 }).addTo(map));
    const midLat = (center.lat + edge.lat) / 2, midLng = (center.lng + edge.lng) / 2;
    layers.push(L.marker([midLat, midLng], { interactive: false, icon: L.divIcon({ className: 'compass-label', html: `<span style="background:rgba(255,255,255,0.9);color:${color};font-weight:bold;font-size:12px;padding:2px 6px;border-radius:3px;white-space:nowrap;pointer-events:none">r = ${formatDist(r)}</span>`, iconAnchor: [0, 12] }) }).addTo(map));
    const area = Math.PI * r * r;
    const shortTxt = `r=${formatDist(r)} A=${formatArea(area)}`;
    compassHistory.push({ layers, text: shortTxt, data: d });
  }
}

// Collect all tool drawings as serializable array
function collectToolData() {
  const all = [];
  rulerHistory.forEach(e => { if (e.data) all.push(e.data); });
  protHistory.forEach(e => { if (e.data) all.push(e.data); });
  lineHistory.forEach(e => { if (e.data) all.push(e.data); });
  compassHistory.forEach(e => { if (e.data) all.push(e.data); });
  return all;
}

// Clear all tool histories from map and arrays
function clearAllTools() {
  [rulerHistory, protHistory, lineHistory, compassHistory].forEach(arr => {
    arr.forEach(e => e.layers.forEach(l => { try { map.removeLayer(l); } catch(x){} }));
    arr.length = 0;
  });
  renderAllToolHistories();
}

// Load tool data from array and restore on map
function loadToolData(dataArr) {
  clearAllTools();
  dataArr.forEach(d => restoreToolEntry(d));
  renderAllToolHistories();
}

// ---- Tool file save/load UI ----
document.getElementById('btnToolSave').addEventListener('click', () => {
  const fp = document.getElementById('toolFilePanel');
  const sp = document.getElementById('toolSavePanel');
  const lp = document.getElementById('toolLoadPanel');
  lp.style.display = 'none';
  sp.style.display = sp.style.display === 'none' ? '' : 'none';
  fp.style.display = sp.style.display === 'none' && lp.style.display === 'none' ? 'none' : '';
});

document.getElementById('btnToolLoad').addEventListener('click', async () => {
  const fp = document.getElementById('toolFilePanel');
  const sp = document.getElementById('toolSavePanel');
  const lp = document.getElementById('toolLoadPanel');
  sp.style.display = 'none';
  lp.style.display = lp.style.display === 'none' ? '' : 'none';
  fp.style.display = sp.style.display === 'none' && lp.style.display === 'none' ? 'none' : '';
  if (lp.style.display !== 'none') await refreshToolFileList();
});

document.getElementById('btnToolSaveConfirm').addEventListener('click', async () => {
  const name = document.getElementById('toolFileName').value.trim();
  if (!name) { alert(t('msg.enterName')); return; }
  const data = collectToolData();
  try {
    const res = await fetch('/api/tools/save', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ name, drawings: data }) });
    const j = await res.json(); if (j.error) throw new Error(j.error);
    status(t('msg.toolsSaved'));
    document.getElementById('toolSavePanel').style.display = 'none';
    document.getElementById('toolFilePanel').style.display = 'none';
  } catch(e) { alert(t('msg.saveError') + ': ' + e.message); }
});

document.getElementById('btnToolClearAll').addEventListener('click', () => {
  clearAllTools();
  status(t('msg.toolsCleared'));
});

async function refreshToolFileList() {
  const list = document.getElementById('toolFileList');
  try {
    const res = await fetch('/api/tools/list');
    const files = await res.json();
    if (!files.length) { list.innerHTML = `<div style="font-size:11px;color:#94a3b8;" data-i18n="tool.noFiles">${t('tool.noFiles')}</div>`; return; }
    list.innerHTML = '';
    files.forEach(name => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:3px 6px;margin-bottom:2px;border-radius:4px;font-size:12px;background:#f1f5f9;cursor:pointer';
      const lbl = document.createElement('span');
      lbl.textContent = name;
      lbl.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      lbl.addEventListener('click', async () => {
        try {
          const r = await fetch('/api/tools/load?name=' + encodeURIComponent(name));
          const data = await r.json(); if (data.error) throw new Error(data.error);
          loadToolData(data);
          status(t('msg.toolsLoaded', data.length, name));
          document.getElementById('toolLoadPanel').style.display = 'none';
          document.getElementById('toolFilePanel').style.display = 'none';
        } catch(e) { alert(t('msg.loadError') + ': ' + e.message); }
      });
      const del = document.createElement('span');
      del.innerHTML = '<i class="fa-solid fa-trash"></i>';
      del.style.cssText = 'cursor:pointer;margin-left:6px;color:#94a3b8;padding:0 3px;font-size:11px';
      del.addEventListener('mouseenter', () => del.style.color = '#dc2626');
      del.addEventListener('mouseleave', () => del.style.color = '#94a3b8');
      del.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!confirm(t('msg.confirmDelete', name))) return;
        await fetch('/api/tools/delete', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name }) });
        await refreshToolFileList();
      });
      row.appendChild(lbl);
      row.appendChild(del);
      list.appendChild(row);
    });
  } catch(e) { list.innerHTML = `<div style="color:#dc2626;font-size:11px">Error</div>`; }
}

// ==============================================================
// TOOL: Protractor (Goniometro)
// ==============================================================
$btnProtractor.addEventListener('click', () => toggleTool('protractor'));

function activateProtractor() {
  document.getElementById('protractorInfo').style.display = 'block';
  document.getElementById('protractorResult').textContent = '';
  map.getContainer().classList.add('ruler-cursor');
  map.on('click', protractorClick);
}

function deactivateProtractor() {
  document.getElementById('protractorInfo').style.display = 'none';
  map.getContainer().classList.remove('ruler-cursor');
  map.off('click', protractorClick);
  resetProtDraw();
}

function protractorClick(e) {
  if (protPoints.length >= 3) resetProtDraw();
  const pt = snapToWaypoint(e.latlng);
  protPoints.push(pt);
  const color = TOOL_COLORS.protractor;
  const m = L.circleMarker(pt, { radius: 5, color, fillColor: color, fillOpacity: 1 }).addTo(map);
  protMarkers.push(m);

  if (protPoints.length === 1) {
    protTempLine = L.polyline([pt, pt], { color, weight: 2, dashArray: '6 4' }).addTo(map);
    protMoveHandler = (ev) => {
      const sp = snapToWaypoint(ev.latlng);
      protTempLine.setLatLngs([protPoints[0], sp]);
      status(t('msg.protClickVertex'));
    };
    map.on('mousemove', protMoveHandler);
  }

  if (protPoints.length === 2) {
    if (protTempLine) { map.removeLayer(protTempLine); protTempLine = null; }
    if (protMoveHandler) { map.off('mousemove', protMoveHandler); protMoveHandler = null; }
    const line1 = L.polyline([protPoints[0], protPoints[1]], { color, weight: 2.5 }).addTo(map);
    protLines.push(line1);
    protTempLine = L.polyline([protPoints[1], protPoints[1]], { color, weight: 2, dashArray: '6 4' }).addTo(map);
    protMoveHandler = (ev) => {
      const sp = snapToWaypoint(ev.latlng);
      protTempLine.setLatLngs([protPoints[1], sp]);
      const angle = computeAngle(protPoints[0], protPoints[1], sp);
      // Live angle label at vertex
      if (protLabel) map.removeLayer(protLabel);
      protLabel = L.marker([protPoints[1].lat, protPoints[1].lng], { interactive: false, icon: L.divIcon({ className: 'prot-label', html: `<span style="background:rgba(255,255,255,0.85);color:#7c3aed;font-weight:bold;font-size:12px;padding:1px 5px;border-radius:3px;white-space:nowrap;pointer-events:none">${angle.toFixed(1)}°</span>`, iconAnchor: [-8, 12] }) }).addTo(map);
      status(`${t('msg.angle')}: ${angle.toFixed(1)}° — ${t('msg.clickToFix')}`);
    };
    map.on('mousemove', protMoveHandler);
  }

  if (protPoints.length === 3) {
    if (protTempLine) { map.removeLayer(protTempLine); protTempLine = null; }
    if (protMoveHandler) { map.off('mousemove', protMoveHandler); protMoveHandler = null; }
    const line2 = L.polyline([protPoints[1], protPoints[2]], { color, weight: 2.5 }).addTo(map);
    protLines.push(line2);
    const angle = computeAngle(protPoints[0], protPoints[1], protPoints[2]);
    protArc = drawAngleArc(protPoints[1], protPoints[0], protPoints[2], angle, color);
    const txt = `${angle.toFixed(1)}°`;
    document.getElementById('protractorResult').textContent = txt;
    const d1 = protPoints[1].distanceTo(protPoints[0]);
    const d2 = protPoints[1].distanceTo(protPoints[2]);
    // Angle label at vertex
    if (protLabel) map.removeLayer(protLabel);
    protLabel = L.marker([protPoints[1].lat, protPoints[1].lng], { interactive: false, icon: L.divIcon({ className: 'prot-label', html: `<span style="background:rgba(255,255,255,0.9);color:#7c3aed;font-weight:bold;font-size:12px;padding:2px 6px;border-radius:3px;white-space:nowrap;pointer-events:none">${txt}</span>`, iconAnchor: [-8, 12] }) }).addTo(map);
    // Arm 1 label at midpoint
    const mid1Lat = (protPoints[0].lat + protPoints[1].lat) / 2;
    const mid1Lng = (protPoints[0].lng + protPoints[1].lng) / 2;
    protArm1Label = L.marker([mid1Lat, mid1Lng], { interactive: false, icon: L.divIcon({ className: 'prot-label', html: `<span style="background:rgba(255,255,255,0.9);color:#7c3aed;font-weight:bold;font-size:11px;padding:1px 5px;border-radius:3px;white-space:nowrap;pointer-events:none">${formatDist(d1)}</span>`, iconAnchor: [0, 12] }) }).addTo(map);
    // Arm 2 label at midpoint
    const mid2Lat = (protPoints[1].lat + protPoints[2].lat) / 2;
    const mid2Lng = (protPoints[1].lng + protPoints[2].lng) / 2;
    protArm2Label = L.marker([mid2Lat, mid2Lng], { interactive: false, icon: L.divIcon({ className: 'prot-label', html: `<span style="background:rgba(255,255,255,0.9);color:#7c3aed;font-weight:bold;font-size:11px;padding:1px 5px;border-radius:3px;white-space:nowrap;pointer-events:none">${formatDist(d2)}</span>`, iconAnchor: [0, 12] }) }).addTo(map);
    status(`${t('msg.measuredAngle')}: ${txt}  |  ${t('msg.arm')} 1: ${formatDist(d1)}  |  ${t('msg.arm')} 2: ${formatDist(d2)}`);
    // Save to history
    const allLayers = [...protMarkers, ...protLines];
    if (protArc) allLayers.push(protArc);
    if (protLabel) allLayers.push(protLabel);
    if (protArm1Label) allLayers.push(protArm1Label);
    if (protArm2Label) allLayers.push(protArm2Label);
    protHistory.push({ layers: allLayers, text: `${txt} (${formatDist(d1)} / ${formatDist(d2)})`,
      data: { type: 'protractor', points: protPoints.map(p => [p.lat, p.lng]) } });
    protMarkers = []; protLines = []; protArc = null; protLabel = null; protArm1Label = null; protArm2Label = null; protPoints = [];
    renderToolHistory('protractor', protHistory, TOOL_COLORS.protractor);
  }
}

function computeAngle(a, vertex, b) {
  const b1 = bearing(vertex, a);
  const b2 = bearing(vertex, b);
  let angle = Math.abs(b2 - b1);
  if (angle > 180) angle = 360 - angle;
  return angle;
}

function drawAngleArc(vertex, p1, p2, angleDeg, color) {
  const r = Math.min(vertex.distanceTo(p1), vertex.distanceTo(p2), 50000) * 0.25;
  const b1 = bearing(vertex, p1);
  const b2 = bearing(vertex, p2);
  // Determine sweep direction (shortest arc)
  let start = b1, end = b2;
  let diff = (end - start + 360) % 360;
  if (diff > 180) { start = b2; diff = 360 - diff; }
  const pts = [];
  const steps = Math.max(20, Math.round(diff));
  for (let i = 0; i <= steps; i++) {
    const a = (start + diff * i / steps) * Math.PI / 180;
    const dLat = r * Math.cos(a) / 111320;
    const dLon = r * Math.sin(a) / (111320 * Math.cos(vertex.lat * Math.PI / 180));
    pts.push([vertex.lat + dLat, vertex.lng + dLon]);
  }
  return L.polyline(pts, { color, weight: 2, dashArray: '4 3' }).addTo(map);
}

function resetProtDraw() {
  protMarkers.forEach(m => map.removeLayer(m)); protMarkers = [];
  protLines.forEach(l => map.removeLayer(l)); protLines = [];
  if (protArc) { map.removeLayer(protArc); protArc = null; }
  if (protLabel) { map.removeLayer(protLabel); protLabel = null; }
  if (protArm1Label) { map.removeLayer(protArm1Label); protArm1Label = null; }
  if (protArm2Label) { map.removeLayer(protArm2Label); protArm2Label = null; }
  if (protTempLine) { map.removeLayer(protTempLine); protTempLine = null; }
  if (protMoveHandler) { map.off('mousemove', protMoveHandler); protMoveHandler = null; }
  protPoints = [];
  document.getElementById('protractorResult').textContent = '';
}

// ==============================================================
// TOOL: Line (Squadra)
// ==============================================================
$btnLine.addEventListener('click', () => toggleTool('line'));

function activateLine() {
  // If there's an in-progress drawing, finish it first
  if (linePoints.length >= 2) { lineFinish(); return; }
  document.getElementById('lineInfo').style.display = 'block';
  document.getElementById('lineResult').textContent = '';
  map.getContainer().classList.add('ruler-cursor');
  map.on('click', lineClick);
  map.on('dblclick', lineFinish);
  map.on('contextmenu', lineFinishRight);
}

function deactivateLine() {
  if (linePoints.length >= 2) lineFinish();
  document.getElementById('lineInfo').style.display = 'none';
  map.getContainer().classList.remove('ruler-cursor');
  map.off('click', lineClick);
  map.off('dblclick', lineFinish);
  map.off('contextmenu', lineFinishRight);
  resetLineDraw();
}

function lineClick(e) {
  const color = TOOL_COLORS.line;
  const pt = snapToWaypoint(e.latlng);
  linePoints.push(pt);
  const m = L.circleMarker(pt, { radius: 4, color, fillColor: color, fillOpacity: 1 }).addTo(map);
  lineMarkers.push(m);

  if (linePoints.length > 1) {
    const prev = linePoints[linePoints.length - 2];
    const seg = L.polyline([prev, pt], { color, weight: 2.5 }).addTo(map);
    lineSegments.push(seg);
    // Segment distance label at midpoint
    const segDist = prev.distanceTo(pt);
    const midLat = (prev.lat + pt.lat) / 2;
    const midLng = (prev.lng + pt.lng) / 2;
    const segLabel = L.marker([midLat, midLng], { interactive: false, icon: L.divIcon({ className: 'line-label', html: `<span style="background:rgba(255,255,255,0.9);color:#0891b2;font-weight:bold;font-size:11px;padding:1px 5px;border-radius:3px;white-space:nowrap;pointer-events:none">${formatDist(segDist)}</span>`, iconAnchor: [0, 12] }) }).addTo(map);
    lineSegLabels.push(segLabel);
    if (lineTempLine) { map.removeLayer(lineTempLine); lineTempLine = null; }
    if (lineMoveHandler) { map.off('mousemove', lineMoveHandler); lineMoveHandler = null; }
  }

  // Live preview for next segment
  lineTempLine = L.polyline([pt, pt], { color, weight: 2, dashArray: '6 4' }).addTo(map);
  lineMoveHandler = (ev) => {
    const sp = snapToWaypoint(ev.latlng);
    lineTempLine.setLatLngs([linePoints[linePoints.length - 1], sp]);
    const segDist = linePoints[linePoints.length - 1].distanceTo(sp);
    const totalDist = lineTotalDist() + segDist;
    // Live distance label
    if (lineLiveDist) map.removeLayer(lineLiveDist);
    const mLat = (linePoints[linePoints.length - 1].lat + sp.lat) / 2;
    const mLng = (linePoints[linePoints.length - 1].lng + sp.lng) / 2;
    lineLiveDist = L.marker([mLat, mLng], { interactive: false, icon: L.divIcon({ className: 'line-label', html: `<span style="background:rgba(255,255,255,0.85);color:#0891b2;font-weight:bold;font-size:11px;padding:1px 5px;border-radius:3px;white-space:nowrap;pointer-events:none">${formatDist(segDist)}</span>`, iconAnchor: [0, 12] }) }).addTo(map);
    let info = `${t('msg.segment')}: ${formatDist(segDist)} | ${t('msg.total')}: ${formatDist(totalDist)}`;
    if (linePoints.length >= 2) {
      const prev = linePoints[linePoints.length - 2];
      const cur = linePoints[linePoints.length - 1];
      const angle = computeAngle(prev, cur, sp);
      info += ` | ${t('msg.angle')}: ${angle.toFixed(1)}°`;
    }
    info += ` — ${t('msg.rightClickFinish')}`;
    status(info);
  };
  map.on('mousemove', lineMoveHandler);

  updateLineResult();
  updateLineUndoBtn();
}

function lineFinishRight(e) {
  if (e && e.originalEvent) e.originalEvent.preventDefault();
  lineFinish();
}

function lineFinish() {
  if (lineTempLine) { map.removeLayer(lineTempLine); lineTempLine = null; }
  if (lineMoveHandler) { map.off('mousemove', lineMoveHandler); lineMoveHandler = null; }
  if (lineLiveDist) { map.removeLayer(lineLiveDist); lineLiveDist = null; }
  if (linePoints.length >= 2) {
    const txt = `${linePoints.length} pt — ${formatDist(lineTotalDist())}`;
    updateLineResult();
    status(`${t('msg.trackComplete')}: ${linePoints.length} ${t('msg.points')}, ${formatDist(lineTotalDist())}`);
    lineHistory.push({ layers: [...lineMarkers, ...lineSegments, ...lineSegLabels], text: txt,
      data: { type: 'line', points: linePoints.map(p => [p.lat, p.lng]) } });
    lineMarkers = []; lineSegments = []; lineSegLabels = []; linePoints = [];
    renderToolHistory('line', lineHistory, TOOL_COLORS.line);
  }
}

function lineTotalDist() {
  let total = 0;
  for (let i = 1; i < linePoints.length; i++) total += linePoints[i - 1].distanceTo(linePoints[i]);
  return total;
}

function updateLineResult() {
  const el = document.getElementById('lineResult');
  if (linePoints.length < 2) { el.textContent = ''; return; }
  let txt = `${linePoints.length} ${t('msg.points')} — ${t('msg.total')}: ${formatDist(lineTotalDist())}`;
  // Show each segment
  const parts = [];
  for (let i = 1; i < linePoints.length; i++) {
    parts.push(formatDist(linePoints[i - 1].distanceTo(linePoints[i])));
  }
  txt += `\n${t('msg.segments')}: ${parts.join(' → ')}`;
  // Show angles at each internal vertex
  if (linePoints.length >= 3) {
    const angles = [];
    for (let i = 1; i < linePoints.length - 1; i++) {
      angles.push(computeAngle(linePoints[i - 1], linePoints[i], linePoints[i + 1]).toFixed(1) + '°');
    }
    txt += `\n${t('msg.angles')}: ${angles.join(', ')}`;
  }
  el.textContent = txt;
}

function updateLineUndoBtn() {
  document.getElementById('btnLineUndo').style.display =
    (linePoints.length || lineHistory.length) ? '' : 'none';
}

function lineUndo() {
  if (linePoints.length) {
    // Undo last point from active drawing
    linePoints.pop();
    if (lineMarkers.length) { map.removeLayer(lineMarkers.pop()); }
    if (lineSegments.length) { map.removeLayer(lineSegments.pop()); }
    if (lineSegLabels.length) { map.removeLayer(lineSegLabels.pop()); }
    // Remove stale live-preview line and handler
    if (lineTempLine) { map.removeLayer(lineTempLine); lineTempLine = null; }
    if (lineMoveHandler) { map.off('mousemove', lineMoveHandler); lineMoveHandler = null; }
    if (lineLiveDist) { map.removeLayer(lineLiveDist); lineLiveDist = null; }
    // Re-attach live preview from the new last point (if any remain)
    if (linePoints.length) {
      const color = TOOL_COLORS.line;
      const lastPt = linePoints[linePoints.length - 1];
      lineTempLine = L.polyline([lastPt, lastPt], { color, weight: 2, dashArray: '6 4' }).addTo(map);
      lineMoveHandler = (ev) => {
        lineTempLine.setLatLngs([linePoints[linePoints.length - 1], ev.latlng]);
        const segDist = linePoints[linePoints.length - 1].distanceTo(ev.latlng);
        const totalDist = lineTotalDist() + segDist;
        if (lineLiveDist) map.removeLayer(lineLiveDist);
        const mLat = (linePoints[linePoints.length - 1].lat + ev.latlng.lat) / 2;
        const mLng = (linePoints[linePoints.length - 1].lng + ev.latlng.lng) / 2;
        lineLiveDist = L.marker([mLat, mLng], { interactive: false, icon: L.divIcon({ className: 'line-label', html: `<span style="background:rgba(255,255,255,0.85);color:#0891b2;font-weight:bold;font-size:11px;padding:1px 5px;border-radius:3px;white-space:nowrap;pointer-events:none">${formatDist(segDist)}</span>`, iconAnchor: [0, 12] }) }).addTo(map);
        let info = `${t('msg.segment')}: ${formatDist(segDist)} | ${t('msg.total')}: ${formatDist(totalDist)}`;
        if (linePoints.length >= 2) {
          const prev = linePoints[linePoints.length - 2];
          const cur = linePoints[linePoints.length - 1];
          const angle = computeAngle(prev, cur, ev.latlng);
          info += ` | ${t('msg.angle')}: ${angle.toFixed(1)}°`;
        }
        info += ` — ${t('msg.rightClickFinish')}`;
        status(info);
      };
      map.on('mousemove', lineMoveHandler);
    }
    updateLineResult();
  } else if (lineHistory.length) {
    // Undo last POINT from the last completed history entry
    const last = lineHistory.pop();
    last.layers.forEach(l => { try { map.removeLayer(l); } catch(e) {} });
    const pts = last.data.points;           // [[lat,lng], ...]
    pts.pop();                              // remove last point
    if (pts.length >= 2) {
      // Rebuild entry with remaining points
      const color = TOOL_COLORS.line;
      const markers = [], segs = [], labels = [];
      for (let i = 0; i < pts.length; i++) {
        markers.push(L.circleMarker(pts[i], { radius: 4, color, fillColor: color, fillOpacity: 1 }).addTo(map));
        if (i > 0) {
          segs.push(L.polyline([pts[i - 1], pts[i]], { color, weight: 2.5 }).addTo(map));
          const d = L.latLng(pts[i - 1]).distanceTo(L.latLng(pts[i]));
          const mLat = (pts[i - 1][0] + pts[i][0]) / 2, mLng = (pts[i - 1][1] + pts[i][1]) / 2;
          labels.push(L.marker([mLat, mLng], { interactive: false, icon: L.divIcon({ className: 'line-label', html: `<span style="background:rgba(255,255,255,0.9);color:#0891b2;font-weight:bold;font-size:11px;padding:1px 5px;border-radius:3px;white-space:nowrap;pointer-events:none">${formatDist(d)}</span>`, iconAnchor: [0, 12] }) }).addTo(map));
        }
      }
      let total = 0;
      for (let i = 1; i < pts.length; i++) total += L.latLng(pts[i - 1]).distanceTo(L.latLng(pts[i]));
      const txt = `${pts.length} pt — ${formatDist(total)}`;
      lineHistory.push({ layers: [...markers, ...segs, ...labels], text: txt,
        data: { type: 'line', points: pts } });
    }
    renderToolHistory('line', lineHistory, TOOL_COLORS.line);
  }
  updateLineUndoBtn();
}

function resetLineDraw() {
  lineMarkers.forEach(m => map.removeLayer(m)); lineMarkers = [];
  lineSegments.forEach(s => map.removeLayer(s)); lineSegments = [];
  lineSegLabels.forEach(l => map.removeLayer(l)); lineSegLabels = [];
  if (lineTempLine) { map.removeLayer(lineTempLine); lineTempLine = null; }
  if (lineMoveHandler) { map.off('mousemove', lineMoveHandler); lineMoveHandler = null; }
  if (lineLiveDist) { map.removeLayer(lineLiveDist); lineLiveDist = null; }
  linePoints = [];
  document.getElementById('lineResult').textContent = '';
}

document.getElementById('btnLineUndo').addEventListener('click', lineUndo);

// ==============================================================
// TOOL: Compass (Compasso)
// ==============================================================
$btnCompass.addEventListener('click', () => toggleTool('compass'));

function activateCompass() {
  document.getElementById('compassInfo').style.display = 'block';
  document.getElementById('compassResult').textContent = '';
  compassFixed = false;
  map.getContainer().classList.add('ruler-cursor');
  map.on('click', compassClick);
}

function deactivateCompass() {
  document.getElementById('compassInfo').style.display = 'none';
  map.getContainer().classList.remove('ruler-cursor');
  map.off('click', compassClick);
  resetCompassDraw();
}

function compassClick(e) {
  const color = TOOL_COLORS.compass;

  if (!compassCenter) {
    // First click: set center
    const pt = snapToWaypoint(e.latlng);
    compassCenter = pt;
    compassCenterMarker = L.circleMarker(pt, { radius: 5, color, fillColor: color, fillOpacity: 1 }).addTo(map);
    // Live preview
    compassMoveHandler = (ev) => {
      const sp = snapToWaypoint(ev.latlng);
      const r = compassCenter.distanceTo(sp);
      if (compassCircle) map.removeLayer(compassCircle);
      if (compassRadiusLine) map.removeLayer(compassRadiusLine);
      if (compassRadiusLabel) map.removeLayer(compassRadiusLabel);
      compassCircle = L.circle(compassCenter, { radius: r, color, weight: 2, fill: true, fillColor: color, fillOpacity: 0.08 }).addTo(map);
      compassRadiusLine = L.polyline([compassCenter, sp], { color, weight: 2, dashArray: '6 4' }).addTo(map);
      // Radius label at midpoint
      const midLat = (compassCenter.lat + sp.lat) / 2;
      const midLng = (compassCenter.lng + sp.lng) / 2;
      compassRadiusLabel = L.marker([midLat, midLng], { interactive: false, icon: L.divIcon({ className: 'compass-label', html: `<span style="background:rgba(255,255,255,0.85);color:#ea580c;font-weight:bold;font-size:12px;padding:1px 5px;border-radius:3px;white-space:nowrap;pointer-events:none">r = ${formatDist(r)}</span>`, iconAnchor: [0, 12] }) }).addTo(map);
      const area = Math.PI * r * r;
      const circumf = 2 * Math.PI * r;
      status(`${t('msg.radius')}: ${formatDist(r)} | ${t('msg.diameter')}: ${formatDist(r * 2)} | ${t('msg.circumference')}: ${formatDist(circumf)} | ${t('msg.area')}: ${formatArea(area)}`);
    };
    map.on('mousemove', compassMoveHandler);
  } else {
    // Second click: fix the circle
    const pt = snapToWaypoint(e.latlng);
    if (compassMoveHandler) { map.off('mousemove', compassMoveHandler); compassMoveHandler = null; }
    const r = compassCenter.distanceTo(pt);
    if (compassCircle) map.removeLayer(compassCircle);
    if (compassRadiusLine) map.removeLayer(compassRadiusLine);
    compassCircle = L.circle(compassCenter, { radius: r, color, weight: 2.5, fill: true, fillColor: color, fillOpacity: 0.08 }).addTo(map);
    compassRadiusLine = L.polyline([compassCenter, pt], { color, weight: 2 }).addTo(map);
    // Add edge marker
    const edgeMarker = L.circleMarker(pt, { radius: 4, color, fillColor: color, fillOpacity: 1 }).addTo(map);
    const area = Math.PI * r * r;
    const circumf = 2 * Math.PI * r;
    // Radius label at midpoint
    if (compassRadiusLabel) map.removeLayer(compassRadiusLabel);
    const midLat = (compassCenter.lat + pt.lat) / 2;
    const midLng = (compassCenter.lng + pt.lng) / 2;
    compassRadiusLabel = L.marker([midLat, midLng], { interactive: false, icon: L.divIcon({ className: 'compass-label', html: `<span style="background:rgba(255,255,255,0.9);color:#ea580c;font-weight:bold;font-size:12px;padding:2px 6px;border-radius:3px;white-space:nowrap;pointer-events:none">r = ${formatDist(r)}</span>`, iconAnchor: [0, 12] }) }).addTo(map);
    // Circumference label at top of circle
    const topLat = compassCenter.lat + (r / 111320);
    compassCircumfLabel = L.marker([topLat, compassCenter.lng], { interactive: false, icon: L.divIcon({ className: 'compass-label', html: `<span style="background:rgba(255,255,255,0.9);color:#ea580c;font-weight:bold;font-size:12px;padding:2px 6px;border-radius:3px;white-space:nowrap;pointer-events:none">C = ${formatDist(circumf)}</span>`, iconAnchor: [30, 24] }) }).addTo(map);
    // Area label at center
    compassAreaLabel = L.marker([compassCenter.lat, compassCenter.lng], { interactive: false, icon: L.divIcon({ className: 'compass-label', html: `<span style="background:rgba(255,255,255,0.9);color:#ea580c;font-weight:bold;font-size:11px;padding:2px 6px;border-radius:3px;white-space:nowrap;pointer-events:none">A = ${formatArea(area)}</span>`, iconAnchor: [30, 6] }) }).addTo(map);
    const shortTxt = `r=${formatDist(r)} A=${formatArea(area)}`;
    const fullTxt = `${t('msg.radius')}: ${formatDist(r)} | ${t('msg.diameter')}: ${formatDist(r * 2)}\n${t('msg.circumference')}: ${formatDist(circumf)} | ${t('msg.area')}: ${formatArea(area)}`;
    document.getElementById('compassResult').textContent = fullTxt;
    status(`${t('msg.circleFixed')} — ${fullTxt.replace(/\n/g, ' | ')}`);
    // Save to history
    const layers = [compassCenterMarker, compassCircle, compassRadiusLine, compassRadiusLabel, compassCircumfLabel, compassAreaLabel, edgeMarker].filter(Boolean);
    compassHistory.push({ layers, text: shortTxt,
      data: { type: 'compass', center: [compassCenter.lat, compassCenter.lng], edge: [pt.lat, pt.lng] } });
    compassCenterMarker = null; compassCircle = null; compassRadiusLine = null;
    compassRadiusLabel = null; compassCircumfLabel = null; compassAreaLabel = null;
    compassCenter = null; compassFixed = false;
    renderToolHistory('compass', compassHistory, TOOL_COLORS.compass);
  }
}

function resetCompassDraw() {
  if (compassCenterMarker) { map.removeLayer(compassCenterMarker); compassCenterMarker = null; }
  if (compassCircle) { map.removeLayer(compassCircle); compassCircle = null; }
  if (compassRadiusLine) { map.removeLayer(compassRadiusLine); compassRadiusLine = null; }
  if (compassMoveHandler) { map.off('mousemove', compassMoveHandler); compassMoveHandler = null; }
  if (compassRadiusLabel) { map.removeLayer(compassRadiusLabel); compassRadiusLabel = null; }
  if (compassCircumfLabel) { map.removeLayer(compassCircumfLabel); compassCircumfLabel = null; }
  if (compassAreaLabel) { map.removeLayer(compassAreaLabel); compassAreaLabel = null; }
  compassCenter = null;
  compassFixed = false;
  document.getElementById('compassResult').textContent = '';
}

// ==============================================================
// TOOL: Waypoints
// ==============================================================
let _wpMapActive = false;
$btnWpAddOnMap.addEventListener('click', () => {
  if (_wpMapActive) deactivateWaypoint();
  else activateWaypoint();
});

function activateWaypoint() {
  _wpMapActive = true;
  $btnWpAddOnMap.classList.add('active');
  document.getElementById('waypointSection').open = true;
  map.getContainer().style.cursor = 'crosshair';
  map.on('click', waypointMapClick);
}

function deactivateWaypoint() {
  _wpMapActive = false;
  $btnWpAddOnMap.classList.remove('active');
  map.getContainer().style.cursor = '';
  map.off('click', waypointMapClick);
}

function waypointMapClick(e) {
  addWaypoint(e.latlng.lat, e.latlng.lng);
}

function addWaypoint(lat, lng) {
  const wp = { lat, lng, icon: selectedIcon, color: selectedColor, id: Date.now(), name: '' };
  waypoints.push(wp);
  selectedWpId = null;
  renderWaypointMarkers();
  renderWaypointList();
}

function removeWaypoint(id) {
  const idx = waypoints.findIndex(w => w.id === id);
  if (idx >= 0) waypoints.splice(idx, 1);
  if (selectedWpId === id) selectedWpId = null;
  renderWaypointMarkers();
  renderWaypointList();
}

function selectWaypoint(id) {
  const wp = waypoints.find(w => w.id === id);
  if (!wp) return;
  if (selectedWpId === id) { deselectWaypoint(); return; }
  selectedWpId = id;
  syncPickersToWp(wp);
  document.getElementById('waypointSection').open = true;
  renderWaypointList();
  const el = document.querySelector(`.wp-item[data-id="${id}"]`);
  if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  status(t('wp.selected'));
}

function deselectWaypoint() {
  selectedWpId = null;
  renderWaypointList();
}

function syncPickersToWp(wp) {
  selectedIcon = wp.icon;
  selectedColor = wp.color;
  document.querySelectorAll('#iconGrid .icon-opt').forEach(el => {
    const fa = el.querySelector('i').className.replace('fa-solid ', '');
    el.classList.toggle('selected', fa === wp.icon);
  });
  document.querySelectorAll('#colorGrid .color-opt').forEach(el => {
    el.classList.toggle('selected', el.style.background === wp.color || rgbToHex(el.style.background) === wp.color);
  });
}

function rgbToHex(rgb) {
  const m = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (!m) return rgb;
  return '#' + [m[1], m[2], m[3]].map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
}

function renderWaypointMarkers() {
  wpMarkerLayer.clearLayers();
  const toolActive = activeTool && activeTool !== 'waypoint';
  waypoints.forEach(wp => {
    const isSel = wp.id === selectedWpId;
    const size = isSel ? 28 : 22;
    const icon = L.divIcon({
      html: `<i class="fa-solid ${wp.icon}" style="color:${wp.color}; font-size:${size}px; text-shadow:0 1px 3px rgba(0,0,0,.4);${isSel ? ' filter:drop-shadow(0 0 4px ' + wp.color + ');' : ''}${toolActive ? ' pointer-events:none;' : ''}"></i>`,
      className: '', iconSize: [24, 24], iconAnchor: [12, 22]
    });
    const m = L.marker([wp.lat, wp.lng], { icon, interactive: !toolActive }).addTo(wpMarkerLayer);
    if (!toolActive) {
      m.on('click', () => selectWaypoint(wp.id));
    }
    if (wp.name) {
      m.bindTooltip(wp.name, {
        permanent: true, direction: 'bottom', offset: [0, 4],
        className: 'wp-label'
      });
    }
  });
}

function renderWaypointList() {
  const list = document.getElementById('wpList');
  if (!waypoints.length) { list.innerHTML = `<div style="color:#94a3b8; font-size:11px;">${t('wp.none')}</div>`; return; }
  list.innerHTML = waypoints.map(wp =>
    `<div class="wp-item${wp.id === selectedWpId ? ' selected' : ''}" data-id="${wp.id}">
       <i class="fa-solid ${wp.icon}" style="color:${wp.color}; cursor:pointer;"></i>
       <span class="wp-name" contenteditable="true" data-id="${wp.id}" title="${t('wp.rename')}">${wp.name || (wp.lat.toFixed(5) + ', ' + wp.lng.toFixed(5))}</span>
       <span class="wp-del" data-id="${wp.id}"><i class="fa-solid fa-xmark"></i></span>
     </div>`
  ).join('');
  // Select on icon click
  list.querySelectorAll('.wp-item > i').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(el.parentElement.dataset.id);
      selectWaypoint(id);
      renderWaypointMarkers();
    });
  });
  list.querySelectorAll('.wp-del').forEach(el => {
    el.addEventListener('click', () => removeWaypoint(parseInt(el.dataset.id)));
  });
  list.querySelectorAll('.wp-name').forEach(el => {
    el.addEventListener('blur', () => {
      const wp = waypoints.find(w => w.id === parseInt(el.dataset.id));
      if (!wp) return;
      const val = el.textContent.trim();
      const coords = wp.lat.toFixed(5) + ', ' + wp.lng.toFixed(5);
      wp.name = (val === coords) ? '' : val;
      renderWaypointMarkers();
      renderWaypointList();
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    });
  });
}

// Icon grid
(function buildIconGrid() {
  const grid = document.getElementById('iconGrid');
  WP_ICONS.forEach(ic => {
    const d = document.createElement('div');
    d.className = 'icon-opt' + (ic.fa === selectedIcon ? ' selected' : '');
    d.title = t(ic.labelKey);
    d.setAttribute('data-i18n-title', ic.labelKey);
    d.innerHTML = `<i class="fa-solid ${ic.fa}"></i>`;
    d.addEventListener('click', () => {
      grid.querySelectorAll('.icon-opt').forEach(x => x.classList.remove('selected'));
      d.classList.add('selected');
      selectedIcon = ic.fa;
      if (selectedWpId) {
        const wp = waypoints.find(w => w.id === selectedWpId);
        if (wp) { wp.icon = ic.fa; renderWaypointMarkers(); renderWaypointList(); }
      }
    });
    grid.appendChild(d);
  });
})();

// Color grid
(function buildColorGrid() {
  const grid = document.getElementById('colorGrid');
  WP_COLORS.forEach(c => {
    const d = document.createElement('div');
    d.className = 'color-opt' + (c === selectedColor ? ' selected' : '');
    d.style.background = c;
    d.addEventListener('click', () => {
      grid.querySelectorAll('.color-opt').forEach(x => x.classList.remove('selected'));
      d.classList.add('selected');
      selectedColor = c;
      if (selectedWpId) {
        const wp = waypoints.find(w => w.id === selectedWpId);
        if (wp) { wp.color = c; renderWaypointMarkers(); renderWaypointList(); }
      }
    });
    grid.appendChild(d);
  });
})();

// Manual coordinate entry
async function manualWpAddAsync() {
  const raw = document.getElementById('wpCoordInput').value.trim();
  if (!raw) return;
  const gridType = $gridType.value;
  let lat, lng;

  try {
    const parseType = (gridType === 'none') ? 'latlon' : gridType;
    const res = await fetch(`/api/coord2latlon?grid_type=${encodeURIComponent(parseType)}&coords=${encodeURIComponent(raw)}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    lat = data.lat;
    lng = data.lon;
    addWaypoint(lat, lng);
    document.getElementById('wpCoordInput').value = '';
    status(`${t('msg.wpAdded')}: ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
  } catch(e) {
    status(t('msg.coordError') + ': ' + e.message);
  }
}
document.getElementById('btnWpAdd').addEventListener('click', manualWpAddAsync);
document.getElementById('wpCoordInput').addEventListener('keydown', e => { if (e.key === 'Enter') manualWpAddAsync(); });

// Bulk import
document.getElementById('btnWpBulk').addEventListener('click', bulkWpImport);

async function bulkWpImport() {
  const text = document.getElementById('wpBulkInput').value.trim();
  if (!text) return;
  const lines = text.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
  const gridType = $gridType.value;
  let added = 0, errors = 0;

  for (const line of lines) {
    try {
      let lat, lng;
      const parseType = (gridType === 'none') ? 'latlon' : gridType;
      const res = await fetch(`/api/coord2latlon?grid_type=${encodeURIComponent(parseType)}&coords=${encodeURIComponent(line)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      lat = data.lat;
      lng = data.lon;
      addWaypoint(lat, lng);
      added++;
    } catch(e) { errors++; }
  }
  document.getElementById('wpBulkInput').value = '';
  const msg = t('msg.wpImported', added) + (errors ? `, ${t('msg.wpErrors', errors)}` : '');
  status(msg);
}

// Clear all waypoints
document.getElementById('btnWpClearAll').addEventListener('click', () => {
  waypoints.length = 0;
  selectedWpId = null;
  renderWaypointMarkers();
  renderWaypointList();
});

// ==============================================================
// Tool switching
// ==============================================================
function toggleTool(name) {
  if (activeTool === name) { deactivateAllTools(); return; }
  deactivateAllTools();
  activeTool = name;
  const toolMap = {
    ruler:      { btn: $btnRuler,      activate: activateRuler },
    protractor: { btn: $btnProtractor, activate: activateProtractor },
    line:       { btn: $btnLine,       activate: activateLine },
    compass:    { btn: $btnCompass,    activate: activateCompass },
  };
  const t = toolMap[name];
  if (t) { t.btn.classList.add('active'); t.activate(); }
  renderWaypointMarkers();
}

function deactivateAllTools() {
  const deactMap = {
    ruler: deactivateRuler, protractor: deactivateProtractor,
    line: deactivateLine, compass: deactivateCompass,
  };
  if (activeTool && deactMap[activeTool]) deactMap[activeTool]();
  activeTool = null;
  [$btnRuler, $btnProtractor, $btnLine, $btnCompass].forEach(b => b.classList.remove('active'));
  renderWaypointMarkers();
  // Also deactivate waypoint map-click mode if active
  if (_wpMapActive) deactivateWaypoint();
}

// ==============================================================
// Config persistence (auto-save / auto-load)
// ==============================================================
const CONFIG_FIELDS = {
  scale: {el: () => $scale, type: 'value'},
  paper: {el: () => $paper, type: 'value'},
  sheets: {el: () => $sheets, type: 'value'},
  landscape: {el: () => $landscape, type: 'checked'},
  source: {el: () => $source, type: 'value'},
  dpi: {el: () => $dpi, type: 'value'},
  mapTextScale: {el: () => $mapTextScale, type: 'value'},
  gridType: {el: () => $gridType, type: 'value'},
  gridScale: {el: () => $gridScale, type: 'value'},
  fullLabels: {el: () => $fullLabels, type: 'checked'},
  language: {el: () => document.getElementById('language'), type: 'value'},
};

function gatherConfig() {
  const c = map.getCenter();
  const cfg = { lat: c.lat, lon: c.lng, zoom: map.getZoom() };
  for (const [k, def] of Object.entries(CONFIG_FIELDS)) {
    cfg[k] = def.el()[def.type];
  }
  return cfg;
}

let _cfgTimer = null;
function scheduleSaveConfig() {
  clearTimeout(_cfgTimer);
  _cfgTimer = setTimeout(saveConfig, 800);
}

async function saveConfig() {
  try {
    await fetch('/api/config', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(gatherConfig()),
    });
  } catch(e) {}
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    if (!cfg || !cfg.scale) return;
    for (const [k, def] of Object.entries(CONFIG_FIELDS)) {
      if (cfg[k] !== undefined) def.el()[def.type] = cfg[k];
    }
    if (cfg.lat && cfg.lon) map.setView([cfg.lat, cfg.lon], cfg.zoom || 13);
    // Sync tile layer to saved source
    const src = $source.value;
    Object.values(tileLayers).forEach(tl => map.removeLayer(tl));
    if (tileLayers[src]) tileLayers[src].addTo(map);
    // Load language
    await loadLanguage(document.getElementById('language').value || 'en');
  } catch(e) {}
}

// Attach auto-save listeners
[$scale, $paper, $sheets, $source, $dpi, $mapTextScale, $gridType, $gridScale].forEach(el => {
  el.addEventListener('change', scheduleSaveConfig);
});
$sheets.addEventListener('input', scheduleSaveConfig);
[$landscape, $fullLabels].forEach(el => {
  el.addEventListener('change', scheduleSaveConfig);
});
map.on('moveend', scheduleSaveConfig);

// Language change
document.getElementById('language').addEventListener('change', async () => {
  await loadLanguage(document.getElementById('language').value);
  scheduleSaveConfig();
});

// ==============================================================
// Waypoint save / load
// ==============================================================
document.getElementById('btnWpSave').addEventListener('click', () => {
  const panel = document.getElementById('wpFilePanel');
  const sp = document.getElementById('wpSavePanel');
  const lp = document.getElementById('wpLoadPanel');
  lp.style.display = 'none';
  sp.style.display = '';
  panel.style.display = '';
  document.getElementById('wpFileName').focus();
});

document.getElementById('btnWpLoad').addEventListener('click', refreshWpFileList);

document.getElementById('btnWpSaveConfirm').addEventListener('click', async () => {
  const name = document.getElementById('wpFileName').value.trim();
  if (!name) { alert(t('msg.enterName')); return; }
  const data = waypoints.map(w => ({ lat: w.lat, lng: w.lng, icon: w.icon, color: w.color, name: w.name || '' }));
  try {
    const res = await fetch('/api/waypoints/save', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ name, waypoints: data }),
    });
    const r = await res.json();
    if (r.ok) {
      status(`${t('msg.wpSaved')}: ${name}`);
      document.getElementById('wpFilePanel').style.display = 'none';
      document.getElementById('wpFileName').value = '';
    } else { alert(r.error); }
  } catch(e) { alert(t('msg.saveError')); }
});

async function refreshWpFileList() {
  const panel = document.getElementById('wpFilePanel');
  const sp = document.getElementById('wpSavePanel');
  const lp = document.getElementById('wpLoadPanel');
  sp.style.display = 'none';
  lp.style.display = '';
  panel.style.display = '';
  const list = document.getElementById('wpFileList');
  list.innerHTML = `<div style="color:#94a3b8; font-size:11px;">${t('status.searching')}</div>`;
  try {
    const res = await fetch('/api/waypoints/list');
    const files = await res.json();
    if (!files.length) { list.innerHTML = `<div style="color:#94a3b8; font-size:11px;">${t('wp.noFiles')}</div>`; return; }
    list.innerHTML = files.map(f =>
      `<div class="wpf-item" data-name="${f}">
         <i class="fa-solid fa-map-location-dot" style="color:#2563eb;"></i>
         <span class="wpf-name">${f}</span>
         <span class="wpf-del" data-name="${f}" title="Elimina"><i class="fa-solid fa-trash"></i></span>
       </div>`
    ).join('');
    list.querySelectorAll('.wpf-item').forEach(el => {
      el.addEventListener('click', async (e) => {
        if (e.target.closest('.wpf-del')) return;
        await loadWpFile(el.dataset.name);
      });
    });
    list.querySelectorAll('.wpf-del').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(t('msg.confirmDelete', el.dataset.name))) return;
        await fetch('/api/waypoints/delete', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ name: el.dataset.name }),
        });
        refreshWpFileList();
      });
    });
  } catch(e) { list.innerHTML = `<div style="color:#dc2626; font-size:11px;">${t('msg.error')}</div>`; }
}

async function loadWpFile(name) {
  try {
    const res = await fetch(`/api/waypoints/load?name=${encodeURIComponent(name)}`);
    const data = await res.json();
    if (data.error) { alert(data.error); return; }
    waypoints.length = 0;
    selectedWpId = null;
    data.forEach(w => {
      waypoints.push({ lat: w.lat, lng: w.lng || w.lon, icon: w.icon || 'fa-location-dot', color: w.color || '#dc2626', name: w.name || '', id: Date.now() + Math.random() });
    });
    renderWaypointMarkers();
    renderWaypointList();
    // Show waypoint section
    document.getElementById('waypointSection').style.display = '';
    document.getElementById('waypointSection').open = true;
    document.getElementById('wpFilePanel').style.display = 'none';
    status(t('msg.wpLoaded', waypoints.length, name));
    // Fit map to waypoints
    if (waypoints.length) {
      const bounds = L.latLngBounds(waypoints.map(w => [w.lat, w.lng]));
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  } catch(e) { alert(t('msg.loadError')); }
}

// ==============================================================
// Export PDF
// ==============================================================
async function exportPDF() {
  const c = map.getCenter();
  const params = {
    lat: c.lat, lon: c.lng,
    scale: parseInt($scale.value) || 25000,
    paper: $paper.value,
    landscape: $landscape.checked,
    dpi: parseInt($dpi.value) || 300,
    source: $source.value,
    grid_type: $gridType.value,
    grid_full_labels: $fullLabels.checked,
    grid_scale: parseInt($gridScale.value) || 50,
    map_text_scale: parseInt($mapTextScale.value) || 50,
    sheets: parseInt($sheets.value) || 1,
    waypoints: waypoints.map(w => ({ lat: w.lat, lng: w.lng, icon: w.icon, color: w.color, name: w.name || '' })),
    drawings: document.getElementById('chkToolsInPdf').checked ? collectToolData() : [],
  };
  $btnExport.disabled = true;
  $btnExport.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${t('status.generating')}`;
  status(t('status.exporting'));
  try {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(params),
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'export failed'); }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mappa_${params.scale}_${params.paper}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    status(t('status.exported'));
  } catch(e) {
    status(t('msg.exportError') + e.message);
    alert(t('msg.error') + e.message);
  } finally {
    $btnExport.disabled = false;
    $btnExport.innerHTML = `<i class="fa-solid fa-file-pdf"></i> <span data-i18n="btn.export">${t('btn.export')}</span>`;
  }
}

// ==============================================================
// Status + Init
// ==============================================================
function status(msg) { $status.textContent = msg; }
document.addEventListener('click', e => {
  if (!e.target.closest('#search') && !e.target.closest('#searchSuggestions')) hideSuggestions();
});
renderWaypointList();
loadLanguage('en').then(() => loadConfig().then(() => setTimeout(updateOverlays, 500)));
