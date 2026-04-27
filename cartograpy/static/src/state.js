// ==============================================================
// Shared mutable state and constants
// ==============================================================
// Cross-module state is held in this single `state` object so primitive
// values can be reassigned consistently from any feature module (ES module
// `let` exports are read-only on the import side). Arrays / Sets / Maps /
// plain objects exported below are mutated in place — never reassigned.

export const PAPERS = {
  A4:[210,297], A3:[297,420], A2:[420,594], A1:[594,841],
  Letter:[216,279], Legal:[216,356],
};

export const TOOL_COLORS = {
  ruler: '#dc2626', protractor: '#7c3aed',
  line: '#0891b2', compass: '#ea580c',
  route: '#16a34a',
};

export const MAX_SUGGESTIONS = 8;
export const MAX_HISTORY = 10;
export const SNAP_PX = 15;

export const WP_ICONS = [
  { fa: 'fa-location-dot',   labelKey: 'wpIcon.pin' },
  { fa: 'fa-flag',           labelKey: 'wpIcon.flag' },
  { fa: 'fa-campground',     labelKey: 'wpIcon.camp' },
  { fa: 'fa-mountain',       labelKey: 'wpIcon.mountain' },
  { fa: 'fa-house',          labelKey: 'wpIcon.house' },
  { fa: 'fa-tree',           labelKey: 'wpIcon.tree' },
  { fa: 'fa-car',            labelKey: 'wpIcon.car' },
  { fa: 'fa-person-hiking',  labelKey: 'wpIcon.hike' },
  { fa: 'fa-star',           labelKey: 'wpIcon.star' },
  { fa: 'fa-circle-exclamation', labelKey: 'wpIcon.warning' },
  { fa: 'fa-camera',         labelKey: 'wpIcon.photo' },
  { fa: 'fa-utensils',       labelKey: 'wpIcon.restaurant' },
  { fa: 'fa-water',          labelKey: 'wpIcon.water' },
  { fa: 'fa-binoculars',     labelKey: 'wpIcon.viewpoint' },
  { fa: 'fa-cross',          labelKey: 'wpIcon.cross' },
];

export const WP_COLORS = [
  '#dc2626','#ea580c','#d97706','#16a34a','#0891b2',
  '#2563eb','#7c3aed','#db2777','#1e293b',
];

export const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

// Mutable shared state. Primitives may be reassigned (`state.x = …`).
export const state = {
  // i18n
  currentLang: 'en',
  // Active tool
  activeTool: null,           // null | 'ruler' | 'protractor' | 'line' | 'compass'
  wpMapActive: false,
  // Source bootstrap
  sourcesPayload: null,
  activeBaseLayerName: null,
  // Map / print rect / grid (owned by main.js)
  printRect: null,
  gridLayer: null,
  gridEpsg: null,
  gridTimeout: null,
  // Search
  suggestController: null,
  suggestTimeout: null,
  // Weather
  weatherLat: null,
  weatherLon: null,
  selectedHour: null,         // null = day summary, 0..23 = specific hour
  lastWeatherData: null,
  rainviewerTimestamps: null,
  // Config debounce
  cfgTimer: null,
};

// Stable references — mutated in place, never reassigned.
export const waypoints = [];
export const searchHistory = [];     // {name, lat, lon}
export const searchResults = [];
export const suggestData = [];

export const rulerHistory = [];
export const protHistory = [];
export const lineHistory = [];
export const compassHistory = [];
export const routeHistory = [];

export const sheetDividers = [];
export const tileLayers = {};        // name -> Leaflet layer (filled by loadSources)

export const selectedOverlays = new Set();   // ids checked by the user
export const activeOverlays = new Map();     // id -> Leaflet layer or {kind:'ui',def}

// `searchResults` is reassigned by the search flow; expose a setter to keep
// the same exported reference semantics.
export function setSearchResults(arr) {
  searchResults.length = 0;
  searchResults.push(...arr);
}
export function setSuggestData(arr) {
  suggestData.length = 0;
  suggestData.push(...arr);
}
