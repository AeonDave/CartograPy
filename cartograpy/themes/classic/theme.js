// ==============================================================
// CLASSIC theme chrome — presentational only (see CONTRACT.md §4).
// Header readouts (position / zoom / declination) + footer source.
// ==============================================================
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  const api = window.CartograPy;
  if (!api || !api.map) return;
  const map = api.map;
  const roPos = $('clsPos');
  const roZoom = $('clsZoom');
  const roDecl = $('clsDecl');
  const roSrc = $('clsSrc');

  function fmtPos(latlng) {
    const lat = latlng.lat, lon = latlng.lng;
    return Math.abs(lat).toFixed(5) + '°' + (lat >= 0 ? 'N' : 'S') + '  '
         + Math.abs(lon).toFixed(5) + '°' + (lon >= 0 ? 'E' : 'W');
  }

  function updateCenter() {
    if (roPos) roPos.textContent = fmtPos(map.getCenter());
    if (roZoom) roZoom.textContent = 'Z' + map.getZoom();
  }
  map.on('mousemove', (e) => { if (roPos) roPos.textContent = fmtPos(e.latlng); });
  map.on('mouseout', updateCenter);
  map.on('moveend zoomend', updateCenter);
  updateCenter();

  /* declination readout — debounced fetch on map idle */
  let declT = null;
  function refreshDecl() {
    if (!roDecl) return;
    clearTimeout(declT);
    declT = setTimeout(async () => {
      try {
        const c = map.getCenter();
        const res = await fetch(`/api/declination?lat=${c.lat}&lon=${c.lng}`);
        if (!res.ok) return;
        const d = await res.json();
        if (d.error) return;
        const f = (v) => Math.abs(v).toFixed(1) + '°' + (v >= 0 ? 'E' : 'W');
        roDecl.textContent = f(d.declination) + ' / ' + f(d.convergence);
      } catch (e) {}
    }, 600);
  }
  map.on('moveend', refreshDecl);
  refreshDecl();

  /* footer source readout — mirrors the #source select */
  const srcSel = $('source');
  function updateSrc() {
    if (roSrc && srcSel) {
      const opt = srcSel.selectedOptions[0];
      roSrc.textContent = opt ? opt.textContent : (srcSel.value || '—');
    }
  }
  if (srcSel) {
    srcSel.addEventListener('change', updateSrc);
    // initial value is set asynchronously by loadConfig() — poll briefly
    let tries = 0;
    const t = setInterval(() => {
      updateSrc();
      if ((srcSel.value && srcSel.value.length) || ++tries > 20) clearInterval(t);
    }, 500);
  }
})();
