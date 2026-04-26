// ==============================================================
// i18n — Internationalisation
// ==============================================================
import { state } from './state.js';
import { renderWaypointList } from './waypoints.js';

let _lang = {};

export function t(key, ...args) {
  let s = _lang[key] || key;
  args.forEach((a, i) => { s = s.replace(`{${i}}`, a); });
  return s;
}

export async function loadLanguage(code) {
  try {
    const res = await fetch(`/lang/${encodeURIComponent(code)}.json`);
    if (!res.ok) return;
    _lang = await res.json();
    state.currentLang = code;
    applyTranslations();
  } catch(e) {
    console.error('Failed to load language:', code, e);
  }
}

export function applyTranslations() {
  document.title = t('title');
  document.documentElement.lang = state.currentLang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  document.querySelectorAll('[data-i18n-label]').forEach(el => {
    el.label = t(el.dataset.i18nLabel);
  });
  // Re-render lists whose contents depend on translated strings.
  renderWaypointList();
}
