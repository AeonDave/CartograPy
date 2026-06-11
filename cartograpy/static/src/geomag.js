// ==============================================================
// Magnetic declination + grid convergence display
// ==============================================================
// Shows a small badge above the map status with the declination and grid
// convergence at the current map center. Recomputed (debounced) on every
// map move/zoom. EPSG is taken from the active grid info if available.
import { map, $gridType } from './core.js';
import { state } from './state.js';
import { t } from './i18n.js';

let _timer = null;
let _badge = null;

function _isEnabled() {
  return document.getElementById('chkMagBadge')?.checked !== false;
}

function _hideBadge() {
  if (_badge) _badge.style.display = 'none';
}

function _ensureBadge() {
  if (_badge) return _badge;
  const mapEl = document.getElementById('map');
  if (!mapEl) return null;
  _badge = document.createElement('div');
  _badge.id = 'magBadge';
  // Floats over the bottom-right of the map, just above Leaflet's
  // attribution control. All presentation lives in the theme stylesheet
  // (.mag-badge) so themes can restyle it.
  _badge.className = 'mag-badge';
  _badge.style.display = 'none';
  mapEl.appendChild(_badge);
  return _badge;
}

function _fmt(deg) {
  const dir = deg >= 0 ? 'E' : 'W';
  return `${Math.abs(deg).toFixed(1)}°${dir}`;
}

async function _refresh() {
  if (!_isEnabled()) {
    _hideBadge();
    return;
  }
  const c = map.getCenter();
  const epsg = state.gridEpsg ? `&epsg=${state.gridEpsg}` : '';
  const url = `/api/declination?lat=${c.lat}&lon=${c.lng}${epsg}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    if (data.error) return;
    const badge = _ensureBadge();
    if (!badge) return;
    badge.style.display = '';
    badge.innerHTML =
      `<i class="fa-solid fa-compass"></i> ${t('mag.label')} ${_fmt(data.declination)}`
      + (Math.abs(data.convergence) > 0.05
            ? `  ${t('mag.gridConv')} ${_fmt(data.convergence)}`
            : '');
    badge.title = `${t('mag.model')}: ${data.model} (${Math.floor(data.year)})`;
  } catch (e) { /* network/offline: leave previous value */ }
}

export function scheduleMagRefresh() {
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(_refresh, 400);
}

export function initMagDisplay() {
  document.getElementById('chkMagBadge')?.addEventListener('change', () => {
    if (_isEnabled()) scheduleMagRefresh();
    else {
      if (_timer) clearTimeout(_timer);
      _hideBadge();
    }
  });
  map.on('moveend', scheduleMagRefresh);
  map.on('zoomend', scheduleMagRefresh);
  if ($gridType) $gridType.addEventListener('change', scheduleMagRefresh);
  _refresh();
}
