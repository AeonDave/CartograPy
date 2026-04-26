// ==============================================================
// Core: Leaflet map instance, DOM references, status helper
// ==============================================================
// Imported by every feature module to access the shared map and DOM
// references without going through `main.js` (avoids circular imports).

// Leaflet instance + the layer group used by all waypoint markers.
export const map = L.map('map', { zoomControl: false, attributionControl: true })
                    .setView([44.49, 11.34], 13);

export const wpMarkerLayer = L.layerGroup();
wpMarkerLayer.addTo(map);

// ----------------------------------------------------------------
// DOM references
// ----------------------------------------------------------------
const $ = (id) => document.getElementById(id);

export const $search       = $('search');
export const $scale        = $('scale');
export const $paper        = $('paper');
export const $sheets       = $('sheets');
export const $landscape    = $('landscape');
export const $source       = $('source');
export const $gridType     = $('gridType');
export const $gridScale    = $('gridScale');
export const $fullLabels   = $('fullLabels');
export const $dpi          = $('dpi');
export const $mapTextScale = $('mapTextScale');
export const $status       = $('status');
export const $results      = $('results');
export const $resList      = $('resultsList');
export const $btnExport    = $('btnExport');

export const $btnRuler      = $('btnRuler');
export const $btnProtractor = $('btnProtractor');
export const $btnLine       = $('btnLine');
export const $btnCompass    = $('btnCompass');
export const $btnWpAddOnMap = $('btnWpAddOnMap');

export const $mobileToolBar = $('mobileToolBar');
export const $mtbDone   = $('mtbDone');
export const $mtbUndo   = $('mtbUndo');
export const $mtbCancel = $('mtbCancel');

// ----------------------------------------------------------------
// Status helper + sidebar / mobile tool bar (lightweight UI bits)
// ----------------------------------------------------------------
export function status(msg) { $status.textContent = msg; }

export function closeSidebarMobile() {
  $('sidebar').classList.add('collapsed');
  document.body.classList.add('sidebar-hidden');
  setTimeout(() => map.invalidateSize(), 300);
}

export function showMobileToolBar() {
  $mobileToolBar.classList.add('visible');
}

export function hideMobileToolBar() {
  $mobileToolBar.classList.remove('visible');
}
