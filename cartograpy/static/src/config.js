// ==============================================================
// Config persistence + OWM key + language switch + PDF export
// ==============================================================
import { map, status, $scale, $paper, $sheets, $landscape, $source,
         $dpi, $mapTextScale, $gridType, $gridScale, $fullLabels,
         $bearing, $btnExport } from './core.js';
import { state, waypoints, searchHistory, tileLayers,
         selectedOverlays, MAX_HISTORY } from './state.js';
import { t, loadLanguage } from './i18n.js';
import { populateOverlayPanel, applyOverlays, overlays } from './overlays.js';
import { renderHistory } from './search.js';
import { refreshOsmSnapCache } from './snap.js';
import { collectToolData } from './tools.js';

// ---------------- Config field map ----------------
const CONFIG_FIELDS = {
  scale:        { el: () => $scale,        type: 'value' },
  paper:        { el: () => $paper,        type: 'value' },
  sheets:       { el: () => $sheets,       type: 'value' },
  landscape:    { el: () => $landscape,    type: 'checked' },
  source:       { el: () => $source,       type: 'value' },
  dpi:          { el: () => $dpi,          type: 'value' },
  mapTextScale: { el: () => $mapTextScale, type: 'value' },
  bearing:      { el: () => $bearing,      type: 'value' },
  showMagBadge: { el: () => document.getElementById('chkMagBadge'), type: 'checked' },
  gridType:     { el: () => $gridType,     type: 'value' },
  gridScale:    { el: () => $gridScale,    type: 'value' },
  fullLabels:   { el: () => $fullLabels,   type: 'checked' },
  routeProfile: { el: () => document.getElementById('routeProfile'), type: 'value' },
  snapWp:       { el: () => document.getElementById('chkSnapWp'),    type: 'checked' },
  snapPeaks:    { el: () => document.getElementById('chkSnapPeaks'), type: 'checked' },
  snapTrails:   { el: () => document.getElementById('chkSnapTrails'), type: 'checked' },
  toolsInPdf:   { el: () => document.getElementById('chkToolsInPdf'), type: 'checked' },
  trafficAircraftEnabled: { el: () => document.getElementById('chkTrafficAircraft'), type: 'checked' },
  trafficAircraftProvider: { el: () => document.getElementById('trafficAircraftProvider'), type: 'value' },
  trafficVesselEnabled: { el: () => document.getElementById('chkTrafficVessels'), type: 'checked' },
  trafficVesselProvider: { el: () => document.getElementById('trafficVesselProvider'), type: 'value' },
  trafficTrainEnabled: { el: () => document.getElementById('chkTrafficTrains'), type: 'checked' },
  trafficTrainProvider: { el: () => document.getElementById('trafficTrainProvider'), type: 'value' },
  trafficRefreshSec: { el: () => document.getElementById('trafficRefreshSec'), type: 'value' },
  language:     { el: () => document.getElementById('language'),  type: 'value' },
  owmApiKey:    { el: () => document.getElementById('owmApiKey'), type: 'value' },
  aishubUsername: { el: () => document.getElementById('aishubUsername'), type: 'value' },
  gtfsRealtimeUrl: { el: () => document.getElementById('gtfsRealtimeUrl'), type: 'value' },
};

function gatherConfig() {
  const c = map.getCenter();
  const cfg = { lat: c.lat, lon: c.lng, zoom: map.getZoom() };
  for (const [k, def] of Object.entries(CONFIG_FIELDS)) {
    cfg[k] = def.el()[def.type];
  }
  cfg.searchHistory = searchHistory.slice(0, MAX_HISTORY);
  cfg.overlays = Array.from(selectedOverlays);
  return cfg;
}

export function scheduleSaveConfig() {
  clearTimeout(state.cfgTimer);
  state.cfgTimer = setTimeout(saveConfig, 800);
}

export async function saveConfig() {
  try {
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(gatherConfig()),
    });
  } catch (e) {}
}

export async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    if (!cfg || !cfg.scale) return;
    for (const [k, def] of Object.entries(CONFIG_FIELDS)) {
      if (cfg[k] !== undefined) def.el()[def.type] = cfg[k];
    }
    if (cfg.lat && cfg.lon) map.setView([cfg.lat, cfg.lon], cfg.zoom || 13);
    const bearing = Number(cfg.bearing);
    if (Number.isFinite(bearing) && typeof map.setBearing === 'function') {
      map.setBearing(((Math.round(bearing) % 360) + 360) % 360);
    }

    // Sync tile layer to saved source.
    const src = $source.value;
    Object.values(tileLayers).forEach(tl => map.removeLayer(tl));
    if (tileLayers[src]) {
      tileLayers[src].addTo(map);
      state.activeBaseLayerName = src;
    }

    // Load language.
    await loadLanguage(document.getElementById('language').value || 'en');

    if (document.getElementById('chkSnapPeaks')?.checked
        || document.getElementById('chkSnapTrails')?.checked) {
      refreshOsmSnapCache(false);
    }

    // Restore search history (mutate in place: const export).
    if (Array.isArray(cfg.searchHistory)) {
      searchHistory.length = 0;
      searchHistory.push(...cfg.searchHistory.slice(0, MAX_HISTORY));
      renderHistory();
    }

    // OWM key UI state.
    showOwmState();
    populateOverlayPanel();

    // Restore selected overlays.
    if (Array.isArray(cfg.overlays)) {
      selectedOverlays.clear();
      cfg.overlays.forEach(id => selectedOverlays.add(id));
      populateOverlayPanel();
      applyOverlays();
    }
  } catch (e) {}
}

// ---------------- Auto-save listeners (idempotent) ----------------
export function attachAutoSaveListeners() {
  [$scale, $paper, $sheets, $source, $dpi, $mapTextScale, $bearing,
   document.getElementById('chkMagBadge'), $gridType, $gridScale,
   document.getElementById('routeProfile'), document.getElementById('chkSnapWp'),
   document.getElementById('chkSnapPeaks'), document.getElementById('chkSnapTrails'),
   document.getElementById('chkToolsInPdf'), document.getElementById('chkTrafficAircraft'),
   document.getElementById('trafficAircraftProvider'), document.getElementById('chkTrafficVessels'),
   document.getElementById('trafficVesselProvider'), document.getElementById('chkTrafficTrains'),
   document.getElementById('trafficTrainProvider'), document.getElementById('trafficRefreshSec'),
   document.getElementById('aishubUsername'), document.getElementById('gtfsRealtimeUrl')]
    .filter(Boolean)
    .forEach(el => el.addEventListener('change', scheduleSaveConfig));
  [document.getElementById('aishubUsername'), document.getElementById('gtfsRealtimeUrl')]
    .filter(Boolean)
    .forEach(el => el.addEventListener('input', scheduleSaveConfig));
  $sheets.addEventListener('input', scheduleSaveConfig);
  [$landscape, $fullLabels].forEach(el => el.addEventListener('change', scheduleSaveConfig));
  map.on('moveend', scheduleSaveConfig);
  map.on('rotate', scheduleSaveConfig);
}

// ---------------- OWM API key handling ----------------
const $owmHidden = document.getElementById('owmApiKey');
const $owmField = document.getElementById('owmKeyField');
const $owmInput = document.getElementById('owmKeyInput');
const $owmBadge = document.getElementById('owmKeyBadge');
const $owmError = document.getElementById('owmKeyError');

export function showOwmState() {
  const hasKey = !!$owmHidden.value.trim();
  $owmInput.style.display = hasKey ? 'none' : '';
  $owmBadge.style.display = hasKey ? '' : 'none';
  $owmError.textContent = '';
  $owmError.style.display = 'none';
}

async function validateOwmKey(key) {
  try {
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=London&appid=${encodeURIComponent(key)}`,
    );
    return res.ok;
  } catch {
    return false;
  }
}

export function setupOwmKeyUI() {
  document.getElementById('owmKeyConfirm').addEventListener('click', async () => {
    const key = $owmField.value.trim();
    if (!key) return;
    const btn = document.getElementById('owmKeyConfirm');
    btn.disabled = true;
    $owmError.style.display = 'none';
    const ok = await validateOwmKey(key);
    btn.disabled = false;
    if (ok) {
      $owmHidden.value = key;
      $owmField.value = '';
      showOwmState();
      populateOverlayPanel();
      scheduleSaveConfig();
    } else {
      $owmError.textContent = t('label.owmInvalidKey');
      $owmError.style.display = 'block';
    }
  });
  $owmField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('owmKeyConfirm').click();
    }
  });
  document.getElementById('owmKeyDelete').addEventListener('click', () => {
    $owmHidden.value = '';
    for (const def of overlays.defs) {
      if (def.requires === 'owm') selectedOverlays.delete(def.id);
    }
    showOwmState();
    populateOverlayPanel();
    applyOverlays();
    scheduleSaveConfig();
  });

  document.getElementById('language').addEventListener('change', async () => {
    await loadLanguage(document.getElementById('language').value);
    populateOverlayPanel();
    scheduleSaveConfig();
  });
}

// ---------------- PDF export ----------------
export async function exportPDF() {
  const c = map.getCenter();
  const params = {
    lat: c.lat, lon: c.lng,
    scale: parseInt($scale.value) || 25000,
    paper: $paper.value,
    landscape: $landscape.checked,
    dpi: parseInt($dpi.value) || 300,
    source: $source.value,
    grid_type: $gridType.value,
    grid_full_labels: $fullLabels.checked,
    grid_scale: parseInt($gridScale.value) || 50,
    map_text_scale: parseInt($mapTextScale.value) || 50,
    sheets: parseInt($sheets.value) || 1,
    waypoints: waypoints.map(w => ({
      lat: w.lat, lng: w.lng, icon: w.icon, color: w.color, name: w.name || '',
    })),
    drawings: document.getElementById('chkToolsInPdf').checked ? collectToolData() : [],
  };
  $btnExport.disabled = true;
  $btnExport.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${t('status.generating')}`;
  status(t('status.exporting'));
  try {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'export failed');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mappa_${params.scale}_${params.paper}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    status(t('status.exported'));
  } catch (e) {
    status(t('msg.exportError') + e.message);
    alert(t('msg.error') + e.message);
  } finally {
    $btnExport.disabled = false;
    $btnExport.innerHTML =
      `<i class="fa-solid fa-file-pdf"></i> <span data-i18n="btn.export">${t('btn.export')}</span>`;
  }
}
