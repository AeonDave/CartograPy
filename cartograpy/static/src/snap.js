// ==============================================================
// Snap helpers — waypoints + OSM features (peaks, trail vertices)
// ==============================================================
// `snapPoint(latlng)` is the single entry point used by every drawing
// tool. It consults the three snap checkboxes and returns the best
// snap target within ``SNAP_PX`` pixels (or the original click).
//
// OSM features are fetched once via ``/api/osm_snap`` for the current
// viewport and cached in memory; ``refreshOsmSnapCache()`` is called
// whenever a snap-aware tool activates and on map ``moveend``.
import { map } from './core.js';
import { waypoints, SNAP_PX } from './state.js';

const _osm = {
  peaks: [],          // {lat, lon}
  trailNodes: [],     // {lat, lon} — flattened trail vertices
  bbox: null,         // [s, w, n, e]
  pending: false,
};

function _bboxCovers(b, target) {
  if (!b) return false;
  const [s, w, n, e] = b;
  const [ts, tw, tn, te] = target;
  return ts >= s && tw >= w && tn <= n && te <= e;
}

function _currentBbox() {
  const b = map.getBounds();
  return [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()];
}

function _expandedBbox(b) {
  // Expand by ~30% so small pans don't trigger a refetch.
  const [s, w, n, e] = b;
  const dy = (n - s) * 0.3;
  const dx = (e - w) * 0.3;
  return [s - dy, w - dx, n + dy, e + dx];
}

function _wantedTypes() {
  const types = [];
  if (document.getElementById('chkSnapPeaks')?.checked) types.push('peak');
  if (document.getElementById('chkSnapTrails')?.checked) types.push('trail');
  return types;
}

export async function refreshOsmSnapCache(force = false) {
  const types = _wantedTypes();
  if (!types.length) {
    _osm.peaks.length = 0;
    _osm.trailNodes.length = 0;
    _osm.bbox = null;
    return;
  }
  const view = _currentBbox();
  if (!force && _bboxCovers(_osm.bbox, view)) return;
  if (_osm.pending) return;

  const fetchBbox = _expandedBbox(view);
  _osm.pending = true;
  try {
    const [s, w, n, e] = fetchBbox;
    const url = `/api/osm_snap?s=${s}&w=${w}&n=${n}&e=${e}`
              + `&types=${types.join(',')}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    if (data.error) return;
    _osm.peaks = (data.peaks || []).map(p => ({ lat: p.lat, lon: p.lon }));
    const trailNodes = [];
    (data.trails || []).forEach(t => {
      (t.coords || []).forEach(([lat, lon]) => trailNodes.push({ lat, lon }));
    });
    _osm.trailNodes = trailNodes;
    _osm.bbox = fetchBbox;
  } catch (e) {
    /* leave stale cache */
  } finally {
    _osm.pending = false;
  }
}

export function snapPoint(latlng) {
  const pt = map.latLngToContainerPoint(latlng);
  let best = null;
  let bestDist = Infinity;

  const consider = (lat, lng) => {
    const cp = map.latLngToContainerPoint(L.latLng(lat, lng));
    const d = pt.distanceTo(cp);
    if (d < bestDist && d <= SNAP_PX) {
      bestDist = d;
      best = L.latLng(lat, lng);
    }
  };

  if (document.getElementById('chkSnapWp')?.checked) {
    waypoints.forEach(w => consider(w.lat, w.lng));
  }
  if (document.getElementById('chkSnapPeaks')?.checked) {
    _osm.peaks.forEach(p => consider(p.lat, p.lon));
  }
  if (document.getElementById('chkSnapTrails')?.checked) {
    _osm.trailNodes.forEach(p => consider(p.lat, p.lon));
  }
  return best || latlng;
}

let _moveTimer = null;
export function initSnap() {
  // Re-fetch cache when the user pans into uncovered area.
  map.on('moveend', () => {
    if (_moveTimer) clearTimeout(_moveTimer);
    _moveTimer = setTimeout(() => refreshOsmSnapCache(false), 600);
  });
  // Re-fetch when toggles change.
  ['chkSnapPeaks', 'chkSnapTrails'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => refreshOsmSnapCache(true));
  });
}
