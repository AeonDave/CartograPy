// ==============================================================
// Weather widget — Open-Meteo + RainViewer + WMO mapping
// ==============================================================
import { map } from './core.js';
import { state, selectedOverlays, activeOverlays } from './state.js';
import { t } from './i18n.js';
import { scheduleSaveConfig } from './config.js';
import { populateOverlayPanel } from './overlays.js';

// DOM refs (the script tag is at the end of <body>, so the elements exist).
export const $weatherCard = document.getElementById('weatherCard');
const $weatherDate = document.getElementById('weatherDate');
const $weatherIcon = document.getElementById('weatherIcon');
const $weatherTemp = document.getElementById('weatherTemp');
const $weatherLabel = document.getElementById('weatherLabel');
const $weatherBar = document.getElementById('weatherBar');
const $weatherLegend = document.getElementById('weatherLegend');
const $weatherHourIndicator = document.getElementById('weatherHourIndicator');
const $weatherNowIndicator = document.getElementById('weatherNowIndicator');

// Set date picker range: today → +14 days (Open-Meteo limit).
(function initWeatherDate() {
  const today = new Date();
  const max = new Date(today); max.setDate(today.getDate() + 14);
  const fmt = d => d.toISOString().slice(0, 10);
  $weatherDate.min = fmt(today);
  $weatherDate.max = fmt(max);
  $weatherDate.value = fmt(today);
})();

// ---- Weather code → category mapping ----
const WMO = {
  0:  { cat: 'clear',    en: 'Clear sky' },
  1:  { cat: 'clear',    en: 'Mainly clear' },
  2:  { cat: 'cloudy',   en: 'Partly cloudy' },
  3:  { cat: 'overcast', en: 'Overcast' },
  45: { cat: 'fog',      en: 'Fog' },
  48: { cat: 'fog',      en: 'Rime fog' },
  51: { cat: 'drizzle',  en: 'Light drizzle' },
  53: { cat: 'drizzle',  en: 'Drizzle' },
  55: { cat: 'drizzle',  en: 'Dense drizzle' },
  56: { cat: 'drizzle',  en: 'Freezing drizzle' },
  57: { cat: 'drizzle',  en: 'Heavy freezing drizzle' },
  61: { cat: 'rain',     en: 'Light rain' },
  63: { cat: 'rain',     en: 'Rain' },
  65: { cat: 'heavyrain',en: 'Heavy rain' },
  66: { cat: 'rain',     en: 'Freezing rain' },
  67: { cat: 'heavyrain',en: 'Heavy freezing rain' },
  71: { cat: 'snow',     en: 'Light snow' },
  73: { cat: 'snow',     en: 'Snow' },
  75: { cat: 'snow',     en: 'Heavy snow' },
  77: { cat: 'snow',     en: 'Snow grains' },
  80: { cat: 'rain',     en: 'Light showers' },
  81: { cat: 'rain',     en: 'Showers' },
  82: { cat: 'heavyrain',en: 'Violent showers' },
  85: { cat: 'snow',     en: 'Snow showers' },
  86: { cat: 'snow',     en: 'Heavy snow showers' },
  95: { cat: 'storm',    en: 'Thunderstorm' },
  96: { cat: 'storm',    en: 'Thunderstorm + hail' },
  99: { cat: 'storm',    en: 'Severe thunderstorm' },
};

const CAT_COLOR = {
  clear: '#fbbf24', cloudy: '#d1d5db', overcast: '#9ca3af',
  fog: '#c4b5a0', drizzle: '#93c5fd', rain: '#3b82f6',
  heavyrain: '#1d4ed8', snow: '#bfdbfe', storm: '#7c3aed',
};

const CAT_LABEL_KEYS = {
  clear: 'weather.clear', cloudy: 'weather.cloudy', overcast: 'weather.overcast',
  fog: 'weather.fog', drizzle: 'weather.drizzle', rain: 'weather.rain',
  heavyrain: 'weather.heavyrain', snow: 'weather.snow', storm: 'weather.storm',
};

function weatherSVG(cat) {
  const sun = `<circle cx="28" cy="28" r="10" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.5"/>
    <g stroke="#fbbf24" stroke-width="2" stroke-linecap="round">
      <line x1="28" y1="10" x2="28" y2="14"/><line x1="28" y1="42" x2="28" y2="46"/>
      <line x1="10" y1="28" x2="14" y2="28"/><line x1="42" y1="28" x2="46" y2="28"/>
      <line x1="15.3" y1="15.3" x2="18.1" y2="18.1"/><line x1="37.9" y1="37.9" x2="40.7" y2="40.7"/>
      <line x1="15.3" y1="40.7" x2="18.1" y2="37.9"/><line x1="37.9" y1="18.1" x2="40.7" y2="15.3"/>
    </g>`;
  const cloud = `<path d="M16 36 Q10 36 10 30 Q10 25 15 24 Q16 18 23 18 Q28 18 30 22
    Q32 20 36 20 Q42 20 42 26 Q46 26 46 31 Q46 36 40 36 Z"
    fill="#e2e8f0" stroke="#94a3b8" stroke-width="1"/>`;
  const cloudDark = cloud.replace('#e2e8f0','#94a3b8')
                         .replace('#94a3b8" stroke-width','#64748b" stroke-width');
  const rain = `<line x1="22" y1="40" x2="20" y2="46" stroke="#3b82f6" stroke-width="2" stroke-linecap="round"/>
    <line x1="30" y1="40" x2="28" y2="46" stroke="#3b82f6" stroke-width="2" stroke-linecap="round"/>
    <line x1="38" y1="40" x2="36" y2="46" stroke="#3b82f6" stroke-width="2" stroke-linecap="round"/>`;
  const snowflakes = `<text x="20" y="46" font-size="8" fill="#60a5fa">❄</text>
    <text x="32" y="46" font-size="8" fill="#60a5fa">❄</text>`;
  const bolt = `<polygon points="30,34 26,42 32,42 28,52" fill="#fbbf24" stroke="#f59e0b" stroke-width="0.5"/>`;
  const fog_lines = `<line x1="12" y1="38" x2="44" y2="38" stroke="#a8a29e" stroke-width="2" stroke-linecap="round" opacity=".6"/>
    <line x1="16" y1="42" x2="40" y2="42" stroke="#a8a29e" stroke-width="2" stroke-linecap="round" opacity=".4"/>
    <line x1="14" y1="46" x2="42" y2="46" stroke="#a8a29e" stroke-width="2" stroke-linecap="round" opacity=".3"/>`;
  const svgs = {
    clear:    `<svg viewBox="0 0 56 56">${sun}</svg>`,
    cloudy:   `<svg viewBox="0 0 56 56"><g transform="translate(-4,-6) scale(.7)">${sun}</g>${cloud}</svg>`,
    overcast: `<svg viewBox="0 0 56 56">${cloudDark}</svg>`,
    fog:      `<svg viewBox="0 0 56 56">${cloud}${fog_lines}</svg>`,
    drizzle:  `<svg viewBox="0 0 56 56">${cloud}<line x1="26" y1="40" x2="24" y2="44" stroke="#93c5fd" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="34" y1="40" x2="32" y2="44" stroke="#93c5fd" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    rain:     `<svg viewBox="0 0 56 56">${cloudDark}${rain}</svg>`,
    heavyrain:`<svg viewBox="0 0 56 56">${cloudDark}${rain}
      <line x1="26" y1="42" x2="24" y2="48" stroke="#1d4ed8" stroke-width="2" stroke-linecap="round"/></svg>`,
    snow:     `<svg viewBox="0 0 56 56">${cloud}${snowflakes}</svg>`,
    storm:    `<svg viewBox="0 0 56 56">${cloudDark}${bolt}${rain}</svg>`,
  };
  return svgs[cat] || svgs.cloudy;
}

function windArrow(deg) {
  const arrows = ['↓','↙','←','↖','↑','↗','→','↘'];
  return arrows[Math.round(deg / 45) % 8];
}

export async function fetchRainviewerData() {
  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    const data = await res.json();
    state.rainviewerTimestamps = data;
    return data;
  } catch (e) {
    console.error('RainViewer fetch error:', e);
    return null;
  }
}

export async function fetchWeather(lat, lon) {
  const date = $weatherDate.value;
  let url = `/api/weather?lat=${lat}&lon=${lon}`;
  if (date) url += `&date=${date}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    state.lastWeatherData = data;
    renderWeather(data);
    $weatherCard.classList.add('visible');
  } catch (e) {
    console.error('Weather fetch error:', e);
  }
}

function renderWeather(data) {
  const hrs = data.hourly || {};
  const temps = hrs.temperature_2m || [];
  const codes = hrs.weathercode || [];
  const feels = hrs.apparent_temperature || [];
  const humid = hrs.relativehumidity_2m || [];
  const precProb = hrs.precipitation_probability || [];
  const precMm = hrs.precipitation || [];
  const windSpd = hrs.windspeed_10m || [];
  const windGust = hrs.windgusts_10m || [];
  const windDir = hrs.winddirection_10m || [];
  const uvIdx = hrs.uv_index || [];
  if (!temps.length) return;

  const avg = arr => arr.length ? arr.reduce((a,b) => a+b, 0) / arr.length : 0;
  const max = arr => arr.length ? Math.max(...arr) : 0;

  const h = state.selectedHour;
  const isHour = h !== null && h >= 0 && h < temps.length;

  if (isHour) {
    const hTemp = Math.round(temps[h]);
    const hFeels = Math.round(feels[h] || temps[h]);
    $weatherTemp.textContent = `${hTemp}°C`;
    const $feelsLike = document.getElementById('weatherFeelsLike');
    if ($feelsLike) $feelsLike.textContent = `${t('weather.feelsLike')} ${hFeels}°C`;
    const hCat = (WMO[codes[h]] || WMO[2]).cat;
    $weatherIcon.innerHTML = weatherSVG(hCat);
    $weatherLabel.textContent = `${String(h).padStart(2,'0')}:00 — `
      + `${t(CAT_LABEL_KEYS[hCat] || 'weather.cloudy')}`;
  } else {
    const avgTemp = Math.round(avg(temps));
    const avgFeels = Math.round(avg(feels));
    $weatherTemp.textContent = `${avgTemp}°C`;
    const $feelsLike = document.getElementById('weatherFeelsLike');
    if ($feelsLike) $feelsLike.textContent = feels.length
      ? `${t('weather.feelsLike')} ${avgFeels}°C` : '';
    const catCount = {};
    codes.forEach(c => {
      const cat = (WMO[c] || WMO[2]).cat;
      catCount[cat] = (catCount[cat] || 0) + 1;
    });
    const mainCat = Object.entries(catCount).sort((a,b) => b[1]-a[1])[0][0];
    $weatherIcon.innerHTML = weatherSVG(mainCat);
    $weatherLabel.textContent = t(CAT_LABEL_KEYS[mainCat] || 'weather.cloudy');
  }

  const $stats = document.getElementById('weatherStats');
  if ($stats) {
    let sHumid, sPrec, sMm, sWind, sGust, sDir, sUv, sMinT, sMaxT;
    if (isHour) {
      sHumid = humid[h] !== undefined ? Math.round(humid[h]) : '—';
      sPrec = precProb[h] !== undefined ? Math.round(precProb[h]) : '—';
      sMm = precMm[h] !== undefined ? precMm[h].toFixed(1) : '—';
      sWind = windSpd[h] !== undefined ? Math.round(windSpd[h]) : '—';
      sGust = windGust[h] !== undefined ? Math.round(windGust[h]) : '—';
      sDir = windDir[h] !== undefined ? Math.round(windDir[h]) : 0;
      sUv = uvIdx[h] !== undefined ? Math.round(uvIdx[h] * 10) / 10 : '—';
      sMinT = Math.round(temps[h]); sMaxT = sMinT;
    } else {
      sHumid = Math.round(avg(humid));
      sPrec = Math.round(max(precProb));
      sMm = precMm.reduce((a,b) => a+b, 0).toFixed(1);
      sWind = Math.round(avg(windSpd));
      sGust = Math.round(max(windGust));
      sDir = Math.round(avg(windDir));
      sUv = Math.round(max(uvIdx) * 10) / 10;
      sMinT = Math.round(Math.min(...temps));
      sMaxT = Math.round(Math.max(...temps));
    }
    $stats.innerHTML = `
      <div class="ws-item"><i class="fa-solid fa-droplet"></i> ${t('weather.humidity')} <span class="ws-val">${sHumid}%</span></div>
      <div class="ws-item"><i class="fa-solid fa-umbrella"></i> ${t('weather.precProb')} <span class="ws-val">${sPrec}%</span></div>
      <div class="ws-item"><i class="fa-solid fa-cloud-rain"></i> ${t('weather.precMm')} <span class="ws-val">${sMm} mm</span></div>
      <div class="ws-item"><i class="fa-solid fa-wind"></i> ${t('weather.wind')} <span class="ws-val">${sWind} km/h ${windArrow(sDir)}</span></div>
      <div class="ws-item"><i class="fa-solid fa-wind"></i> ${t('weather.gusts')} <span class="ws-val">${sGust} km/h</span></div>
      <div class="ws-item"><i class="fa-solid fa-sun"></i> UV <span class="ws-val">${sUv}</span></div>
      <div class="ws-item"><i class="fa-solid fa-temperature-arrow-down"></i> Min <span class="ws-val">${sMinT}°C</span></div>
      <div class="ws-item"><i class="fa-solid fa-temperature-arrow-up"></i> Max <span class="ws-val">${sMaxT}°C</span></div>
    `;
  }

  $weatherBar.innerHTML = '';
  const usedCats = new Set();
  const n = Math.min(codes.length, 24);
  for (let i = 0; i < n; i++) {
    const wmo = WMO[codes[i]] || WMO[2];
    const cat = wmo.cat;
    usedCats.add(cat);
    const el = document.createElement('div');
    el.className = 'wh' + (state.selectedHour === i ? ' selected' : '');
    el.style.background = CAT_COLOR[cat];
    const hour = String(i).padStart(2, '0') + ':00';
    let tip = `${hour} — ${t(CAT_LABEL_KEYS[cat])}`;
    if (temps[i] !== undefined) tip += ` ${Math.round(temps[i])}°C`;
    if (precProb[i] !== undefined) tip += ` ☔${precProb[i]}%`;
    if (windSpd[i] !== undefined) tip += ` 💨${Math.round(windSpd[i])} km/h`;
    el.dataset.tip = tip;
    el.dataset.hour = i;
    el.addEventListener('click', () => selectWeatherHour(i));
    $weatherBar.appendChild(el);
  }

  updateHourIndicator(n);
  updateNowIndicator(n);

  $weatherLegend.innerHTML = '';
  usedCats.forEach(cat => {
    const d = document.createElement('div');
    d.className = 'wleg';
    d.innerHTML = `<span class="wleg-dot" style="background:${CAT_COLOR[cat]}"></span>${t(CAT_LABEL_KEYS[cat])}`;
    $weatherLegend.appendChild(d);
  });
}

function selectWeatherHour(hour) {
  state.selectedHour = (state.selectedHour === hour) ? null : hour;
  if (state.lastWeatherData) renderWeather(state.lastWeatherData);
}

function updateHourIndicator(barCount) {
  if (state.selectedHour === null || barCount === 0) {
    $weatherHourIndicator.classList.remove('visible');
    return;
  }
  $weatherHourIndicator.classList.add('visible');
  const pct = ((state.selectedHour + 0.5) / barCount) * 100;
  $weatherHourIndicator.style.left = `calc(${pct}% - 5px)`;
}

function updateNowIndicator(barCount) {
  const today = new Date().toISOString().slice(0, 10);
  const nowHour = new Date().getHours();
  if ($weatherDate.value !== today || barCount === 0 || nowHour >= barCount) {
    $weatherNowIndicator.classList.remove('visible');
    return;
  }
  $weatherNowIndicator.classList.add('visible');
  const pct = ((nowHour + 0.5) / barCount) * 100;
  $weatherNowIndicator.style.left = `calc(${pct}% - 5px)`;
}

// ---- Wire weather card UI ----
$weatherDate.addEventListener('change', () => {
  state.selectedHour = null;
  if (state.weatherLat !== null) fetchWeather(state.weatherLat, state.weatherLon);
});

document.getElementById('weatherClose').addEventListener('click', () => {
  $weatherCard.classList.remove('visible');
  if (selectedOverlays.has('weather')) {
    selectedOverlays.delete('weather');
    activeOverlays.delete('weather');
    populateOverlayPanel();
    scheduleSaveConfig();
  }
});

document.getElementById('weatherNow').addEventListener('click', () => {
  const today = new Date().toISOString().slice(0, 10);
  $weatherDate.value = today;
  state.selectedHour = new Date().getHours();
  if (state.weatherLat !== null) fetchWeather(state.weatherLat, state.weatherLon);
});
