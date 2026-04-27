// ==============================================================
// Route tool — BRouter-powered hiking / MTB / cycling routing
// ==============================================================
// Flow:
//   1. User picks profile from #routeProfile.
//   2. User clicks 2+ waypoints on the map (snap-aware).
//   3. On Calculate, POST /api/route → server queries BRouter → returns
//      polyline + distance + ascend + duration.
//   4. Result is drawn on the map and pushed into ``routeHistory``.
//      Export modules treat ``type: 'route'`` as a line-like drawing.
import { map } from './core.js';
import { TOOL_COLORS, routeHistory } from './state.js';
import { t } from './i18n.js';
import { snapPoint, refreshOsmSnapCache } from './snap.js';

let _points = [];      // [LatLng, ...]
let _markers = [];     // L.circleMarker
let _tempLine = null;  // dashed polyline shown between picks
let _renderHistory = null;
let _pending = false;

function _color() { return TOOL_COLORS.route; }

function _formatDist(m) {
  if (m >= 1000) return (m / 1000).toFixed(2) + ' km';
  return m.toFixed(1) + ' m';
}

function _formatDuration(seconds) {
  const m = Math.round((seconds || 0) / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}m`;
}

function _distanceFromPoints(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let dist = 0;
  for (let i = 1; i < points.length; i++) {
    dist += L.latLng(points[i - 1][0], points[i - 1][1])
      .distanceTo(L.latLng(points[i][0], points[i][1]));
  }
  return dist;
}

export function formatRouteSummary(data) {
  const dist = data.distance != null ? Number(data.distance) : _distanceFromPoints(data.points);
  const parts = [data.profile || 'route', _formatDist(Number.isFinite(dist) ? dist : 0)];
  if (data.ascend != null) parts.push(`↑${Math.round(Number(data.ascend) || 0)} m`);
  if (data.duration != null) parts.push(_formatDuration(Number(data.duration) || 0));
  return parts.join(' — ');
}

export function setRouteHistoryRenderer(fn) {
  _renderHistory = fn;
}

function _renderRouteHistory() {
  if (_renderHistory) _renderHistory();
}

function _refreshTempLine() {
  if (_tempLine) { map.removeLayer(_tempLine); _tempLine = null; }
  if (_points.length >= 2) {
    _tempLine = L.polyline(_points,
      { color: _color(), weight: 2, dashArray: '6 4', opacity: 0.7 }).addTo(map);
  }
}

function _removeDraftPoint(index) {
  const marker = _markers[index];
  if (marker) map.removeLayer(marker);
  _points.splice(index, 1);
  _markers.splice(index, 1);
  _refreshTempLine();
  _updateDraftResult();
}

function _renderDraftPoints() {
  const list = document.getElementById('routeDraftPoints');
  if (!list) return;
  list.innerHTML = '';
  _points.forEach((pt, i) => {
    const row = document.createElement('div');
    row.className = 'route-draft-row';
    row.style.color = _color();

    const txt = document.createElement('span');
    txt.className = 'tool-hist-text';
    txt.textContent = `#${i + 1}  ${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}`;
    txt.addEventListener('click', () => map.panTo(pt));

    const del = document.createElement('span');
    del.className = 'tool-hist-del';
    del.title = t('route.removePoint');
    del.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    del.addEventListener('click', (ev) => {
      ev.stopPropagation();
      _removeDraftPoint(i);
    });

    row.appendChild(txt);
    row.appendChild(del);
    list.appendChild(row);
  });
}

function _resetDraw({ clearResult = true } = {}) {
  _markers.forEach(m => map.removeLayer(m));
  _markers = [];
  _points = [];
  if (_tempLine) { map.removeLayer(_tempLine); _tempLine = null; }
  _renderDraftPoints();
  if (clearResult) {
    const r = document.getElementById('routeResult');
    if (r) r.textContent = '';
  }
}

function _updateDraftResult() {
  const r = document.getElementById('routeResult');
  if (!r) return;
  if (!_pending) r.textContent = '';
  _renderDraftPoints();
}

function _onClick(e) {
  const pt = snapPoint(e.latlng);
  _points.push(pt);
  _markers.push(L.circleMarker(pt,
    { radius: 5, color: _color(), fillColor: _color(), fillOpacity: 1 }).addTo(map));
  _refreshTempLine();
  _updateDraftResult();
}

export async function routeFinish() {
  if (_pending) return;
  if (_points.length < 2) {
    const r = document.getElementById('routeResult');
    if (r) r.textContent = t('route.needTwo') || 'Need ≥ 2 points';
    return;
  }
  const profile = document.getElementById('routeProfile').value;
  const payload = {
    profile,
    points: _points.map(p => [p.lat, p.lng]),
  };
  const r = document.getElementById('routeResult');
  if (r) r.textContent = t('route.computing') || 'Routing…';
  _pending = true;
  try {
    const res = await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (r) r.textContent = (t('route.error') || 'Routing error') + ': ' + (err.error || res.status);
      return;
    }
    const data = await res.json();
    const coords = data.coords || [];
    if (coords.length < 2) {
      if (r) r.textContent = t('route.empty') || 'Empty route';
      return;
    }
    // Draw final polyline.
    const layers = [];
    const latlngs = coords.map(c => L.latLng(c[0], c[1]));
    layers.push(L.polyline(latlngs,
      { color: _color(), weight: 4, opacity: 0.85 }).addTo(map));
    const routeData = {
      type: 'route',
      profile: data.profile,
      distance: data.distance,
      ascend: data.ascend,
      duration: data.duration,
      points: coords,           // [[lat, lon], ...]
    };
    const summary = formatRouteSummary(routeData);
    routeHistory.push({
      layers,
      text: summary,
      data: routeData,
    });
    _renderRouteHistory();
    if (r) r.textContent = summary;
    _resetDraw({ clearResult: false });
  } catch (e) {
    if (r) r.textContent = (t('route.error') || 'Routing error') + ': ' + e.message;
  } finally {
    _pending = false;
  }
}

export function routeUndo() {
  if (_points.length) {
    _points.pop();
    const marker = _markers.pop();
    if (marker) map.removeLayer(marker);
    _refreshTempLine();
    _updateDraftResult();
    return;
  }
  if (routeHistory.length) {
    const last = routeHistory.pop();
    last.layers.forEach(l => { try { map.removeLayer(l); } catch (e) {} });
    _renderRouteHistory();
  }
}

export function activateRoute() {
  document.getElementById('routeInfo').style.display = 'block';
  document.getElementById('routeResult').textContent = '';
  _renderDraftPoints();
  map.getContainer().classList.add('ruler-cursor');
  map.on('click', _onClick);
  refreshOsmSnapCache(false);
}

export function deactivateRoute() {
  document.getElementById('routeInfo').style.display = 'none';
  map.getContainer().classList.remove('ruler-cursor');
  map.off('click', _onClick);
  _resetDraw();
}

export function setupRouteUI() {
  const done   = document.getElementById('btnRouteDone');
  const cancel = document.getElementById('btnRouteCancel');
  if (done)   done.addEventListener('click', routeFinish);
  if (cancel) cancel.addEventListener('click', () => _resetDraw());
}
