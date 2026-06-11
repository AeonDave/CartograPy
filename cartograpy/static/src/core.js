// ==============================================================
// Core: Leaflet map instance, DOM references, status helper
// ==============================================================
// Imported by every feature module to access the shared map and DOM
// references without going through `main.js` (avoids circular imports).

// Leaflet instance + the layer group used by all waypoint markers.
// `rotate: true` (provided by leaflet-rotate) enables shift-drag rotation
// and exposes ``map.setBearing()`` / ``map.getBearing()``. Falls back to a
// non-rotating map if the plugin is unavailable.
export const map = L.map('map', {
  zoomControl: false,
  attributionControl: true,
  rotate: true,
  rotateControl: false,           // we render our own compass control
  bearing: 0,
}).setView([44.49, 11.34], 13);

export const wpMarkerLayer = L.layerGroup();
wpMarkerLayer.addTo(map);

// ----------------------------------------------------------------
// Public hook for theme scripts (themes/<id>/theme.js).
// Loaded after app.js, a theme script may read the live map state to
// drive its own chrome (readouts, clocks, decorations). This object is
// part of the theme CONTRACT — see cartograpy/themes/CONTRACT.md.
// ----------------------------------------------------------------
window.CartograPy = {
  map,                                   // the Leaflet map instance
  version: '1.0',
  onStatus: null,                        // set to fn(msg) to mirror status line
};

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
export const $bearing      = $('bearing');
export const $status       = $('status');
export const $results      = $('results');
export const $resList      = $('resultsList');
export const $btnExport    = $('btnExport');

export const $btnRuler      = $('btnRuler');
export const $btnProtractor = $('btnProtractor');
export const $btnLine       = $('btnLine');
export const $btnCompass    = $('btnCompass');
export const $btnRoute      = $('btnRoute');
export const $btnWpAddOnMap = $('btnWpAddOnMap');

export const $mobileToolBar = $('mobileToolBar');
export const $mtbDone   = $('mtbDone');
export const $mtbUndo   = $('mtbUndo');
export const $mtbCancel = $('mtbCancel');

// ----------------------------------------------------------------
// Status helper + sidebar / mobile tool bar (lightweight UI bits)
// ----------------------------------------------------------------
export function status(msg) {
  $status.textContent = msg;
  if (typeof window.CartograPy?.onStatus === 'function') {
    try { window.CartograPy.onStatus(msg); } catch (e) {}
  }
}

// Escape user-provided text before interpolating it into innerHTML or
// Leaflet tooltips/popups (which treat strings as HTML). Waypoint and track
// names can come from imported GPX files, i.e. untrusted input.
export function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

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
