// ==============================================================
// GPX import / export
// ==============================================================
// Wires a hidden file <input> + two buttons (import / export) injected
// into the Waypoints panel. Imported GPX waypoints are merged into the
// current waypoint list; tracks/routes become "line" drawings on the map.
import { map, status } from './core.js';
import { waypoints } from './state.js';
import { t } from './i18n.js';
import { renderWaypointMarkers, renderWaypointList } from './waypoints.js';
import { collectToolData, loadToolData } from './tools.js';

// ---------- Import ----------
async function _importGpxText(text) {
  const res = await fetch('/api/gpx/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export async function importGpxFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const data = await _importGpxText(text);

    // Merge waypoints
    const wAdded = (data.waypoints || []).length;
    (data.waypoints || []).forEach(w => {
      waypoints.push({
        lat: w.lat, lng: w.lng, icon: w.icon, color: w.color,
        name: w.name || '', id: Date.now() + Math.random(),
      });
    });

    // Add tracks as line drawings (so they appear in the line tool history).
    const newLines = (data.drawings || [])
      .filter(d => d.type === 'line' && Array.isArray(d.points) && d.points.length >= 2);
    const tAdded = newLines.length;
    if (tAdded) {
      const merged = collectToolData().concat(newLines);
      loadToolData(merged);
    }

    renderWaypointMarkers();
    renderWaypointList();

    // Fit bounds to the imported geometry.
    const bounds = L.latLngBounds([]);
    (data.waypoints || []).forEach(w => bounds.extend([w.lat, w.lng]));
    (data.drawings || []).forEach(d => (d.points || []).forEach(p => bounds.extend(p)));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40] });

    status(t('gpx.imported', wAdded, tAdded));
  } catch (e) {
    alert(t('gpx.importError') + ': ' + e.message);
  }
}

// ---------- Export ----------
export async function exportGpx() {
  const wps = waypoints.map(w => ({ lat: w.lat, lng: w.lng, name: w.name || '' }));
  // Export line-like drawings as GPX tracks. Other tool shapes (ruler,
  // protractor, compass) don't map cleanly to GPX.
  const drawings = collectToolData()
    .filter(d => d.type === 'line' || d.type === 'route')
    .map((d, i) => ({
      ...d,
      name: d.name || (d.type === 'route' ? `Route ${i + 1}` : `Track ${i + 1}`),
    }));

  if (!wps.length && !drawings.length) {
    alert(t('gpx.nothingToExport'));
    return;
  }

  try {
    const res = await fetch('/api/gpx/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ waypoints: wps, drawings }),
    });
    if (!res.ok) {
      const j = await res.json();
      throw new Error(j.error || 'export failed');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cartograpy_${new Date().toISOString().slice(0, 10)}.gpx`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    status(t('gpx.exported'));
  } catch (e) {
    alert(t('gpx.exportError') + ': ' + e.message);
  }
}

// ---------- UI wiring ----------
export function setupGpxUI() {
  // Inject the GPX row right below the Save/Load buttons row in waypoints.
  const wpFilePanel = document.getElementById('wpFilePanel');
  if (!wpFilePanel) return;

  const row = document.createElement('div');
  row.style.cssText = 'display:flex; gap:4px; margin-top:4px;';
  row.innerHTML = `
    <input type="file" id="gpxFile" accept=".gpx,application/gpx+xml,text/xml"
           style="display:none;">
    <button class="btn btn-sm btn-secondary" id="btnGpxImport" style="flex:1;">
      <i class="fa-solid fa-file-import"></i>
      <span data-i18n="btn.gpxImport">Import GPX</span>
    </button>
    <button class="btn btn-sm btn-secondary" id="btnGpxExport" style="flex:1;">
      <i class="fa-solid fa-file-export"></i>
      <span data-i18n="btn.gpxExport">Export GPX</span>
    </button>
  `;
  wpFilePanel.parentElement.insertBefore(row, wpFilePanel);

  const fileInput = row.querySelector('#gpxFile');
  row.querySelector('#btnGpxImport').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    await importGpxFile(file);
    fileInput.value = '';   // allow re-importing the same file
  });
  row.querySelector('#btnGpxExport').addEventListener('click', exportGpx);
}
