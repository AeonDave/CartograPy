// ==============================================================
// Compass control — north indicator + interactive rotation
// ==============================================================
// Renders a small needle in the top-right corner of the map. The
// needle rotates in sync with ``map.getBearing()`` (provided by the
// ``leaflet-rotate`` plugin). Drag the control to rotate the map;
// click it to reset the bearing to 0. The Map panel also exposes a
// 0..359° numeric field kept in sync with the current map bearing.
//
// Rotation is enabled in ``core.js`` via ``rotate: true``.
import { map, $bearing } from './core.js';
import { t } from './i18n.js';

function _supportsRotate() {
  return typeof map.setBearing === 'function'
      && typeof map.getBearing === 'function';
}

function _normalizeBearing(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return ((Math.round(n) % 360) + 360) % 360;
}

function _currentBearing() {
  return _normalizeBearing(map.getBearing() || 0) ?? 0;
}

function _syncBearingInput() {
  if (!$bearing) return;
  $bearing.value = String(_currentBearing());
}

function _setBearingFromInput(normalizeDisplay = false) {
  if (!$bearing) return;
  const bearing = _normalizeBearing($bearing.value);
  if (bearing === null) {
    if (normalizeDisplay) _syncBearingInput();
    return;
  }
  map.setBearing(bearing);
  if (normalizeDisplay) $bearing.value = String(bearing);
}

function _initBearingInput() {
  if (!$bearing) return;
  $bearing.addEventListener('input', () => _setBearingFromInput());
  $bearing.addEventListener('change', () => _setBearingFromInput(true));
  $bearing.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      _setBearingFromInput(true);
      $bearing.blur();
    }
  });
  _syncBearingInput();
}

export function initCompassControl() {
  if (!_supportsRotate()) {
    // Plugin missing — silently skip the control. Map keeps working
    // as a non-rotating Leaflet instance.
    if ($bearing) $bearing.disabled = true;
    return;
  }
  _initBearingInput();

  const Ctl = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const wrap = L.DomUtil.create('div', 'leaflet-bar leaflet-control compass-control');
      wrap.title = t('compass.rotateTitle');
      wrap.setAttribute('data-i18n-title', 'compass.rotateTitle');
      wrap.innerHTML = `
        <a href="#" class="compass-btn" role="button" aria-label="${t('compass.rotateAria')}">
          <svg viewBox="0 0 36 36" width="28" height="28" class="compass-svg">
            <circle cx="18" cy="18" r="16" fill="#fff" stroke="#475569" stroke-width="1.5"/>
            <text x="18" y="9" text-anchor="middle" font-size="7" font-weight="700"
                  fill="#dc2626" font-family="sans-serif">N</text>
            <polygon points="18,5 21,18 18,16 15,18" fill="#dc2626"/>
            <polygon points="18,31 15,18 18,20 21,18" fill="#475569"/>
          </svg>
        </a>`;

      this._btn = wrap.querySelector('.compass-btn');
      if (this._btn) {
        this._btn.setAttribute('data-i18n-aria-label', 'compass.rotateAria');
      }
      this._svg = wrap.querySelector('.compass-svg');
      this._dragging = false;
      this._moved = false;
      this._ignoreClick = false;
      this._start = null;

      this._onPointerDown = (e) => {
        if (!this._btn) return;
        e.preventDefault();
        e.stopPropagation();
        this._dragging = true;
        this._moved = false;
        this._start = { x: e.clientX, y: e.clientY };
        this._btn.classList.add('rotating');
        document.addEventListener('pointermove', this._onPointerMove);
        document.addEventListener('pointerup', this._onPointerUp);
        document.addEventListener('pointercancel', this._onPointerUp);
      };

      this._onPointerMove = (e) => {
        if (!this._dragging || !this._btn || !this._start) return;
        e.preventDefault();
        const dx = e.clientX - this._start.x;
        const dy = e.clientY - this._start.y;
        if (!this._moved && Math.hypot(dx, dy) < 4) return;
        this._moved = true;
        const rect = this._btn.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const angle = Math.atan2(e.clientX - cx, cy - e.clientY) * 180 / Math.PI;
        const bearing = (angle + 360) % 360;
        map.setBearing(bearing);
        this._update();
      };

      this._onPointerUp = (e) => {
        if (this._dragging) {
          e.preventDefault();
          e.stopPropagation();
        }
        this._dragging = false;
        if (this._moved) {
          this._ignoreClick = true;
          setTimeout(() => { this._ignoreClick = false; }, 250);
        }
        else {
          map.setBearing(0);
          this._update();
        }
        if (this._btn) this._btn.classList.remove('rotating');
        document.removeEventListener('pointermove', this._onPointerMove);
        document.removeEventListener('pointerup', this._onPointerUp);
        document.removeEventListener('pointercancel', this._onPointerUp);
      };

      this._btn.addEventListener('pointerdown', this._onPointerDown);

      L.DomEvent.on(wrap, 'click', (e) => {
        L.DomEvent.preventDefault(e);
        L.DomEvent.stopPropagation(e);
        if (this._ignoreClick) {
          this._ignoreClick = false;
          return;
        }
        map.setBearing(0);
        this._update();
      });
      L.DomEvent.disableClickPropagation(wrap);
      this._update();
      return wrap;
    },
    onRemove() {
      if (this._btn && this._onPointerDown) {
        this._btn.removeEventListener('pointerdown', this._onPointerDown);
      }
      if (this._onPointerMove) {
        document.removeEventListener('pointermove', this._onPointerMove);
      }
      if (this._onPointerUp) {
        document.removeEventListener('pointerup', this._onPointerUp);
        document.removeEventListener('pointercancel', this._onPointerUp);
      }
    },
    _update() {
      if (!this._svg) return;
      // Counter-rotate so the needle keeps pointing to true north.
      const b = map.getBearing() || 0;
      this._svg.style.transform = `rotate(${-b}deg)`;
    },
  });

  const ctl = new Ctl();
  ctl.addTo(map);
  map.on('rotate', () => {
    ctl._update();
    _syncBearingInput();
  });
}
