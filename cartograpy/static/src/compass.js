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

  // Build the rose markup once: ring, degree ticks, cardinals, needle.
  // Geometry only — every colour comes from theme CSS classes so each
  // theme can restyle the instrument (see themes/CONTRACT.md §3).
  function _roseSvg() {
    let ticks = '';
    for (let a = 0; a < 360; a += 15) {
      const main = a % 90 === 0;
      const mid = !main && a % 45 === 0;
      const r1 = 33;
      const r0 = main ? 26.5 : (mid ? 28.5 : 30.5);
      const s = Math.sin(a * Math.PI / 180);
      const c = Math.cos(a * Math.PI / 180);
      ticks += `<line x1="${(36 + s * r0).toFixed(2)}" y1="${(36 - c * r0).toFixed(2)}"
                      x2="${(36 + s * r1).toFixed(2)}" y2="${(36 - c * r1).toFixed(2)}"
                      class="${main ? 'ct-main' : 'ct'}"/>`;
    }
    const card = (label, a, cls) => {
      const s = Math.sin(a * Math.PI / 180);
      const c = Math.cos(a * Math.PI / 180);
      return `<text x="${(36 + s * 21).toFixed(2)}" y="${(36 - c * 21 + 3.2).toFixed(2)}"
                    text-anchor="middle" class="cardinal ${cls}">${label}</text>`;
    };
    return `
      <svg viewBox="0 0 72 72" class="compass-svg">
        <circle cx="36" cy="36" r="34" class="ring"/>
        <circle cx="36" cy="36" r="34" fill="none" class="ring-edge"/>
        ${ticks}
        ${card('N', 0, 'cardinal-n')}${card('E', 90, '')}
        ${card('S', 180, '')}${card('W', 270, '')}
        <polygon points="36,9 40.5,36 36,31 31.5,36" class="needle-n"/>
        <polygon points="36,63 31.5,36 36,41 40.5,36" class="needle-s"/>
        <circle cx="36" cy="36" r="2.6" class="hub"/>
      </svg>`;
  }

  const Ctl = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const wrap = L.DomUtil.create('div', 'leaflet-control compass-control');
      wrap.title = t('compass.rotateTitle');
      wrap.setAttribute('data-i18n-title', 'compass.rotateTitle');
      wrap.innerHTML = `
        <a href="#" class="compass-btn" role="button" aria-label="${t('compass.rotateAria')}">
          ${_roseSvg()}
          <span class="compass-readout">000°</span>
        </a>`;

      this._btn = wrap.querySelector('.compass-btn');
      if (this._btn) {
        this._btn.setAttribute('data-i18n-aria-label', 'compass.rotateAria');
      }
      this._svg = wrap.querySelector('.compass-svg');
      this._readout = wrap.querySelector('.compass-readout');
      this._dragging = false;
      this._moved = false;
      this._ignoreClick = false;
      this._start = null;

      // Angle of the pointer around the rose centre (compass convention:
      // 0 = up, growing clockwise).
      this._pointerAngle = (e) => {
        const rect = this._btn.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        return Math.atan2(e.clientX - cx, cy - e.clientY) * 180 / Math.PI;
      };

      this._onPointerDown = (e) => {
        if (!this._btn) return;
        e.preventDefault();
        e.stopPropagation();
        this._dragging = true;
        this._moved = false;
        this._start = { x: e.clientX, y: e.clientY };
        // Dial drag: remember where the dial was grabbed so the rose
        // FOLLOWS the pointer (no jump, no inverted rotation). The rose
        // is rendered at -bearing, so bearing must DECREASE by the same
        // angle the pointer sweeps clockwise.
        this._startAngle = this._pointerAngle(e);
        this._startBearing = map.getBearing() || 0;
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
        const delta = this._pointerAngle(e) - this._startAngle;
        const bearing = ((this._startBearing - delta) % 360 + 360) % 360;
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
      const b = _normalizeBearing(map.getBearing() || 0) ?? 0;
      this._svg.style.transform = `rotate(${-b}deg)`;
      if (this._readout) {
        this._readout.textContent = String(b).padStart(3, '0') + '°';
        this._readout.classList.toggle('north', b === 0);
      }
    },
  });

  const ctl = new Ctl();
  ctl.addTo(map);
  map.on('rotate', () => {
    ctl._update();
    _syncBearingInput();
  });
}
