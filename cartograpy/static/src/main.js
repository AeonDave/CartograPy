// ==============================================================
// Entry module — wires all events and bootstraps the application.
// ==============================================================
import {
  map, status,
  $search, $scale, $paper, $sheets, $landscape, $source,
  $gridType, $gridScale, $fullLabels, $dpi, $mapTextScale,
  $results, $resList, $btnExport,
  $btnRuler, $btnProtractor, $btnLine, $btnCompass, $btnRoute, $btnWpAddOnMap,
  $mtbDone, $mtbUndo, $mtbCancel,
  closeSidebarMobile,
} from './core.js';
import { state, tileLayers, searchResults, suggestData } from './state.js';
import { t, loadLanguage } from './i18n.js';
import { doSearch, goToPlace, fetchSuggestions, hideSuggestions } from './search.js';
import { updateOverlays, scheduleGridUpdate } from './print.js';
import { renderWaypointList,
         buildIconColorGrids,
         activateWaypoint, deactivateWaypoint, getWaypointMapActive,
         manualWpAddAsync, bulkWpImport, clearAllWaypoints,
         saveWpFile, refreshWpFileList } from './waypoints.js';
import { toggleTool, deactivateAllTools, lineUndo, lineFinish,
         updateMobileToolBar, collectToolData, clearAllTools,
         loadToolData } from './tools.js';
import { populateOverlayPanel, setOverlayDefs,
         buildTileOverlayDef } from './overlays.js';
import { loadConfig, exportPDF,
         attachAutoSaveListeners, setupOwmKeyUI } from './config.js';
import { setupGpxUI } from './gpx.js';
import { initMagDisplay } from './geomag.js';
import { routeFinish, routeUndo, setupRouteUI } from './route.js';
import { initSnap } from './snap.js';
import { initCompassControl } from './compass.js';

// ---------------- Sidebar ----------------
document.getElementById('toggleSidebar').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('collapsed');
  document.body.classList.toggle('sidebar-hidden');
  setTimeout(() => map.invalidateSize(), 300);
});
document.getElementById('sidebarBackdrop').addEventListener('click', closeSidebarMobile);
document.getElementById('closeSidebar').addEventListener('click', closeSidebarMobile);
if (window.innerWidth <= 768) {
  document.getElementById('sidebar').classList.add('collapsed');
  document.body.classList.add('sidebar-hidden');
}

// ---------------- Search ----------------
document.getElementById('btnSearch').addEventListener('click', doSearch);
$search.addEventListener('keydown', e => {
  if (e.key === 'Enter') { hideSuggestions(); doSearch(); }
  if (e.key === 'Escape') hideSuggestions();
});
$search.addEventListener('input', () => {
  if (state.suggestTimeout) clearTimeout(state.suggestTimeout);
  const q = $search.value.trim();
  if (q.length < 3) { hideSuggestions(); return; }
  state.suggestTimeout = setTimeout(() => fetchSuggestions(q), 350);
});
document.getElementById('searchSuggestions').addEventListener('click', (e) => {
  const item = e.target.closest('.sg-item');
  if (!item) return;
  const d = suggestData[parseInt(item.dataset.idx, 10)];
  if (!d) return;
  $search.value = d.name.substring(0, 80);
  hideSuggestions();
  goToPlace(d.name, d.lat, d.lon);
});
document.addEventListener('click', e => {
  if (!e.target.closest('#search') && !e.target.closest('#searchSuggestions')) hideSuggestions();
});
$resList.addEventListener('change', () => {
  const r = searchResults[$resList.selectedIndex];
  if (r) goToPlace(r.name, r.lat, r.lon);
});

// ---------------- Print rectangle / grid ----------------
$scale.addEventListener('change', updateOverlays);
$paper.addEventListener('change', updateOverlays);
$sheets.addEventListener('input', updateOverlays);
$landscape.addEventListener('change', updateOverlays);
$gridType.addEventListener('change', () => {
  const show = $gridType.value !== 'none';
  document.getElementById('gridScaleGroup').style.display = show ? 'flex' : 'none';
  document.getElementById('fullLabelsGroup').style.display = show ? 'flex' : 'none';
  document.getElementById('wpDatumLabel').textContent =
    document.getElementById('gridType').selectedOptions[0].textContent;
  updateOverlays();
});
$fullLabels.addEventListener('change', updateOverlays);
$source.addEventListener('change', () => {
  Object.values(tileLayers).forEach(l => map.removeLayer(l));
  if (tileLayers[$source.value]) {
    tileLayers[$source.value].addTo(map);
    state.activeBaseLayerName = $source.value;
  }
});
map.on('moveend', scheduleGridUpdate);
map.on('zoomend', scheduleGridUpdate);

// ---------------- Export ----------------
$btnExport.addEventListener('click', exportPDF);

// ---------------- Tool buttons ----------------
$btnRuler.addEventListener('click', () => toggleTool('ruler'));
$btnProtractor.addEventListener('click', () => toggleTool('protractor'));
$btnLine.addEventListener('click', () => toggleTool('line'));
$btnCompass.addEventListener('click', () => toggleTool('compass'));
$btnRoute.addEventListener('click', () => toggleTool('route'));
document.getElementById('btnLineUndo').addEventListener('click', lineUndo);

// Mobile tool bar
$mtbDone.addEventListener('click', () => {
  if (state.activeTool === 'line') lineFinish();
  if (state.activeTool === 'route') routeFinish();
  updateMobileToolBar();
});
$mtbUndo.addEventListener('click', () => {
  if (state.activeTool === 'line') lineUndo();
  if (state.activeTool === 'route') routeUndo();
  updateMobileToolBar();
});
$mtbCancel.addEventListener('click', deactivateAllTools);

// ---------------- Tool save / load ----------------
document.getElementById('btnToolSave').addEventListener('click', () => {
  const fp = document.getElementById('toolFilePanel');
  const sp = document.getElementById('toolSavePanel');
  const lp = document.getElementById('toolLoadPanel');
  lp.style.display = 'none';
  sp.style.display = sp.style.display === 'none' ? '' : 'none';
  fp.style.display = (sp.style.display === 'none' && lp.style.display === 'none') ? 'none' : '';
});
document.getElementById('btnToolLoad').addEventListener('click', async () => {
  const fp = document.getElementById('toolFilePanel');
  const sp = document.getElementById('toolSavePanel');
  const lp = document.getElementById('toolLoadPanel');
  sp.style.display = 'none';
  lp.style.display = lp.style.display === 'none' ? '' : 'none';
  fp.style.display = (sp.style.display === 'none' && lp.style.display === 'none') ? 'none' : '';
  if (lp.style.display !== 'none') await refreshToolFileList();
});
document.getElementById('btnToolSaveConfirm').addEventListener('click', async () => {
  const name = document.getElementById('toolFileName').value.trim();
  if (!name) { alert(t('msg.enterName')); return; }
  const data = collectToolData();
  try {
    const res = await fetch('/api/tools/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, drawings: data }),
    });
    const j = await res.json(); if (j.error) throw new Error(j.error);
    status(t('msg.toolsSaved'));
    document.getElementById('toolSavePanel').style.display = 'none';
    document.getElementById('toolFilePanel').style.display = 'none';
  } catch (e) { alert(t('msg.saveError') + ': ' + e.message); }
});
document.getElementById('btnToolClearAll').addEventListener('click', () => {
  clearAllTools();
  status(t('msg.toolsCleared'));
});

async function refreshToolFileList() {
  const list = document.getElementById('toolFileList');
  try {
    const res = await fetch('/api/tools/list');
    const files = await res.json();
    if (!files.length) {
      list.innerHTML = `<div style="font-size:11px;color:#94a3b8;" data-i18n="tool.noFiles">${t('tool.noFiles')}</div>`;
      return;
    }
    list.innerHTML = '';
    files.forEach(name => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;'
        + 'padding:3px 6px;margin-bottom:2px;border-radius:4px;font-size:12px;'
        + 'background:#f1f5f9;cursor:pointer';
      const lbl = document.createElement('span');
      lbl.textContent = name;
      lbl.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      lbl.addEventListener('click', async () => {
        try {
          const r = await fetch('/api/tools/load?name=' + encodeURIComponent(name));
          const data = await r.json();
          if (data.error) throw new Error(data.error);
          loadToolData(data);
          status(t('msg.toolsLoaded', data.length, name));
          document.getElementById('toolLoadPanel').style.display = 'none';
          document.getElementById('toolFilePanel').style.display = 'none';
        } catch (e) { alert(t('msg.loadError') + ': ' + e.message); }
      });
      const del = document.createElement('span');
      del.innerHTML = '<i class="fa-solid fa-trash"></i>';
      del.style.cssText = 'cursor:pointer;margin-left:6px;color:#94a3b8;padding:0 3px;font-size:11px';
      del.addEventListener('mouseenter', () => del.style.color = '#dc2626');
      del.addEventListener('mouseleave', () => del.style.color = '#94a3b8');
      del.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!confirm(t('msg.confirmDelete', name))) return;
        await fetch('/api/tools/delete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        await refreshToolFileList();
      });
      row.appendChild(lbl);
      row.appendChild(del);
      list.appendChild(row);
    });
  } catch (e) {
    list.innerHTML = `<div style="color:#dc2626;font-size:11px">Error</div>`;
  }
}

// ---------------- Waypoint UI ----------------
$btnWpAddOnMap.addEventListener('click', () => {
  if (getWaypointMapActive()) deactivateWaypoint();
  else activateWaypoint();
});
document.getElementById('btnWpAdd').addEventListener('click', manualWpAddAsync);
document.getElementById('wpCoordInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') manualWpAddAsync();
});
document.getElementById('btnWpBulk').addEventListener('click', bulkWpImport);
document.getElementById('btnWpClearAll').addEventListener('click', clearAllWaypoints);
document.getElementById('btnWpSave').addEventListener('click', () => {
  const panel = document.getElementById('wpFilePanel');
  const sp = document.getElementById('wpSavePanel');
  const lp = document.getElementById('wpLoadPanel');
  lp.style.display = 'none';
  sp.style.display = '';
  panel.style.display = '';
  document.getElementById('wpFileName').focus();
});
document.getElementById('btnWpLoad').addEventListener('click', refreshWpFileList);
document.getElementById('btnWpSaveConfirm').addEventListener('click', saveWpFile);

// ---------------- Config + OWM + language ----------------
attachAutoSaveListeners();
setupOwmKeyUI();

// ---------------- Bootstrap (sources → language → config) ----------------
async function loadSources() {
  let payload = null;
  try {
    const res = await fetch('/api/constants');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    payload = data.sources;
  } catch (e) { console.error('loadSources failed:', e); }
  if (!payload) return;
  state.sourcesPayload = payload;

  // Build base tile layers.
  for (const s of payload.base) {
    tileLayers[s.name] = L.tileLayer(s.url, {
      maxZoom: s.max_zoom, attribution: s.attribution || '',
    });
  }

  // Populate the source <select>.
  populateSourceSelect(payload);

  // Splice tile-based overlays into the overlay defs registry.
  const tileDefs = payload.overlays.map(buildTileOverlayDef);
  setOverlayDefs(tileDefs);

  // Default base layer (loadConfig may swap later).
  const first = payload.base[0]?.name;
  if (first && tileLayers[first]) {
    tileLayers[first].addTo(map);
    $source.value = first;
    state.activeBaseLayerName = first;
  }
}

function populateSourceSelect(payload) {
  const buckets = new Map(payload.groups.map(g => [g.key, []]));
  const extras = new Map();
  for (const s of payload.base) {
    if (buckets.has(s.group)) buckets.get(s.group).push(s);
    else {
      if (!extras.has(s.group)) extras.set(s.group, []);
      extras.get(s.group).push(s);
    }
  }
  $source.innerHTML = '';
  const append = (label, labelKey, items) => {
    if (!items.length) return;
    const og = document.createElement('optgroup');
    if (labelKey) og.dataset.i18nLabel = labelKey;
    og.label = labelKey ? t(labelKey) : label;
    for (const s of items) og.appendChild(buildSourceOption(s));
    $source.appendChild(og);
  };
  for (const g of payload.groups) append(g.key, g.label_key, buckets.get(g.key));
  for (const [key, items] of extras) append(key, null, items);
}

function buildSourceOption(s) {
  const opt = document.createElement('option');
  opt.value = s.name;
  if (s.label_key) {
    opt.dataset.i18n = s.label_key;
    opt.textContent = t(s.label_key);
  } else {
    opt.textContent = s.display_name || s.name;
  }
  return opt;
}

// Initial UI render then bootstrap chain.
buildIconColorGrids();
populateOverlayPanel();
renderWaypointList();
setupGpxUI();
setupRouteUI();
initSnap();
initCompassControl();

loadSources()
  .then(() => loadLanguage('en'))
  .then(() => populateOverlayPanel())
  .then(() => loadConfig())
  .then(() => { initMagDisplay(); setTimeout(updateOverlays, 500); });
