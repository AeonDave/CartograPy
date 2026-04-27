// ==============================================================
// Tools — Ruler, Protractor (Goniometro), Line (Squadra), Compass
// ==============================================================
import { map, $btnRuler, $btnProtractor, $btnLine, $btnCompass, $btnRoute,
         $mobileToolBar, $mtbDone, $mtbUndo, status,
         closeSidebarMobile, showMobileToolBar, hideMobileToolBar } from './core.js';
import { state, TOOL_COLORS, isTouch,
         rulerHistory, protHistory, lineHistory, compassHistory,
         routeHistory } from './state.js';
import { t } from './i18n.js';
import { renderWaypointMarkers, deactivateWaypoint } from './waypoints.js';
import { snapPoint, refreshOsmSnapCache } from './snap.js';
import { activateRoute, deactivateRoute, formatRouteSummary,
         setRouteHistoryRenderer } from './route.js';

// ----------------------------------------------------------------
// Geometry helpers (pure)
// ----------------------------------------------------------------
export function formatDist(m) {
  if (m >= 1000) return (m/1000).toFixed(2) + ' km';
  return m.toFixed(1) + ' m';
}

export function formatArea(m2) {
  if (m2 >= 1e6) return (m2/1e6).toFixed(3) + ' km²';
  if (m2 >= 1e4) return (m2/1e4).toFixed(2) + ' ha';
  return m2.toFixed(1) + ' m²';
}

function bearing(a, b) {
  const dLon = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
          - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function computeAngle(a, vertex, b) {
  const b1 = bearing(vertex, a);
  const b2 = bearing(vertex, b);
  let angle = Math.abs(b2 - b1);
  if (angle > 180) angle = 360 - angle;
  return angle;
}

function drawAngleArc(vertex, p1, p2, angleDeg, color) {
  const r = Math.min(vertex.distanceTo(p1), vertex.distanceTo(p2), 50000) * 0.25;
  const b1 = bearing(vertex, p1);
  const b2 = bearing(vertex, p2);
  let start = b1, end = b2;
  let diff = (end - start + 360) % 360;
  if (diff > 180) { start = b2; diff = 360 - diff; }
  const pts = [];
  const steps = Math.max(20, Math.round(diff));
  for (let i = 0; i <= steps; i++) {
    const a = (start + diff * i / steps) * Math.PI / 180;
    const dLat = r * Math.cos(a) / 111320;
    const dLon = r * Math.sin(a) / (111320 * Math.cos(vertex.lat * Math.PI / 180));
    pts.push([vertex.lat + dLat, vertex.lng + dLon]);
  }
  return L.polyline(pts, { color, weight: 2, dashArray: '4 3' }).addTo(map);
}

// Snap a click to the nearest waypoint or OSM feature within SNAP_PX
// pixels (when the corresponding checkbox is enabled). The actual snap
// logic lives in ``snap.js``; this thin wrapper is kept so the existing
// call sites read naturally.
function snapToWaypoint(latlng) {
  return snapPoint(latlng);
}

// ----------------------------------------------------------------
// Tool history rendering
// ----------------------------------------------------------------
export function renderToolHistory(toolName, histArr, color) {
  const container = document.getElementById(toolName + 'History');
  container.innerHTML = '';
  histArr.forEach((entry, i) => {
    const row = document.createElement('div');
    row.className = 'tool-hist-row';
    row.style.color = color;
    row.style.flexWrap = 'wrap';
    const txt = document.createElement('span');
    txt.className = 'tool-hist-text';
    txt.textContent = `#${i + 1}  ${entry.text}`;
    txt.title = t('msg.clickToCenter');
    txt.addEventListener('click', () => {
      const fg = L.featureGroup(entry.layers);
      try { map.fitBounds(fg.getBounds().pad(0.2)); } catch(e) {}
    });
    // Elevation profile button — only for line-shaped tools (ruler, line, route).
    let elev = null;
    if (toolName === 'ruler' || toolName === 'line' || toolName === 'route') {
      elev = document.createElement('span');
      elev.className = 'tool-hist-elev';
      elev.innerHTML = `<i class="fa-solid fa-mountain"></i><span>${t('elev.button')}</span>`;
      elev.title = t('elev.show');
      elev.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const pts = (entry.data && entry.data.points) || [];
        const { showElevationProfile } = await import('./elevation.js');
        showElevationProfile(row, pts);
      });
    }
    const del = document.createElement('span');
    del.className = 'tool-hist-del';
    del.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    del.title = t('msg.delete');
    del.addEventListener('click', () => {
      entry.layers.forEach(l => { try { map.removeLayer(l); } catch(e) {} });
      histArr.splice(i, 1);
      renderToolHistory(toolName, histArr, color);
    });
    row.appendChild(txt);
    if (elev) row.appendChild(elev);
    row.appendChild(del);
    container.appendChild(row);
  });
  const sep = document.getElementById('toolHistorySep');
  const hasAny = rulerHistory.length || protHistory.length
               || lineHistory.length || compassHistory.length
               || routeHistory.length;
  sep.style.display = hasAny ? '' : 'none';
  updateLineUndoBtn();
}

export function renderAllToolHistories() {
  renderToolHistory('ruler', rulerHistory, TOOL_COLORS.ruler);
  renderToolHistory('protractor', protHistory, TOOL_COLORS.protractor);
  renderToolHistory('line', lineHistory, TOOL_COLORS.line);
  renderToolHistory('compass', compassHistory, TOOL_COLORS.compass);
  renderToolHistory('route', routeHistory, TOOL_COLORS.route);
}

// Restore a single serialized tool entry on the map.
function restoreToolEntry(d) {
  const color = TOOL_COLORS[d.type];
  if (!color) return;
  const layers = [];
  if (d.type === 'ruler') {
    const pts = d.points.map(p => L.latLng(p[0], p[1]));
    pts.forEach(p => layers.push(L.circleMarker(p,
      { radius: 4, color, fillColor: color, fillOpacity: 1 }).addTo(map)));
    layers.push(L.polyline(pts, { color, weight: 2.5 }).addTo(map));
    const dist = pts[0].distanceTo(pts[1]);
    const txt = formatDist(dist);
    const midLat = (pts[0].lat + pts[1].lat) / 2, midLng = (pts[0].lng + pts[1].lng) / 2;
    layers.push(L.marker([midLat, midLng], { interactive: false, icon: L.divIcon({
      className: 'ruler-label',
      html: `<span style="background:rgba(255,255,255,0.9);color:${color};font-weight:bold;`
          + `font-size:12px;padding:2px 6px;border-radius:3px;white-space:nowrap;`
          + `pointer-events:none">${txt}</span>`,
      iconAnchor: [0, 12],
    }) }).addTo(map));
    rulerHistory.push({ layers, text: txt, data: d });
  } else if (d.type === 'protractor') {
    const pts = d.points.map(p => L.latLng(p[0], p[1]));
    pts.forEach(p => layers.push(L.circleMarker(p,
      { radius: 4, color, fillColor: color, fillOpacity: 1 }).addTo(map)));
    layers.push(L.polyline([pts[0], pts[1]], { color, weight: 2 }).addTo(map));
    layers.push(L.polyline([pts[1], pts[2]], { color, weight: 2 }).addTo(map));
    const angle = computeAngle(pts[0], pts[1], pts[2]);
    const arc = drawAngleArc(pts[1], pts[0], pts[2], angle, color);
    if (arc) layers.push(arc);
    const txt = `${angle.toFixed(1)}°`;
    layers.push(L.marker([pts[1].lat, pts[1].lng], { interactive: false, icon: L.divIcon({
      className: 'prot-label',
      html: `<span style="background:rgba(255,255,255,0.9);color:${color};font-weight:bold;`
          + `font-size:12px;padding:2px 6px;border-radius:3px;white-space:nowrap;`
          + `pointer-events:none">${txt}</span>`,
      iconAnchor: [-8, 12],
    }) }).addTo(map));
    const d1 = pts[1].distanceTo(pts[0]), d2 = pts[1].distanceTo(pts[2]);
    protHistory.push({
      layers,
      text: `${txt} (${formatDist(d1)} / ${formatDist(d2)})`,
      data: d,
    });
  } else if (d.type === 'line') {
    const pts = d.points.map(p => L.latLng(p[0], p[1]));
    const segLayers = [], segLabels = [];
    pts.forEach(p => layers.push(L.circleMarker(p,
      { radius: 4, color, fillColor: color, fillOpacity: 1 }).addTo(map)));
    for (let i = 1; i < pts.length; i++) {
      segLayers.push(L.polyline([pts[i - 1], pts[i]], { color, weight: 2.5 }).addTo(map));
      const sd = pts[i - 1].distanceTo(pts[i]);
      const ml = (pts[i - 1].lat + pts[i].lat) / 2;
      const mg = (pts[i - 1].lng + pts[i].lng) / 2;
      segLabels.push(L.marker([ml, mg], { interactive: false, icon: L.divIcon({
        className: 'line-label',
        html: `<span style="background:rgba(255,255,255,0.9);color:${color};font-weight:bold;`
            + `font-size:11px;padding:1px 5px;border-radius:3px;white-space:nowrap;`
            + `pointer-events:none">${formatDist(sd)}</span>`,
        iconAnchor: [0, 12],
      }) }).addTo(map));
    }
    layers.push(...segLayers, ...segLabels);
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += pts[i - 1].distanceTo(pts[i]);
    const txt = `${pts.length} pt — ${formatDist(total)}`;
    lineHistory.push({ layers, text: txt, data: d });
  } else if (d.type === 'compass') {
    const center = L.latLng(d.center[0], d.center[1]);
    const edge = L.latLng(d.edge[0], d.edge[1]);
    const r = center.distanceTo(edge);
    layers.push(L.circleMarker(center,
      { radius: 5, color, fillColor: color, fillOpacity: 1 }).addTo(map));
    layers.push(L.circle(center, {
      radius: r, color, weight: 2.5, fill: true,
      fillColor: color, fillOpacity: 0.08,
    }).addTo(map));
    layers.push(L.polyline([center, edge], { color, weight: 2 }).addTo(map));
    layers.push(L.circleMarker(edge,
      { radius: 4, color, fillColor: color, fillOpacity: 1 }).addTo(map));
    const midLat = (center.lat + edge.lat) / 2, midLng = (center.lng + edge.lng) / 2;
    layers.push(L.marker([midLat, midLng], { interactive: false, icon: L.divIcon({
      className: 'compass-label',
      html: `<span style="background:rgba(255,255,255,0.9);color:${color};font-weight:bold;`
          + `font-size:12px;padding:2px 6px;border-radius:3px;white-space:nowrap;`
          + `pointer-events:none">r = ${formatDist(r)}</span>`,
      iconAnchor: [0, 12],
    }) }).addTo(map));
    const area = Math.PI * r * r;
    const shortTxt = `r=${formatDist(r)} A=${formatArea(area)}`;
    compassHistory.push({ layers, text: shortTxt, data: d });
  } else if (d.type === 'route') {
    if (!Array.isArray(d.points) || d.points.length < 2) return;
    const pts = d.points.map(p => L.latLng(p[0], p[1]));
    layers.push(L.polyline(pts, { color, weight: 4, opacity: 0.85 }).addTo(map));
    routeHistory.push({ layers, text: formatRouteSummary(d), data: d });
  }
}

export function collectToolData() {
  const all = [];
  rulerHistory.forEach(e => { if (e.data) all.push(e.data); });
  protHistory.forEach(e => { if (e.data) all.push(e.data); });
  lineHistory.forEach(e => { if (e.data) all.push(e.data); });
  compassHistory.forEach(e => { if (e.data) all.push(e.data); });
  routeHistory.forEach(e => { if (e.data) all.push(e.data); });
  return all;
}

export function clearAllTools() {
  [rulerHistory, protHistory, lineHistory, compassHistory, routeHistory].forEach(arr => {
    arr.forEach(e => e.layers.forEach(l => { try { map.removeLayer(l); } catch(x){} }));
    arr.length = 0;
  });
  renderAllToolHistories();
}

export function loadToolData(dataArr) {
  clearAllTools();
  dataArr.forEach(d => restoreToolEntry(d));
  renderAllToolHistories();
}

// ----------------------------------------------------------------
// RULER
// ----------------------------------------------------------------
let rulerPoints = [], rulerMarkers = [];
let rulerLine = null, rulerMoveHandler = null;
let rulerTempLine = null, rulerLabel = null, rulerLiveDist = null;

function activateRuler() {
  document.getElementById('rulerInfo').style.display = 'block';
  document.getElementById('rulerResult').textContent = '';
  if (isTouch) {
    const el = document.querySelector('#rulerInfo [data-i18n="tool.ruler.info"]');
    if (el) el.textContent = t('tool.ruler.infoTouch');
  }
  map.getContainer().classList.add('ruler-cursor');
  map.on('click', rulerClick);
  refreshOsmSnapCache(false);
}

function deactivateRuler() {
  document.getElementById('rulerInfo').style.display = 'none';
  map.getContainer().classList.remove('ruler-cursor');
  map.off('click', rulerClick);
  resetRulerDraw();
}

function rulerClick(e) {
  if (rulerPoints.length >= 2) resetRulerDraw();
  const pt = snapToWaypoint(e.latlng);
  rulerPoints.push(pt);
  const color = TOOL_COLORS.ruler;
  rulerMarkers.push(L.circleMarker(pt,
    { radius: 5, color, fillColor: color, fillOpacity: 1 }).addTo(map));

  if (rulerPoints.length === 1) {
    rulerTempLine = L.polyline([pt, pt], { color, weight: 2, dashArray: '6 4' }).addTo(map);
    rulerMoveHandler = (ev) => {
      const sp = snapToWaypoint(ev.latlng);
      rulerTempLine.setLatLngs([rulerPoints[0], sp]);
      const d = rulerPoints[0].distanceTo(sp);
      if (rulerLiveDist) map.removeLayer(rulerLiveDist);
      const mLat = (rulerPoints[0].lat + sp.lat) / 2;
      const mLng = (rulerPoints[0].lng + sp.lng) / 2;
      rulerLiveDist = L.marker([mLat, mLng], { interactive: false, icon: L.divIcon({
        className: 'ruler-label',
        html: `<span style="background:rgba(255,255,255,0.85);color:#dc2626;font-weight:bold;`
            + `font-size:12px;padding:1px 5px;border-radius:3px;white-space:nowrap;`
            + `pointer-events:none">${formatDist(d)}</span>`,
        iconAnchor: [0, 12],
      }) }).addTo(map);
      status(`${t('msg.distance')}: ${formatDist(d)} — ${t('msg.clickEndPoint')}`);
    };
    map.on('mousemove', rulerMoveHandler);
  }

  if (rulerPoints.length === 2) {
    if (rulerTempLine) { map.removeLayer(rulerTempLine); rulerTempLine = null; }
    if (rulerMoveHandler) { map.off('mousemove', rulerMoveHandler); rulerMoveHandler = null; }
    if (rulerLiveDist) { map.removeLayer(rulerLiveDist); rulerLiveDist = null; }
    rulerLine = L.polyline(rulerPoints, { color, weight: 2.5 }).addTo(map);
    const dist = rulerPoints[0].distanceTo(rulerPoints[1]);
    const txt = formatDist(dist);
    const midLat = (rulerPoints[0].lat + rulerPoints[1].lat) / 2;
    const midLng = (rulerPoints[0].lng + rulerPoints[1].lng) / 2;
    rulerLabel = L.marker([midLat, midLng], { interactive: false, icon: L.divIcon({
      className: 'ruler-label',
      html: `<span style="background:rgba(255,255,255,0.9);color:#dc2626;font-weight:bold;`
          + `font-size:12px;padding:2px 6px;border-radius:3px;white-space:nowrap;`
          + `pointer-events:none">${txt}</span>`,
      iconAnchor: [0, 12],
    }) }).addTo(map);
    document.getElementById('rulerResult').textContent = txt;
    status(`${t('msg.measuredDistance')}: ${txt}`);
    rulerHistory.push({
      layers: [...rulerMarkers, rulerLine, rulerLabel],
      text: txt,
      data: { type: 'ruler', points: rulerPoints.map(p => [p.lat, p.lng]) },
    });
    rulerMarkers = []; rulerLine = null; rulerLabel = null; rulerPoints = [];
    renderToolHistory('ruler', rulerHistory, TOOL_COLORS.ruler);
  }
}

function resetRulerDraw() {
  rulerMarkers.forEach(m => map.removeLayer(m));
  rulerMarkers = []; rulerPoints = [];
  if (rulerLine) { map.removeLayer(rulerLine); rulerLine = null; }
  if (rulerTempLine) { map.removeLayer(rulerTempLine); rulerTempLine = null; }
  if (rulerMoveHandler) { map.off('mousemove', rulerMoveHandler); rulerMoveHandler = null; }
  if (rulerLabel) { map.removeLayer(rulerLabel); rulerLabel = null; }
  if (rulerLiveDist) { map.removeLayer(rulerLiveDist); rulerLiveDist = null; }
  document.getElementById('rulerResult').textContent = '';
}

// ----------------------------------------------------------------
// PROTRACTOR
// ----------------------------------------------------------------
let protPoints = [], protMarkers = [], protLines = [];
let protArc = null, protLabel = null;
let protArm1Label = null, protArm2Label = null;
let protMoveHandler = null, protTempLine = null;

function activateProtractor() {
  document.getElementById('protractorInfo').style.display = 'block';
  document.getElementById('protractorResult').textContent = '';
  if (isTouch) {
    const el = document.querySelector('#protractorInfo [data-i18n="tool.protractor.info"]');
    if (el) el.textContent = t('tool.protractor.infoTouch');
  }
  map.getContainer().classList.add('ruler-cursor');
  map.on('click', protractorClick);
  refreshOsmSnapCache(false);
}

function deactivateProtractor() {
  document.getElementById('protractorInfo').style.display = 'none';
  map.getContainer().classList.remove('ruler-cursor');
  map.off('click', protractorClick);
  resetProtDraw();
}

function protractorClick(e) {
  if (protPoints.length >= 3) resetProtDraw();
  const pt = snapToWaypoint(e.latlng);
  protPoints.push(pt);
  const color = TOOL_COLORS.protractor;
  protMarkers.push(L.circleMarker(pt,
    { radius: 5, color, fillColor: color, fillOpacity: 1 }).addTo(map));

  if (protPoints.length === 1) {
    protTempLine = L.polyline([pt, pt], { color, weight: 2, dashArray: '6 4' }).addTo(map);
    protMoveHandler = (ev) => {
      const sp = snapToWaypoint(ev.latlng);
      protTempLine.setLatLngs([protPoints[0], sp]);
      status(t('msg.protClickVertex'));
    };
    map.on('mousemove', protMoveHandler);
  }

  if (protPoints.length === 2) {
    if (protTempLine) { map.removeLayer(protTempLine); protTempLine = null; }
    if (protMoveHandler) { map.off('mousemove', protMoveHandler); protMoveHandler = null; }
    protLines.push(L.polyline([protPoints[0], protPoints[1]], { color, weight: 2.5 }).addTo(map));
    protTempLine = L.polyline([protPoints[1], protPoints[1]],
      { color, weight: 2, dashArray: '6 4' }).addTo(map);
    protMoveHandler = (ev) => {
      const sp = snapToWaypoint(ev.latlng);
      protTempLine.setLatLngs([protPoints[1], sp]);
      const angle = computeAngle(protPoints[0], protPoints[1], sp);
      if (protLabel) map.removeLayer(protLabel);
      protLabel = L.marker([protPoints[1].lat, protPoints[1].lng],
        { interactive: false, icon: L.divIcon({
          className: 'prot-label',
          html: `<span style="background:rgba(255,255,255,0.85);color:#7c3aed;font-weight:bold;`
              + `font-size:12px;padding:1px 5px;border-radius:3px;white-space:nowrap;`
              + `pointer-events:none">${angle.toFixed(1)}°</span>`,
          iconAnchor: [-8, 12],
        }) }).addTo(map);
      status(`${t('msg.angle')}: ${angle.toFixed(1)}° — ${t('msg.clickToFix')}`);
    };
    map.on('mousemove', protMoveHandler);
  }

  if (protPoints.length === 3) {
    if (protTempLine) { map.removeLayer(protTempLine); protTempLine = null; }
    if (protMoveHandler) { map.off('mousemove', protMoveHandler); protMoveHandler = null; }
    protLines.push(L.polyline([protPoints[1], protPoints[2]], { color, weight: 2.5 }).addTo(map));
    const angle = computeAngle(protPoints[0], protPoints[1], protPoints[2]);
    protArc = drawAngleArc(protPoints[1], protPoints[0], protPoints[2], angle, color);
    const txt = `${angle.toFixed(1)}°`;
    document.getElementById('protractorResult').textContent = txt;
    const d1 = protPoints[1].distanceTo(protPoints[0]);
    const d2 = protPoints[1].distanceTo(protPoints[2]);
    if (protLabel) map.removeLayer(protLabel);
    protLabel = L.marker([protPoints[1].lat, protPoints[1].lng],
      { interactive: false, icon: L.divIcon({
        className: 'prot-label',
        html: `<span style="background:rgba(255,255,255,0.9);color:#7c3aed;font-weight:bold;`
            + `font-size:12px;padding:2px 6px;border-radius:3px;white-space:nowrap;`
            + `pointer-events:none">${txt}</span>`,
        iconAnchor: [-8, 12],
      }) }).addTo(map);
    const mid1Lat = (protPoints[0].lat + protPoints[1].lat) / 2;
    const mid1Lng = (protPoints[0].lng + protPoints[1].lng) / 2;
    protArm1Label = L.marker([mid1Lat, mid1Lng], { interactive: false, icon: L.divIcon({
      className: 'prot-label',
      html: `<span style="background:rgba(255,255,255,0.9);color:#7c3aed;font-weight:bold;`
          + `font-size:11px;padding:1px 5px;border-radius:3px;white-space:nowrap;`
          + `pointer-events:none">${formatDist(d1)}</span>`,
      iconAnchor: [0, 12],
    }) }).addTo(map);
    const mid2Lat = (protPoints[1].lat + protPoints[2].lat) / 2;
    const mid2Lng = (protPoints[1].lng + protPoints[2].lng) / 2;
    protArm2Label = L.marker([mid2Lat, mid2Lng], { interactive: false, icon: L.divIcon({
      className: 'prot-label',
      html: `<span style="background:rgba(255,255,255,0.9);color:#7c3aed;font-weight:bold;`
          + `font-size:11px;padding:1px 5px;border-radius:3px;white-space:nowrap;`
          + `pointer-events:none">${formatDist(d2)}</span>`,
      iconAnchor: [0, 12],
    }) }).addTo(map);
    status(`${t('msg.measuredAngle')}: ${txt}  |  ${t('msg.arm')} 1: ${formatDist(d1)}`
         + `  |  ${t('msg.arm')} 2: ${formatDist(d2)}`);
    const allLayers = [...protMarkers, ...protLines];
    if (protArc) allLayers.push(protArc);
    if (protLabel) allLayers.push(protLabel);
    if (protArm1Label) allLayers.push(protArm1Label);
    if (protArm2Label) allLayers.push(protArm2Label);
    protHistory.push({
      layers: allLayers,
      text: `${txt} (${formatDist(d1)} / ${formatDist(d2)})`,
      data: { type: 'protractor', points: protPoints.map(p => [p.lat, p.lng]) },
    });
    protMarkers = []; protLines = []; protArc = null; protLabel = null;
    protArm1Label = null; protArm2Label = null; protPoints = [];
    renderToolHistory('protractor', protHistory, TOOL_COLORS.protractor);
  }
}

function resetProtDraw() {
  protMarkers.forEach(m => map.removeLayer(m)); protMarkers = [];
  protLines.forEach(l => map.removeLayer(l)); protLines = [];
  if (protArc) { map.removeLayer(protArc); protArc = null; }
  if (protLabel) { map.removeLayer(protLabel); protLabel = null; }
  if (protArm1Label) { map.removeLayer(protArm1Label); protArm1Label = null; }
  if (protArm2Label) { map.removeLayer(protArm2Label); protArm2Label = null; }
  if (protTempLine) { map.removeLayer(protTempLine); protTempLine = null; }
  if (protMoveHandler) { map.off('mousemove', protMoveHandler); protMoveHandler = null; }
  protPoints = [];
  document.getElementById('protractorResult').textContent = '';
}

// ----------------------------------------------------------------
// LINE (Squadra)
// ----------------------------------------------------------------
let linePoints = [], lineMarkers = [], lineSegments = [], lineSegLabels = [];
let lineMoveHandler = null, lineTempLine = null, lineLiveDist = null;

function activateLine() {
  if (linePoints.length >= 2) { lineFinish(); return; }
  document.getElementById('lineInfo').style.display = 'block';
  document.getElementById('lineResult').textContent = '';
  if (isTouch) {
    const el = document.querySelector('#lineInfo [data-i18n="tool.line.info"]');
    if (el) el.textContent = t('tool.line.infoTouch');
  }
  map.getContainer().classList.add('ruler-cursor');
  map.on('click', lineClick);
  map.on('dblclick', lineFinish);
  map.on('contextmenu', lineFinishRight);
  refreshOsmSnapCache(false);
}

function deactivateLine() {
  if (linePoints.length >= 2) lineFinish();
  document.getElementById('lineInfo').style.display = 'none';
  map.getContainer().classList.remove('ruler-cursor');
  map.off('click', lineClick);
  map.off('dblclick', lineFinish);
  map.off('contextmenu', lineFinishRight);
  resetLineDraw();
}

function lineClick(e) {
  const color = TOOL_COLORS.line;
  const pt = snapToWaypoint(e.latlng);
  linePoints.push(pt);
  lineMarkers.push(L.circleMarker(pt,
    { radius: 4, color, fillColor: color, fillOpacity: 1 }).addTo(map));

  if (linePoints.length > 1) {
    const prev = linePoints[linePoints.length - 2];
    lineSegments.push(L.polyline([prev, pt], { color, weight: 2.5 }).addTo(map));
    const segDist = prev.distanceTo(pt);
    const midLat = (prev.lat + pt.lat) / 2;
    const midLng = (prev.lng + pt.lng) / 2;
    lineSegLabels.push(L.marker([midLat, midLng],
      { interactive: false, icon: L.divIcon({
        className: 'line-label',
        html: `<span style="background:rgba(255,255,255,0.9);color:#0891b2;font-weight:bold;`
            + `font-size:11px;padding:1px 5px;border-radius:3px;white-space:nowrap;`
            + `pointer-events:none">${formatDist(segDist)}</span>`,
        iconAnchor: [0, 12],
      }) }).addTo(map));
    if (lineTempLine) { map.removeLayer(lineTempLine); lineTempLine = null; }
    if (lineMoveHandler) { map.off('mousemove', lineMoveHandler); lineMoveHandler = null; }
  }

  lineTempLine = L.polyline([pt, pt], { color, weight: 2, dashArray: '6 4' }).addTo(map);
  lineMoveHandler = (ev) => {
    const sp = snapToWaypoint(ev.latlng);
    lineTempLine.setLatLngs([linePoints[linePoints.length - 1], sp]);
    const segDist = linePoints[linePoints.length - 1].distanceTo(sp);
    const totalDist = lineTotalDist() + segDist;
    if (lineLiveDist) map.removeLayer(lineLiveDist);
    const mLat = (linePoints[linePoints.length - 1].lat + sp.lat) / 2;
    const mLng = (linePoints[linePoints.length - 1].lng + sp.lng) / 2;
    lineLiveDist = L.marker([mLat, mLng], { interactive: false, icon: L.divIcon({
      className: 'line-label',
      html: `<span style="background:rgba(255,255,255,0.85);color:#0891b2;font-weight:bold;`
          + `font-size:11px;padding:1px 5px;border-radius:3px;white-space:nowrap;`
          + `pointer-events:none">${formatDist(segDist)}</span>`,
      iconAnchor: [0, 12],
    }) }).addTo(map);
    let info = `${t('msg.segment')}: ${formatDist(segDist)} | `
             + `${t('msg.total')}: ${formatDist(totalDist)}`;
    if (linePoints.length >= 2) {
      const prev = linePoints[linePoints.length - 2];
      const cur = linePoints[linePoints.length - 1];
      const angle = computeAngle(prev, cur, sp);
      info += ` | ${t('msg.angle')}: ${angle.toFixed(1)}°`;
    }
    info += ` — ${t('msg.rightClickFinish')}`;
    status(info);
  };
  map.on('mousemove', lineMoveHandler);

  updateLineResult();
  updateLineUndoBtn();
  updateMobileToolBar();
}

function lineFinishRight(e) {
  if (e && e.originalEvent) e.originalEvent.preventDefault();
  lineFinish();
}

function lineFinish() {
  if (lineTempLine) { map.removeLayer(lineTempLine); lineTempLine = null; }
  if (lineMoveHandler) { map.off('mousemove', lineMoveHandler); lineMoveHandler = null; }
  if (lineLiveDist) { map.removeLayer(lineLiveDist); lineLiveDist = null; }
  if (linePoints.length >= 2) {
    const txt = `${linePoints.length} pt — ${formatDist(lineTotalDist())}`;
    updateLineResult();
    status(`${t('msg.trackComplete')}: ${linePoints.length} ${t('msg.points')},`
         + ` ${formatDist(lineTotalDist())}`);
    lineHistory.push({
      layers: [...lineMarkers, ...lineSegments, ...lineSegLabels],
      text: txt,
      data: { type: 'line', points: linePoints.map(p => [p.lat, p.lng]) },
    });
    lineMarkers = []; lineSegments = []; lineSegLabels = []; linePoints = [];
    renderToolHistory('line', lineHistory, TOOL_COLORS.line);
  }
  updateMobileToolBar();
}

function lineTotalDist() {
  let total = 0;
  for (let i = 1; i < linePoints.length; i++) total += linePoints[i - 1].distanceTo(linePoints[i]);
  return total;
}

function updateLineResult() {
  const el = document.getElementById('lineResult');
  if (linePoints.length < 2) { el.textContent = ''; return; }
  let txt = `${linePoints.length} ${t('msg.points')} — `
          + `${t('msg.total')}: ${formatDist(lineTotalDist())}`;
  const parts = [];
  for (let i = 1; i < linePoints.length; i++) {
    parts.push(formatDist(linePoints[i - 1].distanceTo(linePoints[i])));
  }
  txt += `\n${t('msg.segments')}: ${parts.join(' → ')}`;
  if (linePoints.length >= 3) {
    const angles = [];
    for (let i = 1; i < linePoints.length - 1; i++) {
      angles.push(
        computeAngle(linePoints[i - 1], linePoints[i], linePoints[i + 1]).toFixed(1) + '°',
      );
    }
    txt += `\n${t('msg.angles')}: ${angles.join(', ')}`;
  }
  el.textContent = txt;
}

function updateLineUndoBtn() {
  const btn = document.getElementById('btnLineUndo');
  if (!btn) return;
  btn.style.display = (linePoints.length || lineHistory.length) ? '' : 'none';
}

export function lineUndo() {
  if (linePoints.length) {
    linePoints.pop();
    if (lineMarkers.length) map.removeLayer(lineMarkers.pop());
    if (lineSegments.length) map.removeLayer(lineSegments.pop());
    if (lineSegLabels.length) map.removeLayer(lineSegLabels.pop());
    if (lineTempLine) { map.removeLayer(lineTempLine); lineTempLine = null; }
    if (lineMoveHandler) { map.off('mousemove', lineMoveHandler); lineMoveHandler = null; }
    if (lineLiveDist) { map.removeLayer(lineLiveDist); lineLiveDist = null; }
    if (linePoints.length) {
      const color = TOOL_COLORS.line;
      const lastPt = linePoints[linePoints.length - 1];
      lineTempLine = L.polyline([lastPt, lastPt],
        { color, weight: 2, dashArray: '6 4' }).addTo(map);
      lineMoveHandler = (ev) => {
        const sp = snapToWaypoint(ev.latlng);
        lineTempLine.setLatLngs([linePoints[linePoints.length - 1], sp]);
        const segDist = linePoints[linePoints.length - 1].distanceTo(sp);
        const totalDist = lineTotalDist() + segDist;
        if (lineLiveDist) map.removeLayer(lineLiveDist);
        const mLat = (linePoints[linePoints.length - 1].lat + sp.lat) / 2;
        const mLng = (linePoints[linePoints.length - 1].lng + sp.lng) / 2;
        lineLiveDist = L.marker([mLat, mLng], { interactive: false, icon: L.divIcon({
          className: 'line-label',
          html: `<span style="background:rgba(255,255,255,0.85);color:#0891b2;font-weight:bold;`
              + `font-size:11px;padding:1px 5px;border-radius:3px;white-space:nowrap;`
              + `pointer-events:none">${formatDist(segDist)}</span>`,
          iconAnchor: [0, 12],
        }) }).addTo(map);
        let info = `${t('msg.segment')}: ${formatDist(segDist)} | `
                 + `${t('msg.total')}: ${formatDist(totalDist)}`;
        if (linePoints.length >= 2) {
          const prev = linePoints[linePoints.length - 2];
          const cur = linePoints[linePoints.length - 1];
          const angle = computeAngle(prev, cur, sp);
          info += ` | ${t('msg.angle')}: ${angle.toFixed(1)}°`;
        }
        info += ` — ${t('msg.rightClickFinish')}`;
        status(info);
      };
      map.on('mousemove', lineMoveHandler);
    }
    updateLineResult();
  } else if (lineHistory.length) {
    const last = lineHistory.pop();
    last.layers.forEach(l => { try { map.removeLayer(l); } catch(e) {} });
    const pts = last.data.points;
    pts.pop();
    if (pts.length >= 2) {
      const color = TOOL_COLORS.line;
      const markers = [], segs = [], labels = [];
      for (let i = 0; i < pts.length; i++) {
        markers.push(L.circleMarker(pts[i],
          { radius: 4, color, fillColor: color, fillOpacity: 1 }).addTo(map));
        if (i > 0) {
          segs.push(L.polyline([pts[i - 1], pts[i]],
            { color, weight: 2.5 }).addTo(map));
          const d = L.latLng(pts[i - 1]).distanceTo(L.latLng(pts[i]));
          const mLat = (pts[i - 1][0] + pts[i][0]) / 2;
          const mLng = (pts[i - 1][1] + pts[i][1]) / 2;
          labels.push(L.marker([mLat, mLng], { interactive: false, icon: L.divIcon({
            className: 'line-label',
            html: `<span style="background:rgba(255,255,255,0.9);color:#0891b2;font-weight:bold;`
                + `font-size:11px;padding:1px 5px;border-radius:3px;white-space:nowrap;`
                + `pointer-events:none">${formatDist(d)}</span>`,
            iconAnchor: [0, 12],
          }) }).addTo(map));
        }
      }
      let total = 0;
      for (let i = 1; i < pts.length; i++) {
        total += L.latLng(pts[i - 1]).distanceTo(L.latLng(pts[i]));
      }
      const txt = `${pts.length} pt — ${formatDist(total)}`;
      lineHistory.push({
        layers: [...markers, ...segs, ...labels],
        text: txt,
        data: { type: 'line', points: pts },
      });
    }
    renderToolHistory('line', lineHistory, TOOL_COLORS.line);
  }
  updateLineUndoBtn();
  updateMobileToolBar();
}

function resetLineDraw() {
  lineMarkers.forEach(m => map.removeLayer(m)); lineMarkers = [];
  lineSegments.forEach(s => map.removeLayer(s)); lineSegments = [];
  lineSegLabels.forEach(l => map.removeLayer(l)); lineSegLabels = [];
  if (lineTempLine) { map.removeLayer(lineTempLine); lineTempLine = null; }
  if (lineMoveHandler) { map.off('mousemove', lineMoveHandler); lineMoveHandler = null; }
  if (lineLiveDist) { map.removeLayer(lineLiveDist); lineLiveDist = null; }
  linePoints = [];
  document.getElementById('lineResult').textContent = '';
}

// ----------------------------------------------------------------
// COMPASS
// ----------------------------------------------------------------
let compassCenter = null, compassCenterMarker = null;
let compassCircle = null, compassRadiusLine = null;
let compassMoveHandler = null, compassFixed = false;
let compassRadiusLabel = null, compassCircumfLabel = null, compassAreaLabel = null;

function activateCompass() {
  document.getElementById('compassInfo').style.display = 'block';
  document.getElementById('compassResult').textContent = '';
  if (isTouch) {
    const el = document.querySelector('#compassInfo [data-i18n="tool.compass.info"]');
    if (el) el.textContent = t('tool.compass.infoTouch');
  }
  compassFixed = false;
  map.getContainer().classList.add('ruler-cursor');
  map.on('click', compassClick);
  refreshOsmSnapCache(false);
}

function deactivateCompass() {
  document.getElementById('compassInfo').style.display = 'none';
  map.getContainer().classList.remove('ruler-cursor');
  map.off('click', compassClick);
  resetCompassDraw();
}

function compassClick(e) {
  const color = TOOL_COLORS.compass;
  if (!compassCenter) {
    const pt = snapToWaypoint(e.latlng);
    compassCenter = pt;
    compassCenterMarker = L.circleMarker(pt,
      { radius: 5, color, fillColor: color, fillOpacity: 1 }).addTo(map);
    compassMoveHandler = (ev) => {
      const sp = snapToWaypoint(ev.latlng);
      const r = compassCenter.distanceTo(sp);
      if (compassCircle) map.removeLayer(compassCircle);
      if (compassRadiusLine) map.removeLayer(compassRadiusLine);
      if (compassRadiusLabel) map.removeLayer(compassRadiusLabel);
      compassCircle = L.circle(compassCenter, {
        radius: r, color, weight: 2, fill: true,
        fillColor: color, fillOpacity: 0.08,
      }).addTo(map);
      compassRadiusLine = L.polyline([compassCenter, sp],
        { color, weight: 2, dashArray: '6 4' }).addTo(map);
      const midLat = (compassCenter.lat + sp.lat) / 2;
      const midLng = (compassCenter.lng + sp.lng) / 2;
      compassRadiusLabel = L.marker([midLat, midLng],
        { interactive: false, icon: L.divIcon({
          className: 'compass-label',
          html: `<span style="background:rgba(255,255,255,0.85);color:#ea580c;font-weight:bold;`
              + `font-size:12px;padding:1px 5px;border-radius:3px;white-space:nowrap;`
              + `pointer-events:none">r = ${formatDist(r)}</span>`,
          iconAnchor: [0, 12],
        }) }).addTo(map);
      const area = Math.PI * r * r;
      const circumf = 2 * Math.PI * r;
      status(`${t('msg.radius')}: ${formatDist(r)} | ${t('msg.diameter')}: ${formatDist(r * 2)}`
           + ` | ${t('msg.circumference')}: ${formatDist(circumf)}`
           + ` | ${t('msg.area')}: ${formatArea(area)}`);
    };
    map.on('mousemove', compassMoveHandler);
  } else {
    const pt = snapToWaypoint(e.latlng);
    if (compassMoveHandler) { map.off('mousemove', compassMoveHandler); compassMoveHandler = null; }
    const r = compassCenter.distanceTo(pt);
    if (compassCircle) map.removeLayer(compassCircle);
    if (compassRadiusLine) map.removeLayer(compassRadiusLine);
    compassCircle = L.circle(compassCenter, {
      radius: r, color, weight: 2.5, fill: true,
      fillColor: color, fillOpacity: 0.08,
    }).addTo(map);
    compassRadiusLine = L.polyline([compassCenter, pt], { color, weight: 2 }).addTo(map);
    const edgeMarker = L.circleMarker(pt,
      { radius: 4, color, fillColor: color, fillOpacity: 1 }).addTo(map);
    const area = Math.PI * r * r;
    const circumf = 2 * Math.PI * r;
    if (compassRadiusLabel) map.removeLayer(compassRadiusLabel);
    const midLat = (compassCenter.lat + pt.lat) / 2;
    const midLng = (compassCenter.lng + pt.lng) / 2;
    compassRadiusLabel = L.marker([midLat, midLng],
      { interactive: false, icon: L.divIcon({
        className: 'compass-label',
        html: `<span style="background:rgba(255,255,255,0.9);color:#ea580c;font-weight:bold;`
            + `font-size:12px;padding:2px 6px;border-radius:3px;white-space:nowrap;`
            + `pointer-events:none">r = ${formatDist(r)}</span>`,
        iconAnchor: [0, 12],
      }) }).addTo(map);
    const topLat = compassCenter.lat + (r / 111320);
    compassCircumfLabel = L.marker([topLat, compassCenter.lng],
      { interactive: false, icon: L.divIcon({
        className: 'compass-label',
        html: `<span style="background:rgba(255,255,255,0.9);color:#ea580c;font-weight:bold;`
            + `font-size:12px;padding:2px 6px;border-radius:3px;white-space:nowrap;`
            + `pointer-events:none">C = ${formatDist(circumf)}</span>`,
        iconAnchor: [30, 24],
      }) }).addTo(map);
    compassAreaLabel = L.marker([compassCenter.lat, compassCenter.lng],
      { interactive: false, icon: L.divIcon({
        className: 'compass-label',
        html: `<span style="background:rgba(255,255,255,0.9);color:#ea580c;font-weight:bold;`
            + `font-size:11px;padding:2px 6px;border-radius:3px;white-space:nowrap;`
            + `pointer-events:none">A = ${formatArea(area)}</span>`,
        iconAnchor: [30, 6],
      }) }).addTo(map);
    const shortTxt = `r=${formatDist(r)} A=${formatArea(area)}`;
    const fullTxt = `${t('msg.radius')}: ${formatDist(r)} | `
                  + `${t('msg.diameter')}: ${formatDist(r * 2)}\n`
                  + `${t('msg.circumference')}: ${formatDist(circumf)} | `
                  + `${t('msg.area')}: ${formatArea(area)}`;
    document.getElementById('compassResult').textContent = fullTxt;
    status(`${t('msg.circleFixed')} — ${fullTxt.replace(/\n/g, ' | ')}`);
    const layers = [
      compassCenterMarker, compassCircle, compassRadiusLine,
      compassRadiusLabel, compassCircumfLabel, compassAreaLabel, edgeMarker,
    ].filter(Boolean);
    compassHistory.push({
      layers,
      text: shortTxt,
      data: { type: 'compass', center: [compassCenter.lat, compassCenter.lng], edge: [pt.lat, pt.lng] },
    });
    compassCenterMarker = null; compassCircle = null; compassRadiusLine = null;
    compassRadiusLabel = null; compassCircumfLabel = null; compassAreaLabel = null;
    compassCenter = null; compassFixed = false;
    renderToolHistory('compass', compassHistory, TOOL_COLORS.compass);
  }
}

function resetCompassDraw() {
  if (compassCenterMarker) { map.removeLayer(compassCenterMarker); compassCenterMarker = null; }
  if (compassCircle) { map.removeLayer(compassCircle); compassCircle = null; }
  if (compassRadiusLine) { map.removeLayer(compassRadiusLine); compassRadiusLine = null; }
  if (compassMoveHandler) { map.off('mousemove', compassMoveHandler); compassMoveHandler = null; }
  if (compassRadiusLabel) { map.removeLayer(compassRadiusLabel); compassRadiusLabel = null; }
  if (compassCircumfLabel) { map.removeLayer(compassCircumfLabel); compassCircumfLabel = null; }
  if (compassAreaLabel) { map.removeLayer(compassAreaLabel); compassAreaLabel = null; }
  compassCenter = null;
  compassFixed = false;
  document.getElementById('compassResult').textContent = '';
}

// ----------------------------------------------------------------
// Tool switching + mobile bar
// ----------------------------------------------------------------
const TOOL_TABLE = {
  ruler:      { btn: $btnRuler,      activate: activateRuler,      deactivate: deactivateRuler },
  protractor: { btn: $btnProtractor, activate: activateProtractor, deactivate: deactivateProtractor },
  line:       { btn: $btnLine,       activate: activateLine,       deactivate: deactivateLine },
  compass:    { btn: $btnCompass,    activate: activateCompass,    deactivate: deactivateCompass },
  route:      { btn: $btnRoute,      activate: activateRoute,      deactivate: deactivateRoute },
};

export function toggleTool(name) {
  if (state.activeTool === name) { deactivateAllTools(); return; }
  deactivateAllTools();
  state.activeTool = name;
  const tool = TOOL_TABLE[name];
  if (tool) { tool.btn.classList.add('active'); tool.activate(); }
  renderWaypointMarkers();
  map.doubleClickZoom.disable();
  if (window.innerWidth <= 768 || isTouch) {
    closeSidebarMobile();
    showMobileToolBar();
    updateMobileToolBar();
  }
}

export function deactivateAllTools() {
  if (state.activeTool && TOOL_TABLE[state.activeTool]) {
    TOOL_TABLE[state.activeTool].deactivate();
  }
  state.activeTool = null;
  for (const k of Object.keys(TOOL_TABLE)) TOOL_TABLE[k].btn.classList.remove('active');
  renderWaypointMarkers();
  if (state.wpMapActive) deactivateWaypoint();
  map.doubleClickZoom.enable();
  hideMobileToolBar();
}

export function updateMobileToolBar() {
  if (!$mobileToolBar.classList.contains('visible')) return;
  const doneLabel = $mtbDone.querySelector('span');
  if (doneLabel) {
    const key = state.activeTool === 'route' ? 'btn.calculate' : 'btn.done';
    doneLabel.dataset.i18n = key;
    doneLabel.textContent = t(key);
  }
  $mtbDone.style.display =
    ((state.activeTool === 'line' && linePoints.length >= 2)
      || state.activeTool === 'route') ? '' : 'none';
  $mtbUndo.style.display =
    ((state.activeTool === 'line'
      && (linePoints.length > 0 || lineHistory.length > 0))
      || state.activeTool === 'route') ? '' : 'none';
}

setRouteHistoryRenderer(() => renderToolHistory('route', routeHistory, TOOL_COLORS.route));

export { lineFinish };
