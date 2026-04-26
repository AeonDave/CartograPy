// ==============================================================
// Print rectangle + Grid overlay
// ==============================================================
import { map, $scale, $paper, $sheets, $landscape, $gridType, $fullLabels, status } from './core.js';
import { state, sheetDividers, PAPERS } from './state.js';
import { t } from './i18n.js';

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

export function getPrintAreaMetres() {
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

export function updateOverlays() { drawPrintRect(); scheduleGridUpdate(); }

export function drawPrintRect() {
  if (state.printRect) { map.removeLayer(state.printRect); state.printRect = null; }
  sheetDividers.forEach(l => map.removeLayer(l));
  sheetDividers.length = 0;
  const center = map.getCenter();
  const { wM, hM, cols, rows, stepW, stepH } = getPrintAreaMetres();
  const dLat = (hM / 2) / 111320;
  const dLon = (wM / 2) / (111320 * Math.cos(center.lat * Math.PI / 180));
  const south = center.lat - dLat, north = center.lat + dLat;
  const west = center.lng - dLon, east = center.lng + dLon;
  state.printRect = L.rectangle(
    [[south, west],[north, east]],
    { color: '#e11d48', weight: 3, fill: false, dashArray: '10 6', interactive: false }
  ).addTo(map);
  const cosLat = Math.cos(center.lat * Math.PI / 180);
  for (let c = 1; c < cols; c++) {
    const lon = west + (stepW * c) / (111320 * cosLat);
    sheetDividers.push(L.polyline([[south, lon],[north, lon]],
      { color: '#e11d48', weight: 1.5, dashArray: '6 4', interactive: false }).addTo(map));
  }
  for (let r = 1; r < rows; r++) {
    const lat = north - (stepH * r) / 111320;
    sheetDividers.push(L.polyline([[lat, west],[lat, east]],
      { color: '#e11d48', weight: 1.5, dashArray: '6 4', interactive: false }).addTo(map));
  }
}

export function scheduleGridUpdate() {
  drawPrintRect();
  if (state.gridTimeout) clearTimeout(state.gridTimeout);
  state.gridTimeout = setTimeout(fetchGrid, 400);
}

async function fetchGrid() {
  if (state.gridLayer) { map.removeLayer(state.gridLayer); state.gridLayer = null; }
  const gridType = $gridType.value;
  if (gridType === 'none') return;
  const c = map.getCenter();
  const scale = parseInt($scale.value) || 25000;
  const paper = $paper.value;
  const landscape = $landscape.checked ? '1' : '0';
  try {
    const sheets = parseInt($sheets.value) || 1;
    const url = `/api/grid?lat=${c.lat}&lon=${c.lng}&scale=${scale}&paper=${paper}`
      + `&landscape=${landscape}&grid_type=${gridType}`
      + `&full_labels=${$fullLabels.checked ? '1' : '0'}&sheets=${sheets}`;
    const res = await fetch(url);
    const geojson = await res.json();
    if (geojson.error) return;
    state.gridLayer = L.geoJSON(geojson, {
      style: { color: '#1e40af', weight: 1.5, opacity: 0.6 },
      onEachFeature: (feature, layer) => {
        if (feature.properties.label) {
          layer.bindTooltip(feature.properties.label, {
            permanent: true,
            direction: feature.properties.direction === 'v' ? 'top' : 'left',
            className: 'grid-label', offset: [0, 0],
          });
        }
      },
    }).addTo(map);
    const sysName = geojson.system || gridType;
    const info = `${sysName.toUpperCase()} `
      + `${geojson.zone ? '— '+geojson.zone+' ' : ''}`
      + `${geojson.epsg ? '— EPSG:'+geojson.epsg+' ' : ''}`
      + `${geojson.spacing ? '— '+t('msg.gridStep')+' '+geojson.spacing+'m' : ''}`;
    status(info);
  } catch(e) {}
}
