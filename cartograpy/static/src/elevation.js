// ==============================================================
// Elevation profile — fetch + inline SVG chart
// ==============================================================
// Used by Ruler and Line tools. ``showElevationFor(historyEntry)``
// requests a profile from the backend and renders it directly inside
// the corresponding tool history row.
import { t } from './i18n.js';
import { formatDist } from './tools.js';

const W = 320;        // SVG viewBox width
const H = 90;         // SVG viewBox height (chart area only)
const PAD_L = 32;
const PAD_R = 6;
const PAD_T = 6;
const PAD_B = 16;

function _formatEle(m) {
  if (m === null || m === undefined) return '—';
  return Math.round(m) + ' m';
}

function _renderChart(profile, stats) {
  const samples = profile.filter(p => p.ele !== null && p.ele !== undefined);
  if (samples.length < 2) {
    return `<div style="font-size:11px;color:#94a3b8;">${t('elev.noData')}</div>`;
  }
  const minE = stats.min;
  const maxE = stats.max;
  const eRange = Math.max(1, maxE - minE);
  const dMax = profile[profile.length - 1].dist;
  if (!Number.isFinite(dMax) || dMax <= 0) {
    return `<div style="font-size:11px;color:#94a3b8;">${t('elev.noData')}</div>`;
  }

  const x = (d) => PAD_L + (d / dMax) * (W - PAD_L - PAD_R);
  const y = (e) => PAD_T + (1 - (e - minE) / eRange) * (H - PAD_T - PAD_B);

  // Build polygon path under the curve
  let pts = '';
  let line = '';
  profile.forEach((p, i) => {
    if (p.ele === null || p.ele === undefined) return;
    const px = x(p.dist).toFixed(1);
    const py = y(p.ele).toFixed(1);
    pts += `${px},${py} `;
    line += (line === '' ? `M${px},${py}` : ` L${px},${py}`);
  });
  const baseY = (H - PAD_B).toFixed(1);
  const fill = `M${x(0).toFixed(1)},${baseY} L${pts}L${x(dMax).toFixed(1)},${baseY}Z`;

  // Y-axis labels (min, max, mid)
  const midE = (minE + maxE) / 2;
  const yLabels = [
    [maxE, y(maxE)], [midE, y(midE)], [minE, y(minE)],
  ].map(([e, py]) =>
    `<text x="${PAD_L - 3}" y="${(py + 3).toFixed(1)}" text-anchor="end"`
    + ` font-size="9" fill="#475569">${Math.round(e)}</text>`
    + `<line x1="${PAD_L}" x2="${W - PAD_R}" y1="${py.toFixed(1)}" y2="${py.toFixed(1)}"`
    + ` stroke="#e2e8f0" stroke-width="0.5"/>`,
  ).join('');

  // X-axis labels
  const xLabels = [0, 0.5, 1].map(f => {
    const d = dMax * f;
    return `<text x="${x(d).toFixed(1)}" y="${(H - 3).toFixed(1)}" text-anchor="${
      f === 0 ? 'start' : (f === 1 ? 'end' : 'middle')
    }" font-size="9" fill="#475569">${formatDist(d)}</text>`;
  }).join('');

  const statsLine =
    `<div style="font-size:11px;color:#475569;margin-top:2px;display:flex;`
    + `gap:8px;flex-wrap:wrap;">`
    + `<span><i class="fa-solid fa-arrow-up" style="color:#16a34a"></i> ${Math.round(stats.gain)} m</span>`
    + `<span><i class="fa-solid fa-arrow-down" style="color:#dc2626"></i> ${Math.round(stats.loss)} m</span>`
    + `<span>${t('elev.min')}: ${_formatEle(stats.min)}</span>`
    + `<span>${t('elev.max')}: ${_formatEle(stats.max)}</span>`
    + `</div>`;

  return `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;`
    + `background:#f8fafc;border-radius:4px;">
      ${yLabels}
      <path d="${fill}" fill="rgba(8,145,178,0.18)"/>
      <path d="${line}" fill="none" stroke="#0891b2" stroke-width="1.5"/>
      ${xLabels}
    </svg>
    ${statsLine}
  `;
}

/** Show the elevation profile inside the given history row container.
 *  ``points`` is an array of [lat, lon] pairs. */
export async function showElevationProfile(container, points) {
  if (!container || !points || points.length < 2) return;
  // Toggle: if already open, collapse it.
  const existing = container.querySelector('.elev-panel');
  if (existing) { existing.remove(); return; }

  const panel = document.createElement('div');
  panel.className = 'elev-panel';
  panel.style.cssText = 'flex:1 1 100%;margin-top:4px;padding:4px 6px;'
    + 'background:#fff;border:1px solid #e2e8f0;border-radius:4px;';
  panel.innerHTML = `<div style="font-size:11px;color:#94a3b8;">${t('elev.loading')}…</div>`;
  container.appendChild(panel);

  try {
    const res = await fetch('/api/elevation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    panel.innerHTML = _renderChart(data.profile, data.stats);
  } catch (e) {
    panel.innerHTML = `<div style="font-size:11px;color:#dc2626;">`
      + `${t('elev.error')}: ${e.message}</div>`;
  }
}
