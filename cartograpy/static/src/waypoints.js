// ==============================================================
// Waypoints — markers, list, manual / bulk entry, save/load
// ==============================================================
import { map, wpMarkerLayer, $btnWpAddOnMap, $gridType, status,
         closeSidebarMobile, showMobileToolBar, hideMobileToolBar } from './core.js';
import { state, waypoints, WP_ICONS, WP_COLORS, isTouch } from './state.js';
import { t } from './i18n.js';

// Local UI selection (only mutated within this module).
let selectedWpId = null;
let selectedIcon = WP_ICONS[0].fa;
let selectedColor = WP_COLORS[0];

export function getWaypointMapActive() { return state.wpMapActive; }

// ---- Activate / deactivate map-click waypoint mode ----
export function activateWaypoint() {
  state.wpMapActive = true;
  $btnWpAddOnMap.classList.add('active');
  document.getElementById('waypointSection').open = true;
  map.getContainer().style.cursor = 'crosshair';
  map.on('click', _waypointMapClick);
  if (window.innerWidth <= 768 || isTouch) {
    closeSidebarMobile();
    showMobileToolBar();
  }
}

export function deactivateWaypoint() {
  state.wpMapActive = false;
  $btnWpAddOnMap.classList.remove('active');
  map.getContainer().style.cursor = '';
  map.off('click', _waypointMapClick);
  hideMobileToolBar();
}

function _waypointMapClick(e) {
  addWaypoint(e.latlng.lat, e.latlng.lng);
}

// ---- CRUD ----
export function addWaypoint(lat, lng) {
  const wp = { lat, lng, icon: selectedIcon, color: selectedColor, id: Date.now(), name: '' };
  waypoints.push(wp);
  selectedWpId = null;
  renderWaypointMarkers();
  renderWaypointList();
}

export function removeWaypoint(id) {
  const idx = waypoints.findIndex(w => w.id === id);
  if (idx >= 0) waypoints.splice(idx, 1);
  if (selectedWpId === id) selectedWpId = null;
  renderWaypointMarkers();
  renderWaypointList();
}

export function selectWaypoint(id) {
  const wp = waypoints.find(w => w.id === id);
  if (!wp) return;
  if (selectedWpId === id) { deselectWaypoint(); return; }
  selectedWpId = id;
  syncPickersToWp(wp);
  document.getElementById('waypointSection').open = true;
  renderWaypointList();
  const el = document.querySelector(`.wp-item[data-id="${id}"]`);
  if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  status(t('wp.selected'));
}

export function deselectWaypoint() {
  selectedWpId = null;
  renderWaypointList();
}

function syncPickersToWp(wp) {
  selectedIcon = wp.icon;
  selectedColor = wp.color;
  document.querySelectorAll('#iconGrid .icon-opt').forEach(el => {
    const fa = el.querySelector('i').className.replace('fa-solid ', '');
    el.classList.toggle('selected', fa === wp.icon);
  });
  document.querySelectorAll('#colorGrid .color-opt').forEach(el => {
    el.classList.toggle('selected',
      el.style.background === wp.color || rgbToHex(el.style.background) === wp.color);
  });
}

function rgbToHex(rgb) {
  const m = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (!m) return rgb;
  return '#' + [m[1], m[2], m[3]]
    .map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
}

// ---- Rendering ----
export function renderWaypointMarkers() {
  wpMarkerLayer.clearLayers();
  const toolActive = state.activeTool && state.activeTool !== 'waypoint';
  waypoints.forEach(wp => {
    const isSel = wp.id === selectedWpId;
    const size = isSel ? 28 : 22;
    const icon = L.divIcon({
      html: `<i class="fa-solid ${wp.icon}" style="color:${wp.color}; font-size:${size}px;`
          + ` text-shadow:0 1px 3px rgba(0,0,0,.4);`
          + `${isSel ? ' filter:drop-shadow(0 0 4px ' + wp.color + ');' : ''}`
          + `${toolActive ? ' pointer-events:none;' : ''}"></i>`,
      className: '', iconSize: [24, 24], iconAnchor: [12, 22],
    });
    const m = L.marker([wp.lat, wp.lng], { icon, interactive: !toolActive }).addTo(wpMarkerLayer);
    if (!toolActive) m.on('click', () => selectWaypoint(wp.id));
    if (wp.name) {
      m.bindTooltip(wp.name, {
        permanent: true, direction: 'bottom', offset: [0, 4], className: 'wp-label',
      });
    }
  });
}

export function renderWaypointList() {
  const list = document.getElementById('wpList');
  if (!list) return;
  if (!waypoints.length) {
    list.innerHTML = `<div style="color:#94a3b8; font-size:11px;">${t('wp.none')}</div>`;
    return;
  }
  list.innerHTML = waypoints.map(wp =>
    `<div class="wp-item${wp.id === selectedWpId ? ' selected' : ''}" data-id="${wp.id}">
       <i class="fa-solid ${wp.icon}" style="color:${wp.color}; cursor:pointer;"></i>
       <span class="wp-name" contenteditable="true" data-id="${wp.id}" title="${t('wp.rename')}">`
    + `${wp.name || (wp.lat.toFixed(5) + ', ' + wp.lng.toFixed(5))}</span>
       <span class="wp-del" data-id="${wp.id}"><i class="fa-solid fa-xmark"></i></span>
     </div>`
  ).join('');
  list.querySelectorAll('.wp-item > i').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(el.parentElement.dataset.id);
      selectWaypoint(id);
      renderWaypointMarkers();
    });
  });
  list.querySelectorAll('.wp-del').forEach(el => {
    el.addEventListener('click', () => removeWaypoint(parseInt(el.dataset.id)));
  });
  list.querySelectorAll('.wp-name').forEach(el => {
    el.addEventListener('blur', () => {
      const wp = waypoints.find(w => w.id === parseInt(el.dataset.id));
      if (!wp) return;
      const val = el.textContent.trim();
      const coords = wp.lat.toFixed(5) + ', ' + wp.lng.toFixed(5);
      wp.name = (val === coords) ? '' : val;
      renderWaypointMarkers();
      renderWaypointList();
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    });
  });
}

// ---- Manual / bulk coordinate entry ----
export async function manualWpAddAsync() {
  const raw = document.getElementById('wpCoordInput').value.trim();
  if (!raw) return;
  const gridType = $gridType.value;
  try {
    const parseType = (gridType === 'none') ? 'latlon' : gridType;
    const res = await fetch(
      `/api/coord2latlon?grid_type=${encodeURIComponent(parseType)}`
      + `&coords=${encodeURIComponent(raw)}`,
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    addWaypoint(data.lat, data.lon);
    document.getElementById('wpCoordInput').value = '';
    status(`${t('msg.wpAdded')}: ${data.lat.toFixed(5)}, ${data.lon.toFixed(5)}`);
  } catch(e) {
    status(t('msg.coordError') + ': ' + e.message);
  }
}

export async function bulkWpImport() {
  const text = document.getElementById('wpBulkInput').value.trim();
  if (!text) return;
  const lines = text.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
  const gridType = $gridType.value;
  let added = 0, errors = 0;
  for (const line of lines) {
    try {
      const parseType = (gridType === 'none') ? 'latlon' : gridType;
      const res = await fetch(
        `/api/coord2latlon?grid_type=${encodeURIComponent(parseType)}`
        + `&coords=${encodeURIComponent(line)}`,
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      addWaypoint(data.lat, data.lon);
      added++;
    } catch(e) { errors++; }
  }
  document.getElementById('wpBulkInput').value = '';
  const msg = t('msg.wpImported', added) + (errors ? `, ${t('msg.wpErrors', errors)}` : '');
  status(msg);
}

export function clearAllWaypoints() {
  waypoints.length = 0;
  selectedWpId = null;
  renderWaypointMarkers();
  renderWaypointList();
}

// ---- Save / load files ----
export async function saveWpFile() {
  const name = document.getElementById('wpFileName').value.trim();
  if (!name) { alert(t('msg.enterName')); return; }
  const data = waypoints.map(w => ({
    lat: w.lat, lng: w.lng, icon: w.icon, color: w.color, name: w.name || '',
  }));
  try {
    const res = await fetch('/api/waypoints/save', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ name, waypoints: data }),
    });
    const r = await res.json();
    if (r.ok) {
      status(`${t('msg.wpSaved')}: ${name}`);
      document.getElementById('wpFilePanel').style.display = 'none';
      document.getElementById('wpFileName').value = '';
    } else { alert(r.error); }
  } catch(e) { alert(t('msg.saveError')); }
}

export async function refreshWpFileList() {
  const panel = document.getElementById('wpFilePanel');
  const sp = document.getElementById('wpSavePanel');
  const lp = document.getElementById('wpLoadPanel');
  sp.style.display = 'none';
  lp.style.display = '';
  panel.style.display = '';
  const list = document.getElementById('wpFileList');
  list.innerHTML = `<div style="color:#94a3b8; font-size:11px;">${t('status.searching')}</div>`;
  try {
    const res = await fetch('/api/waypoints/list');
    const files = await res.json();
    if (!files.length) {
      list.innerHTML = `<div style="color:#94a3b8; font-size:11px;">${t('wp.noFiles')}</div>`;
      return;
    }
    list.innerHTML = files.map(f =>
      `<div class="wpf-item" data-name="${f}">
         <i class="fa-solid fa-map-location-dot" style="color:#2563eb;"></i>
         <span class="wpf-name">${f}</span>
         <span class="wpf-del" data-name="${f}" title="Elimina"><i class="fa-solid fa-trash"></i></span>
       </div>`
    ).join('');
    list.querySelectorAll('.wpf-item').forEach(el => {
      el.addEventListener('click', async (e) => {
        if (e.target.closest('.wpf-del')) return;
        await loadWpFile(el.dataset.name);
      });
    });
    list.querySelectorAll('.wpf-del').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(t('msg.confirmDelete', el.dataset.name))) return;
        await fetch('/api/waypoints/delete', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ name: el.dataset.name }),
        });
        refreshWpFileList();
      });
    });
  } catch(e) {
    list.innerHTML = `<div style="color:#dc2626; font-size:11px;">${t('msg.error')}</div>`;
  }
}

export async function loadWpFile(name) {
  try {
    const res = await fetch(`/api/waypoints/load?name=${encodeURIComponent(name)}`);
    const data = await res.json();
    if (data.error) { alert(data.error); return; }
    waypoints.length = 0;
    selectedWpId = null;
    data.forEach(w => {
      waypoints.push({
        lat: w.lat, lng: w.lng || w.lon,
        icon: w.icon || 'fa-location-dot',
        color: w.color || '#dc2626',
        name: w.name || '',
        id: Date.now() + Math.random(),
      });
    });
    renderWaypointMarkers();
    renderWaypointList();
    document.getElementById('waypointSection').style.display = '';
    document.getElementById('waypointSection').open = true;
    document.getElementById('wpFilePanel').style.display = 'none';
    status(t('msg.wpLoaded', waypoints.length, name));
    if (waypoints.length) {
      const bounds = L.latLngBounds(waypoints.map(w => [w.lat, w.lng]));
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  } catch(e) { alert(t('msg.loadError')); }
}

// ---- Icon / color grids (built once at startup) ----
export function buildIconColorGrids() {
  const iconGrid = document.getElementById('iconGrid');
  iconGrid.innerHTML = '';
  WP_ICONS.forEach(ic => {
    const d = document.createElement('div');
    d.className = 'icon-opt' + (ic.fa === selectedIcon ? ' selected' : '');
    d.title = t(ic.labelKey);
    d.setAttribute('data-i18n-title', ic.labelKey);
    d.innerHTML = `<i class="fa-solid ${ic.fa}"></i>`;
    d.addEventListener('click', () => {
      iconGrid.querySelectorAll('.icon-opt').forEach(x => x.classList.remove('selected'));
      d.classList.add('selected');
      selectedIcon = ic.fa;
      if (selectedWpId) {
        const wp = waypoints.find(w => w.id === selectedWpId);
        if (wp) { wp.icon = ic.fa; renderWaypointMarkers(); renderWaypointList(); }
      }
    });
    iconGrid.appendChild(d);
  });

  const colorGrid = document.getElementById('colorGrid');
  colorGrid.innerHTML = '';
  WP_COLORS.forEach(c => {
    const d = document.createElement('div');
    d.className = 'color-opt' + (c === selectedColor ? ' selected' : '');
    d.style.background = c;
    d.addEventListener('click', () => {
      colorGrid.querySelectorAll('.color-opt').forEach(x => x.classList.remove('selected'));
      d.classList.add('selected');
      selectedColor = c;
      if (selectedWpId) {
        const wp = waypoints.find(w => w.id === selectedWpId);
        if (wp) { wp.color = c; renderWaypointMarkers(); renderWaypointList(); }
      }
    });
    colorGrid.appendChild(d);
  });
}
