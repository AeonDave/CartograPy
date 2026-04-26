// ==============================================================
// Overlays — multi-select panel with tile layers + UI hooks (weather)
// + RainViewer + OWM-key-gated layers.
// ==============================================================
import { map } from './core.js';
import { state, selectedOverlays, activeOverlays } from './state.js';
import { t } from './i18n.js';
import { fetchWeather, fetchRainviewerData, $weatherCard } from './weather.js';
// Static import — config.js also imports from here (cycle), but ESM resolves
// it lazily because `scheduleSaveConfig` is only called inside event handlers.
import { scheduleSaveConfig } from './config.js';

const $overlayList = document.getElementById('overlayList');
const $overlayMsg = document.getElementById('overlayMsg');

function _owmKey() {
  const el = document.getElementById('owmApiKey');
  return el ? (el.value || '').trim() : '';
}

function _setOverlayMsg(msg) {
  if (!$overlayMsg) return;
  $overlayMsg.textContent = msg || '';
  $overlayMsg.style.display = msg ? '' : 'none';
}

function _makeOwmLayer(owmLayer) {
  const k = _owmKey();
  if (!k) return null;
  const url = `https://tile.openweathermap.org/map/${owmLayer}/{z}/{x}/{y}.png?appid=${k}`;
  const layer = L.tileLayer(url, {
    attribution: '© OpenWeatherMap',
    opacity: 0.7,
    maxZoom: 19,
    zIndex: 410,
  });
  layer.on('tileerror', () => {
    _setOverlayMsg(t('weather.overlayKeyError'));
  });
  return layer;
}

// ---------- Static overlay defs (ordered) ----------
//   * PRE: rendered before tile overlays (top of the list)
//   * POST: rendered after tile overlays (bottom of the list)
const STATIC_OVERLAYS_PRE = [
  {
    id: 'weather', labelKey: 'overlay.weather', kind: 'ui',
    show: () => {
      const c = map.getCenter();
      state.weatherLat = c.lat;
      state.weatherLon = c.lng;
      state.selectedHour = null;
      fetchWeather(c.lat, c.lng);
    },
    hide: () => { $weatherCard.classList.remove('visible'); },
  },
];

const STATIC_OVERLAYS_POST = [
  {
    id: 'rainviewer', labelKey: 'overlay.rainviewer',
    factoryAsync: async () => {
      const data = await fetchRainviewerData();
      if (!data || !data.radar || !data.radar.past || !data.radar.past.length) return null;
      const last = data.radar.past[data.radar.past.length - 1];
      const url = `${data.host}${last.path}/256/{z}/{x}/{y}/2/1_1.png`;
      return L.tileLayer(url, {
        attribution: '© RainViewer',
        opacity: 0.7,
        maxZoom: 19,
        zIndex: 410,
      });
    },
  },
  { id: 'owm_precipitation', labelKey: 'overlay.owmPrec',
    requires: 'owm', owmLayer: 'precipitation_new' },
  { id: 'owm_clouds', labelKey: 'overlay.owmClouds',
    requires: 'owm', owmLayer: 'clouds_new' },
  { id: 'owm_temp', labelKey: 'overlay.owmTemp',
    requires: 'owm', owmLayer: 'temp_new' },
  { id: 'owm_wind', labelKey: 'overlay.owmWind',
    requires: 'owm', owmLayer: 'wind_new' },
  { id: 'owm_pressure', labelKey: 'overlay.owmPressure',
    requires: 'owm', owmLayer: 'pressure_new' },
];

// Live registry. main.js fills the middle slice with tile overlays from
// /api/constants by reassigning `overlays.defs` in place.
export const overlays = {
  defs: [...STATIC_OVERLAYS_PRE, ...STATIC_OVERLAYS_POST],
};

export function setOverlayDefs(tileDefs) {
  overlays.defs = [...STATIC_OVERLAYS_PRE, ...tileDefs, ...STATIC_OVERLAYS_POST];
}

// ---------- Build a tile-overlay def from a /api/constants entry ----------
export function buildTileOverlayDef(o) {
  return {
    id: o.overlay_id || o.name,
    labelKey: o.label_key || null,
    label: o.display_name || o.name,
    factory: () => L.tileLayer(o.url, {
      attribution: o.attribution,
      maxZoom: o.max_zoom || 19,
      opacity: o.opacity != null ? o.opacity : 0.9,
      zIndex: o.z_index != null ? o.z_index : 410,
    }),
  };
}

// ---------- Add / remove ----------
async function _addOverlay(id) {
  if (activeOverlays.has(id)) return;
  const def = overlays.defs.find(d => d.id === id);
  if (!def) return;
  if (def.kind === 'ui') {
    if (def.show) def.show();
    activeOverlays.set(id, { kind: 'ui', def });
    return;
  }
  if (def.requires === 'owm') {
    const layer = _makeOwmLayer(def.owmLayer);
    if (!layer) {
      selectedOverlays.delete(id);
      populateOverlayPanel();
      return;
    }
    layer.addTo(map);
    activeOverlays.set(id, layer);
    return;
  }
  let layer = null;
  if (def.factoryAsync) layer = await def.factoryAsync();
  else if (def.factory) layer = def.factory();
  if (!layer) {
    selectedOverlays.delete(id);
    populateOverlayPanel();
    return;
  }
  layer.addTo(map);
  activeOverlays.set(id, layer);
}

function _removeOverlay(id) {
  const entry = activeOverlays.get(id);
  if (!entry) return;
  if (entry && entry.kind === 'ui') {
    if (entry.def && entry.def.hide) entry.def.hide();
  } else if (entry) {
    try { map.removeLayer(entry); } catch (e) {}
  }
  activeOverlays.delete(id);
}

export async function applyOverlays() {
  // Remove deselected overlays.
  for (const id of Array.from(activeOverlays.keys())) {
    if (!selectedOverlays.has(id)) _removeOverlay(id);
  }
  // Add newly selected overlays.
  const owmAvailable = !!_owmKey();
  for (const id of selectedOverlays) {
    if (activeOverlays.has(id)) continue;
    const def = overlays.defs.find(d => d.id === id);
    if (!def) continue;
    if (def.requires === 'owm' && !owmAvailable) continue;
    await _addOverlay(id);
  }
  if (owmAvailable) _setOverlayMsg('');
}

// ---------- Render the overlay checkbox panel ----------
export function populateOverlayPanel() {
  if (!$overlayList) return;
  $overlayList.innerHTML = '';
  const owmAvailable = !!_owmKey();
  let anyDisabled = false;

  overlays.defs.forEach(def => {
    const row = document.createElement('label');
    row.className = 'overlay-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.id = def.id;
    cb.checked = selectedOverlays.has(def.id);

    const disabled = (def.requires === 'owm' && !owmAvailable);
    if (disabled) {
      cb.disabled = true;
      row.classList.add('disabled');
      anyDisabled = true;
      // If the user previously selected this and the key has been removed,
      // drop it from the active selection.
      if (selectedOverlays.has(def.id)) {
        selectedOverlays.delete(def.id);
        cb.checked = false;
      }
    }

    const span = document.createElement('span');
    if (def.labelKey) {
      span.dataset.i18n = def.labelKey;
      span.textContent = t(def.labelKey);
    } else {
      span.textContent = def.label || def.id;
    }

    cb.addEventListener('change', async () => {
      _setOverlayMsg('');
      if (cb.checked) selectedOverlays.add(def.id);
      else selectedOverlays.delete(def.id);
      await applyOverlays();
      scheduleSaveConfig();
    });

    row.appendChild(cb);
    row.appendChild(span);
    $overlayList.appendChild(row);
  });

  if (!anyDisabled) _setOverlayMsg('');
}
