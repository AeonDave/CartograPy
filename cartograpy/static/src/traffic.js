// ==============================================================
// Live Traffic — aircraft / vessel / train marker overlays.
// ==============================================================
import { map } from './core.js';
import { t } from './i18n.js';
import { scheduleSaveConfig } from './config.js';

const $msg = document.getElementById('trafficMsg');
const $refresh = document.getElementById('trafficRefreshSec');

const TRAFFIC_CATEGORIES = [
  {
    kind: 'aircraft',
    enabled: () => document.getElementById('chkTrafficAircraft'),
    provider: () => document.getElementById('trafficAircraftProvider'),
    icon: 'fa-plane',
  },
  {
    kind: 'vessel',
    enabled: () => document.getElementById('chkTrafficVessels'),
    provider: () => document.getElementById('trafficVesselProvider'),
    icon: 'fa-ship',
  },
  {
    kind: 'train',
    enabled: () => document.getElementById('chkTrafficTrains'),
    provider: () => document.getElementById('trafficTrainProvider'),
    icon: 'fa-train',
  },
];

let _layer = null;
let _timer = null;
let _moveTimer = null;
let _running = false;
let _queued = false;
let _initialized = false;

function _setMsg(msg, kind = '') {
  if (!$msg) return;
  $msg.textContent = msg || '';
  $msg.classList.toggle('error', kind === 'error');
  $msg.style.display = msg ? '' : 'none';
}

function _refreshIntervalMs() {
  const sec = parseInt($refresh?.value || '30', 10);
  return Math.max(10, Math.min(300, Number.isFinite(sec) ? sec : 30)) * 1000;
}

function _enabledCategories() {
  return TRAFFIC_CATEGORIES.filter(cat => cat.enabled()?.checked && cat.provider()?.value);
}

function _boundsQuery(provider) {
  const b = map.getBounds();
  const params = new URLSearchParams({
    provider,
    s: b.getSouth().toFixed(6),
    w: b.getWest().toFixed(6),
    n: b.getNorth().toFixed(6),
    e: b.getEast().toFixed(6),
  });
  return `/api/live_traffic?${params.toString()}`;
}

function _restartTimer() {
  if (_timer) clearInterval(_timer);
  _timer = null;
  if (!_enabledCategories().length) return;
  _timer = setInterval(refreshTraffic, _refreshIntervalMs());
}

function _scheduleRefresh() {
  if (_moveTimer) clearTimeout(_moveTimer);
  _moveTimer = setTimeout(() => refreshTraffic(), 700);
}

async function _fetchCategory(cat) {
  const provider = cat.provider().value;
  const res = await fetch(_boundsQuery(provider));
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data.features || [];
}

function _clearLayer() {
  if (_layer) _layer.clearLayers();
}

function _render(features) {
  _clearLayer();
  for (const feature of features) {
    const lat = Number(feature.lat);
    const lon = Number(feature.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const marker = L.marker([lat, lon], { icon: _makeIcon(feature) });
    marker.bindPopup(_popupHtml(feature));
    marker.addTo(_layer);
  }
}

function _makeIcon(feature) {
  const kind = feature.kind || 'traffic';
  const cat = TRAFFIC_CATEGORIES.find(c => c.kind === kind);
  const heading = Number(feature.heading);
  const rotation = Number.isFinite(heading) ? heading : 0;
  const icon = cat?.icon || 'fa-location-dot';
  const html = `<div class="traffic-marker traffic-marker-${_escAttr(kind)}" `
    + `style="--traffic-rotation:${rotation}deg"><i class="fa-solid ${icon}"></i></div>`;
  return L.divIcon({
    className: 'traffic-marker-wrap',
    html,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  });
}

function _popupHtml(feature) {
  const label = _esc(feature.label || feature.id || 'Traffic');
  const provider = _esc(_providerLabel(feature.provider));
  const speed = feature.speed != null
    ? `${_esc(feature.speed)} ${_esc(feature.speed_unit || '')}` : '—';
  const altitude = feature.altitude != null
    ? `${_esc(feature.altitude)} ${_esc(feature.altitude_unit || '')}` : '';
  const when = feature.timestamp
    ? new Date(feature.timestamp * 1000).toLocaleString() : '—';
  const details = feature.details || {};
  const extra = _detailsRows(details);
  return `<div class="traffic-popup">`
    + `<div class="traffic-popup-title">${label}</div>`
    + `<div><b>${t('traffic.provider')}:</b> ${provider}</div>`
    + `<div><b>${t('traffic.speed')}:</b> ${speed}</div>`
    + (altitude ? `<div><b>${t('traffic.altitude')}:</b> ${altitude}</div>` : '')
    + `<div><b>${t('traffic.updated')}:</b> ${_esc(when)}</div>`
    + extra
    + `</div>`;
}

function _detailsRows(details) {
  const rows = [];
  for (const [key, value] of Object.entries(details)) {
    if (value === null || value === undefined || value === '') continue;
    rows.push(`<div><b>${_esc(_labelize(key))}:</b> ${_esc(value)}</div>`);
    if (rows.length >= 5) break;
  }
  return rows.join('');
}

function _providerLabel(provider) {
  const keys = {
    aircraft_opensky: 'traffic.provider.opensky',
    vessel_aishub: 'traffic.provider.aishub',
    train_gtfsrt: 'traffic.provider.gtfsrt',
  };
  return t(keys[provider] || provider || 'traffic.provider');
}

function _labelize(key) {
  return String(key).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function _esc(value) {
  return String(value).replace(/[&<>"]/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  }[ch]));
}

function _escAttr(value) {
  return String(value).replace(/[^a-z0-9_-]/gi, '');
}

export async function refreshTraffic() {
  if (!_layer) return;
  if (_running) {
    _queued = true;
    return;
  }
  const enabled = _enabledCategories();
  if (!enabled.length) {
    _clearLayer();
    _setMsg('');
    _restartTimer();
    return;
  }
  _running = true;
  _setMsg(t('traffic.loading'));
  try {
    const results = await Promise.allSettled(enabled.map(_fetchCategory));
    const features = [];
    const errors = [];
    results.forEach(result => {
      if (result.status === 'fulfilled') features.push(...result.value);
      else errors.push(result.reason?.message || String(result.reason));
    });
    _render(features);
    if (errors.length) _setMsg(t('traffic.error', errors.join(' | ')), 'error');
    else if (features.length) _setMsg(t('traffic.count', features.length));
    else _setMsg(t('traffic.none'));
  } catch (e) {
    _clearLayer();
    _setMsg(t('traffic.error', e.message), 'error');
  } finally {
    _running = false;
    if (_queued) {
      _queued = false;
      _scheduleRefresh();
    }
  }
}

export function initTraffic() {
  if (_initialized) return;
  _initialized = true;
  _layer = L.layerGroup().addTo(map);

  const controls = [
    document.getElementById('chkTrafficAircraft'),
    document.getElementById('trafficAircraftProvider'),
    document.getElementById('chkTrafficVessels'),
    document.getElementById('trafficVesselProvider'),
    document.getElementById('chkTrafficTrains'),
    document.getElementById('trafficTrainProvider'),
    document.getElementById('trafficRefreshSec'),
  ].filter(Boolean);

  controls.forEach(el => el.addEventListener('change', () => {
    scheduleSaveConfig();
    refreshTraffic();
    _restartTimer();
  }));

  map.on('moveend zoomend', () => {
    if (_enabledCategories().length) _scheduleRefresh();
  });

  refreshTraffic();
  _restartTimer();
}
