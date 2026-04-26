// ==============================================================
// Search — geocoder, autocomplete, history
// ==============================================================
import { map, $search, $results, $resList, status, closeSidebarMobile } from './core.js';
import { state, searchResults, searchHistory, suggestData,
         setSearchResults, setSuggestData,
         selectedOverlays, MAX_HISTORY, MAX_SUGGESTIONS } from './state.js';
import { t } from './i18n.js';
import { scheduleSaveConfig } from './config.js';
import { updateOverlays } from './print.js';
import { fetchWeather } from './weather.js';
import { populateOverlayPanel, applyOverlays } from './overlays.js';

export async function doSearch() {
  const q = $search.value.trim();
  if (!q) return;
  hideSuggestions();
  status(t('status.searching'));
  try {
    const res = await fetch('/api/search?q=' + encodeURIComponent(q));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (!data.length) { status(t('status.noResults')); $results.style.display='none'; return; }
    setSearchResults(data);
    $resList.innerHTML = data.map(r =>
      `<option>${r.name.substring(0,120)}</option>`).join('');
    $results.style.display = 'block';
    $resList.selectedIndex = 0;
    const r = data[0];
    goToPlace(r.name, r.lat, r.lon);
  } catch(e) { status(t('msg.error') + e.message); }
}

export function goToPlace(name, lat, lon) {
  map.setView([lat, lon], 14);
  updateOverlays();
  closeSidebarMobile();
  status(`${lat.toFixed(5)}°N  ${Math.abs(lon).toFixed(5)}°${lon>=0?'E':'W'}`);
  // History (avoid duplicates)
  const short = name.substring(0, 80);
  if (!searchHistory.some(h => h.name === short && Math.abs(h.lat - lat) < 0.0001))
    searchHistory.unshift({ name: short, lat, lon });
  if (searchHistory.length > MAX_HISTORY) searchHistory.pop();
  renderHistory();
  scheduleSaveConfig();
  // Auto-activate weather overlay on a successful search.
  state.weatherLat = lat;
  state.weatherLon = lon;
  if (!selectedOverlays.has('weather')) {
    selectedOverlays.add('weather');
    populateOverlayPanel();
    applyOverlays();
    scheduleSaveConfig();
  } else {
    fetchWeather(lat, lon);
  }
}

export async function fetchSuggestions(q) {
  if (state.suggestController) state.suggestController.abort();
  state.suggestController = new AbortController();
  try {
    const res = await fetch(
      '/api/suggest?q=' + encodeURIComponent(q) + '&lang=' + encodeURIComponent(state.currentLang),
      { signal: state.suggestController.signal },
    );
    if (!res.ok) { hideSuggestions(); return; }
    const data = await res.json();
    if (data.error || !data.length) { hideSuggestions(); return; }
    setSuggestData(data.slice(0, MAX_SUGGESTIONS));
    const box = document.getElementById('searchSuggestions');
    box.innerHTML = suggestData.map((r, i) =>
      `<div class="sg-item" data-idx="${i}">${r.name.substring(0, 100)}</div>`
    ).join('');
    box.style.display = 'block';
  } catch(e) {
    if (e.name !== 'AbortError') hideSuggestions();
  }
}

export function hideSuggestions() {
  document.getElementById('searchSuggestions').style.display = 'none';
}

export function renderHistory() {
  const sec = document.getElementById('historySection');
  const list = document.getElementById('histList');
  if (!searchHistory.length) { sec.style.display = 'none'; return; }
  sec.style.display = '';
  list.innerHTML = searchHistory.map((h, i) =>
    `<div class="hist-item">
       <i class="fa-solid fa-location-dot" style="color:#64748b; font-size:12px;"></i>
       <span class="hist-name" data-idx="${i}">${h.name}</span>
       <span class="hist-del" data-idx="${i}"><i class="fa-solid fa-xmark"></i></span>
     </div>`
  ).join('');
  list.querySelectorAll('.hist-name').forEach(el => {
    el.addEventListener('click', () => {
      const h = searchHistory[parseInt(el.dataset.idx)];
      goToPlace(h.name, h.lat, h.lon);
    });
  });
  list.querySelectorAll('.hist-del').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      searchHistory.splice(parseInt(el.dataset.idx), 1);
      renderHistory();
      scheduleSaveConfig();
    });
  });
}
