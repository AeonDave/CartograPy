(() => {
  // cartograpy/static/src/core.js
  var map = L.map("map", { zoomControl: false, attributionControl: true }).setView([44.49, 11.34], 13);
  var wpMarkerLayer = L.layerGroup();
  wpMarkerLayer.addTo(map);
  var $ = (id) => document.getElementById(id);
  var $search = $("search");
  var $scale = $("scale");
  var $paper = $("paper");
  var $sheets = $("sheets");
  var $landscape = $("landscape");
  var $source = $("source");
  var $gridType = $("gridType");
  var $gridScale = $("gridScale");
  var $fullLabels = $("fullLabels");
  var $dpi = $("dpi");
  var $mapTextScale = $("mapTextScale");
  var $status = $("status");
  var $results = $("results");
  var $resList = $("resultsList");
  var $btnExport = $("btnExport");
  var $btnRuler = $("btnRuler");
  var $btnProtractor = $("btnProtractor");
  var $btnLine = $("btnLine");
  var $btnCompass = $("btnCompass");
  var $btnWpAddOnMap = $("btnWpAddOnMap");
  var $mobileToolBar = $("mobileToolBar");
  var $mtbDone = $("mtbDone");
  var $mtbUndo = $("mtbUndo");
  var $mtbCancel = $("mtbCancel");
  function status(msg) {
    $status.textContent = msg;
  }
  function closeSidebarMobile() {
    $("sidebar").classList.add("collapsed");
    document.body.classList.add("sidebar-hidden");
    setTimeout(() => map.invalidateSize(), 300);
  }
  function showMobileToolBar() {
    $mobileToolBar.classList.add("visible");
  }
  function hideMobileToolBar() {
    $mobileToolBar.classList.remove("visible");
  }

  // cartograpy/static/src/state.js
  var PAPERS = {
    A4: [210, 297],
    A3: [297, 420],
    A2: [420, 594],
    A1: [594, 841],
    Letter: [216, 279],
    Legal: [216, 356]
  };
  var TOOL_COLORS = {
    ruler: "#dc2626",
    protractor: "#7c3aed",
    line: "#0891b2",
    compass: "#ea580c"
  };
  var MAX_SUGGESTIONS = 8;
  var MAX_HISTORY = 10;
  var SNAP_PX = 15;
  var WP_ICONS = [
    { fa: "fa-location-dot", labelKey: "wpIcon.pin" },
    { fa: "fa-flag", labelKey: "wpIcon.flag" },
    { fa: "fa-campground", labelKey: "wpIcon.camp" },
    { fa: "fa-mountain", labelKey: "wpIcon.mountain" },
    { fa: "fa-house", labelKey: "wpIcon.house" },
    { fa: "fa-tree", labelKey: "wpIcon.tree" },
    { fa: "fa-car", labelKey: "wpIcon.car" },
    { fa: "fa-person-hiking", labelKey: "wpIcon.hike" },
    { fa: "fa-star", labelKey: "wpIcon.star" },
    { fa: "fa-circle-exclamation", labelKey: "wpIcon.warning" },
    { fa: "fa-camera", labelKey: "wpIcon.photo" },
    { fa: "fa-utensils", labelKey: "wpIcon.restaurant" },
    { fa: "fa-water", labelKey: "wpIcon.water" },
    { fa: "fa-binoculars", labelKey: "wpIcon.viewpoint" },
    { fa: "fa-cross", labelKey: "wpIcon.cross" }
  ];
  var WP_COLORS = [
    "#dc2626",
    "#ea580c",
    "#d97706",
    "#16a34a",
    "#0891b2",
    "#2563eb",
    "#7c3aed",
    "#db2777",
    "#1e293b"
  ];
  var isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  var state = {
    // i18n
    currentLang: "en",
    // Active tool
    activeTool: null,
    // null | 'ruler' | 'protractor' | 'line' | 'compass'
    wpMapActive: false,
    // Source bootstrap
    sourcesPayload: null,
    activeBaseLayerName: null,
    // Map / print rect / grid (owned by main.js)
    printRect: null,
    gridLayer: null,
    gridTimeout: null,
    // Search
    suggestController: null,
    suggestTimeout: null,
    // Weather
    weatherLat: null,
    weatherLon: null,
    selectedHour: null,
    // null = day summary, 0..23 = specific hour
    lastWeatherData: null,
    rainviewerTimestamps: null,
    // Config debounce
    cfgTimer: null
  };
  var waypoints = [];
  var searchHistory = [];
  var searchResults = [];
  var suggestData = [];
  var rulerHistory = [];
  var protHistory = [];
  var lineHistory = [];
  var compassHistory = [];
  var sheetDividers = [];
  var tileLayers = {};
  var selectedOverlays = /* @__PURE__ */ new Set();
  var activeOverlays = /* @__PURE__ */ new Map();
  function setSearchResults(arr) {
    searchResults.length = 0;
    searchResults.push(...arr);
  }
  function setSuggestData(arr) {
    suggestData.length = 0;
    suggestData.push(...arr);
  }

  // cartograpy/static/src/waypoints.js
  var selectedWpId = null;
  var selectedIcon = WP_ICONS[0].fa;
  var selectedColor = WP_COLORS[0];
  function getWaypointMapActive() {
    return state.wpMapActive;
  }
  function activateWaypoint() {
    state.wpMapActive = true;
    $btnWpAddOnMap.classList.add("active");
    document.getElementById("waypointSection").open = true;
    map.getContainer().style.cursor = "crosshair";
    map.on("click", _waypointMapClick);
    if (window.innerWidth <= 768 || isTouch) {
      closeSidebarMobile();
      showMobileToolBar();
    }
  }
  function deactivateWaypoint() {
    state.wpMapActive = false;
    $btnWpAddOnMap.classList.remove("active");
    map.getContainer().style.cursor = "";
    map.off("click", _waypointMapClick);
    hideMobileToolBar();
  }
  function _waypointMapClick(e) {
    addWaypoint(e.latlng.lat, e.latlng.lng);
  }
  function addWaypoint(lat, lng) {
    const wp = { lat, lng, icon: selectedIcon, color: selectedColor, id: Date.now(), name: "" };
    waypoints.push(wp);
    selectedWpId = null;
    renderWaypointMarkers();
    renderWaypointList();
  }
  function removeWaypoint(id) {
    const idx = waypoints.findIndex((w) => w.id === id);
    if (idx >= 0) waypoints.splice(idx, 1);
    if (selectedWpId === id) selectedWpId = null;
    renderWaypointMarkers();
    renderWaypointList();
  }
  function selectWaypoint(id) {
    const wp = waypoints.find((w) => w.id === id);
    if (!wp) return;
    if (selectedWpId === id) {
      deselectWaypoint();
      return;
    }
    selectedWpId = id;
    syncPickersToWp(wp);
    document.getElementById("waypointSection").open = true;
    renderWaypointList();
    const el = document.querySelector(`.wp-item[data-id="${id}"]`);
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    status(t("wp.selected"));
  }
  function deselectWaypoint() {
    selectedWpId = null;
    renderWaypointList();
  }
  function syncPickersToWp(wp) {
    selectedIcon = wp.icon;
    selectedColor = wp.color;
    document.querySelectorAll("#iconGrid .icon-opt").forEach((el) => {
      const fa = el.querySelector("i").className.replace("fa-solid ", "");
      el.classList.toggle("selected", fa === wp.icon);
    });
    document.querySelectorAll("#colorGrid .color-opt").forEach((el) => {
      el.classList.toggle(
        "selected",
        el.style.background === wp.color || rgbToHex(el.style.background) === wp.color
      );
    });
  }
  function rgbToHex(rgb) {
    const m = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (!m) return rgb;
    return "#" + [m[1], m[2], m[3]].map((x) => parseInt(x).toString(16).padStart(2, "0")).join("");
  }
  function renderWaypointMarkers() {
    wpMarkerLayer.clearLayers();
    const toolActive = state.activeTool && state.activeTool !== "waypoint";
    waypoints.forEach((wp) => {
      const isSel = wp.id === selectedWpId;
      const size = isSel ? 28 : 22;
      const icon = L.divIcon({
        html: `<i class="fa-solid ${wp.icon}" style="color:${wp.color}; font-size:${size}px; text-shadow:0 1px 3px rgba(0,0,0,.4);${isSel ? " filter:drop-shadow(0 0 4px " + wp.color + ");" : ""}${toolActive ? " pointer-events:none;" : ""}"></i>`,
        className: "",
        iconSize: [24, 24],
        iconAnchor: [12, 22]
      });
      const m = L.marker([wp.lat, wp.lng], { icon, interactive: !toolActive }).addTo(wpMarkerLayer);
      if (!toolActive) m.on("click", () => selectWaypoint(wp.id));
      if (wp.name) {
        m.bindTooltip(wp.name, {
          permanent: true,
          direction: "bottom",
          offset: [0, 4],
          className: "wp-label"
        });
      }
    });
  }
  function renderWaypointList() {
    const list = document.getElementById("wpList");
    if (!list) return;
    if (!waypoints.length) {
      list.innerHTML = `<div style="color:#94a3b8; font-size:11px;">${t("wp.none")}</div>`;
      return;
    }
    list.innerHTML = waypoints.map(
      (wp) => `<div class="wp-item${wp.id === selectedWpId ? " selected" : ""}" data-id="${wp.id}">
       <i class="fa-solid ${wp.icon}" style="color:${wp.color}; cursor:pointer;"></i>
       <span class="wp-name" contenteditable="true" data-id="${wp.id}" title="${t("wp.rename")}">${wp.name || wp.lat.toFixed(5) + ", " + wp.lng.toFixed(5)}</span>
       <span class="wp-del" data-id="${wp.id}"><i class="fa-solid fa-xmark"></i></span>
     </div>`
    ).join("");
    list.querySelectorAll(".wp-item > i").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = parseInt(el.parentElement.dataset.id);
        selectWaypoint(id);
        renderWaypointMarkers();
      });
    });
    list.querySelectorAll(".wp-del").forEach((el) => {
      el.addEventListener("click", () => removeWaypoint(parseInt(el.dataset.id)));
    });
    list.querySelectorAll(".wp-name").forEach((el) => {
      el.addEventListener("blur", () => {
        const wp = waypoints.find((w) => w.id === parseInt(el.dataset.id));
        if (!wp) return;
        const val = el.textContent.trim();
        const coords = wp.lat.toFixed(5) + ", " + wp.lng.toFixed(5);
        wp.name = val === coords ? "" : val;
        renderWaypointMarkers();
        renderWaypointList();
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          el.blur();
        }
      });
    });
  }
  async function manualWpAddAsync() {
    const raw = document.getElementById("wpCoordInput").value.trim();
    if (!raw) return;
    const gridType = $gridType.value;
    try {
      const parseType = gridType === "none" ? "latlon" : gridType;
      const res = await fetch(
        `/api/coord2latlon?grid_type=${encodeURIComponent(parseType)}&coords=${encodeURIComponent(raw)}`
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      addWaypoint(data.lat, data.lon);
      document.getElementById("wpCoordInput").value = "";
      status(`${t("msg.wpAdded")}: ${data.lat.toFixed(5)}, ${data.lon.toFixed(5)}`);
    } catch (e) {
      status(t("msg.coordError") + ": " + e.message);
    }
  }
  async function bulkWpImport() {
    const text = document.getElementById("wpBulkInput").value.trim();
    if (!text) return;
    const lines = text.split(/\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    const gridType = $gridType.value;
    let added = 0, errors = 0;
    for (const line of lines) {
      try {
        const parseType = gridType === "none" ? "latlon" : gridType;
        const res = await fetch(
          `/api/coord2latlon?grid_type=${encodeURIComponent(parseType)}&coords=${encodeURIComponent(line)}`
        );
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        addWaypoint(data.lat, data.lon);
        added++;
      } catch (e) {
        errors++;
      }
    }
    document.getElementById("wpBulkInput").value = "";
    const msg = t("msg.wpImported", added) + (errors ? `, ${t("msg.wpErrors", errors)}` : "");
    status(msg);
  }
  function clearAllWaypoints() {
    waypoints.length = 0;
    selectedWpId = null;
    renderWaypointMarkers();
    renderWaypointList();
  }
  async function saveWpFile() {
    const name = document.getElementById("wpFileName").value.trim();
    if (!name) {
      alert(t("msg.enterName"));
      return;
    }
    const data = waypoints.map((w) => ({
      lat: w.lat,
      lng: w.lng,
      icon: w.icon,
      color: w.color,
      name: w.name || ""
    }));
    try {
      const res = await fetch("/api/waypoints/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, waypoints: data })
      });
      const r = await res.json();
      if (r.ok) {
        status(`${t("msg.wpSaved")}: ${name}`);
        document.getElementById("wpFilePanel").style.display = "none";
        document.getElementById("wpFileName").value = "";
      } else {
        alert(r.error);
      }
    } catch (e) {
      alert(t("msg.saveError"));
    }
  }
  async function refreshWpFileList() {
    const panel = document.getElementById("wpFilePanel");
    const sp = document.getElementById("wpSavePanel");
    const lp = document.getElementById("wpLoadPanel");
    sp.style.display = "none";
    lp.style.display = "";
    panel.style.display = "";
    const list = document.getElementById("wpFileList");
    list.innerHTML = `<div style="color:#94a3b8; font-size:11px;">${t("status.searching")}</div>`;
    try {
      const res = await fetch("/api/waypoints/list");
      const files = await res.json();
      if (!files.length) {
        list.innerHTML = `<div style="color:#94a3b8; font-size:11px;">${t("wp.noFiles")}</div>`;
        return;
      }
      list.innerHTML = files.map(
        (f) => `<div class="wpf-item" data-name="${f}">
         <i class="fa-solid fa-map-location-dot" style="color:#2563eb;"></i>
         <span class="wpf-name">${f}</span>
         <span class="wpf-del" data-name="${f}" title="Elimina"><i class="fa-solid fa-trash"></i></span>
       </div>`
      ).join("");
      list.querySelectorAll(".wpf-item").forEach((el) => {
        el.addEventListener("click", async (e) => {
          if (e.target.closest(".wpf-del")) return;
          await loadWpFile(el.dataset.name);
        });
      });
      list.querySelectorAll(".wpf-del").forEach((el) => {
        el.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (!confirm(t("msg.confirmDelete", el.dataset.name))) return;
          await fetch("/api/waypoints/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: el.dataset.name })
          });
          refreshWpFileList();
        });
      });
    } catch (e) {
      list.innerHTML = `<div style="color:#dc2626; font-size:11px;">${t("msg.error")}</div>`;
    }
  }
  async function loadWpFile(name) {
    try {
      const res = await fetch(`/api/waypoints/load?name=${encodeURIComponent(name)}`);
      const data = await res.json();
      if (data.error) {
        alert(data.error);
        return;
      }
      waypoints.length = 0;
      selectedWpId = null;
      data.forEach((w) => {
        waypoints.push({
          lat: w.lat,
          lng: w.lng || w.lon,
          icon: w.icon || "fa-location-dot",
          color: w.color || "#dc2626",
          name: w.name || "",
          id: Date.now() + Math.random()
        });
      });
      renderWaypointMarkers();
      renderWaypointList();
      document.getElementById("waypointSection").style.display = "";
      document.getElementById("waypointSection").open = true;
      document.getElementById("wpFilePanel").style.display = "none";
      status(t("msg.wpLoaded", waypoints.length, name));
      if (waypoints.length) {
        const bounds = L.latLngBounds(waypoints.map((w) => [w.lat, w.lng]));
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    } catch (e) {
      alert(t("msg.loadError"));
    }
  }
  function buildIconColorGrids() {
    const iconGrid = document.getElementById("iconGrid");
    iconGrid.innerHTML = "";
    WP_ICONS.forEach((ic) => {
      const d = document.createElement("div");
      d.className = "icon-opt" + (ic.fa === selectedIcon ? " selected" : "");
      d.title = t(ic.labelKey);
      d.setAttribute("data-i18n-title", ic.labelKey);
      d.innerHTML = `<i class="fa-solid ${ic.fa}"></i>`;
      d.addEventListener("click", () => {
        iconGrid.querySelectorAll(".icon-opt").forEach((x) => x.classList.remove("selected"));
        d.classList.add("selected");
        selectedIcon = ic.fa;
        if (selectedWpId) {
          const wp = waypoints.find((w) => w.id === selectedWpId);
          if (wp) {
            wp.icon = ic.fa;
            renderWaypointMarkers();
            renderWaypointList();
          }
        }
      });
      iconGrid.appendChild(d);
    });
    const colorGrid = document.getElementById("colorGrid");
    colorGrid.innerHTML = "";
    WP_COLORS.forEach((c) => {
      const d = document.createElement("div");
      d.className = "color-opt" + (c === selectedColor ? " selected" : "");
      d.style.background = c;
      d.addEventListener("click", () => {
        colorGrid.querySelectorAll(".color-opt").forEach((x) => x.classList.remove("selected"));
        d.classList.add("selected");
        selectedColor = c;
        if (selectedWpId) {
          const wp = waypoints.find((w) => w.id === selectedWpId);
          if (wp) {
            wp.color = c;
            renderWaypointMarkers();
            renderWaypointList();
          }
        }
      });
      colorGrid.appendChild(d);
    });
  }

  // cartograpy/static/src/i18n.js
  var _lang = {};
  function t(key, ...args) {
    let s = _lang[key] || key;
    args.forEach((a, i) => {
      s = s.replace(`{${i}}`, a);
    });
    return s;
  }
  async function loadLanguage(code) {
    try {
      const res = await fetch(`/lang/${encodeURIComponent(code)}.json`);
      if (!res.ok) return;
      _lang = await res.json();
      state.currentLang = code;
      applyTranslations();
    } catch (e) {
      console.error("Failed to load language:", code, e);
    }
  }
  function applyTranslations() {
    document.title = t("title");
    document.documentElement.lang = state.currentLang;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.title = t(el.dataset.i18nTitle);
    });
    document.querySelectorAll("[data-i18n-label]").forEach((el) => {
      el.label = t(el.dataset.i18nLabel);
    });
    renderWaypointList();
  }

  // cartograpy/static/src/weather.js
  var $weatherCard = document.getElementById("weatherCard");
  var $weatherDate = document.getElementById("weatherDate");
  var $weatherIcon = document.getElementById("weatherIcon");
  var $weatherTemp = document.getElementById("weatherTemp");
  var $weatherLabel = document.getElementById("weatherLabel");
  var $weatherBar = document.getElementById("weatherBar");
  var $weatherLegend = document.getElementById("weatherLegend");
  var $weatherHourIndicator = document.getElementById("weatherHourIndicator");
  var $weatherNowIndicator = document.getElementById("weatherNowIndicator");
  (function initWeatherDate() {
    const today = /* @__PURE__ */ new Date();
    const max = new Date(today);
    max.setDate(today.getDate() + 14);
    const fmt = (d) => d.toISOString().slice(0, 10);
    $weatherDate.min = fmt(today);
    $weatherDate.max = fmt(max);
    $weatherDate.value = fmt(today);
  })();
  var WMO = {
    0: { cat: "clear", en: "Clear sky" },
    1: { cat: "clear", en: "Mainly clear" },
    2: { cat: "cloudy", en: "Partly cloudy" },
    3: { cat: "overcast", en: "Overcast" },
    45: { cat: "fog", en: "Fog" },
    48: { cat: "fog", en: "Rime fog" },
    51: { cat: "drizzle", en: "Light drizzle" },
    53: { cat: "drizzle", en: "Drizzle" },
    55: { cat: "drizzle", en: "Dense drizzle" },
    56: { cat: "drizzle", en: "Freezing drizzle" },
    57: { cat: "drizzle", en: "Heavy freezing drizzle" },
    61: { cat: "rain", en: "Light rain" },
    63: { cat: "rain", en: "Rain" },
    65: { cat: "heavyrain", en: "Heavy rain" },
    66: { cat: "rain", en: "Freezing rain" },
    67: { cat: "heavyrain", en: "Heavy freezing rain" },
    71: { cat: "snow", en: "Light snow" },
    73: { cat: "snow", en: "Snow" },
    75: { cat: "snow", en: "Heavy snow" },
    77: { cat: "snow", en: "Snow grains" },
    80: { cat: "rain", en: "Light showers" },
    81: { cat: "rain", en: "Showers" },
    82: { cat: "heavyrain", en: "Violent showers" },
    85: { cat: "snow", en: "Snow showers" },
    86: { cat: "snow", en: "Heavy snow showers" },
    95: { cat: "storm", en: "Thunderstorm" },
    96: { cat: "storm", en: "Thunderstorm + hail" },
    99: { cat: "storm", en: "Severe thunderstorm" }
  };
  var CAT_COLOR = {
    clear: "#fbbf24",
    cloudy: "#d1d5db",
    overcast: "#9ca3af",
    fog: "#c4b5a0",
    drizzle: "#93c5fd",
    rain: "#3b82f6",
    heavyrain: "#1d4ed8",
    snow: "#bfdbfe",
    storm: "#7c3aed"
  };
  var CAT_LABEL_KEYS = {
    clear: "weather.clear",
    cloudy: "weather.cloudy",
    overcast: "weather.overcast",
    fog: "weather.fog",
    drizzle: "weather.drizzle",
    rain: "weather.rain",
    heavyrain: "weather.heavyrain",
    snow: "weather.snow",
    storm: "weather.storm"
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
    const cloudDark = cloud.replace("#e2e8f0", "#94a3b8").replace('#94a3b8" stroke-width', '#64748b" stroke-width');
    const rain = `<line x1="22" y1="40" x2="20" y2="46" stroke="#3b82f6" stroke-width="2" stroke-linecap="round"/>
    <line x1="30" y1="40" x2="28" y2="46" stroke="#3b82f6" stroke-width="2" stroke-linecap="round"/>
    <line x1="38" y1="40" x2="36" y2="46" stroke="#3b82f6" stroke-width="2" stroke-linecap="round"/>`;
    const snowflakes = `<text x="20" y="46" font-size="8" fill="#60a5fa">\u2744</text>
    <text x="32" y="46" font-size="8" fill="#60a5fa">\u2744</text>`;
    const bolt = `<polygon points="30,34 26,42 32,42 28,52" fill="#fbbf24" stroke="#f59e0b" stroke-width="0.5"/>`;
    const fog_lines = `<line x1="12" y1="38" x2="44" y2="38" stroke="#a8a29e" stroke-width="2" stroke-linecap="round" opacity=".6"/>
    <line x1="16" y1="42" x2="40" y2="42" stroke="#a8a29e" stroke-width="2" stroke-linecap="round" opacity=".4"/>
    <line x1="14" y1="46" x2="42" y2="46" stroke="#a8a29e" stroke-width="2" stroke-linecap="round" opacity=".3"/>`;
    const svgs = {
      clear: `<svg viewBox="0 0 56 56">${sun}</svg>`,
      cloudy: `<svg viewBox="0 0 56 56"><g transform="translate(-4,-6) scale(.7)">${sun}</g>${cloud}</svg>`,
      overcast: `<svg viewBox="0 0 56 56">${cloudDark}</svg>`,
      fog: `<svg viewBox="0 0 56 56">${cloud}${fog_lines}</svg>`,
      drizzle: `<svg viewBox="0 0 56 56">${cloud}<line x1="26" y1="40" x2="24" y2="44" stroke="#93c5fd" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="34" y1="40" x2="32" y2="44" stroke="#93c5fd" stroke-width="1.5" stroke-linecap="round"/></svg>`,
      rain: `<svg viewBox="0 0 56 56">${cloudDark}${rain}</svg>`,
      heavyrain: `<svg viewBox="0 0 56 56">${cloudDark}${rain}
      <line x1="26" y1="42" x2="24" y2="48" stroke="#1d4ed8" stroke-width="2" stroke-linecap="round"/></svg>`,
      snow: `<svg viewBox="0 0 56 56">${cloud}${snowflakes}</svg>`,
      storm: `<svg viewBox="0 0 56 56">${cloudDark}${bolt}${rain}</svg>`
    };
    return svgs[cat] || svgs.cloudy;
  }
  function windArrow(deg) {
    const arrows = ["\u2193", "\u2199", "\u2190", "\u2196", "\u2191", "\u2197", "\u2192", "\u2198"];
    return arrows[Math.round(deg / 45) % 8];
  }
  async function fetchRainviewerData() {
    try {
      const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
      const data = await res.json();
      state.rainviewerTimestamps = data;
      return data;
    } catch (e) {
      console.error("RainViewer fetch error:", e);
      return null;
    }
  }
  async function fetchWeather(lat, lon) {
    const date = $weatherDate.value;
    let url = `/api/weather?lat=${lat}&lon=${lon}`;
    if (date) url += `&date=${date}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      state.lastWeatherData = data;
      renderWeather(data);
      $weatherCard.classList.add("visible");
    } catch (e) {
      console.error("Weather fetch error:", e);
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
    const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const max = (arr) => arr.length ? Math.max(...arr) : 0;
    const h = state.selectedHour;
    const isHour = h !== null && h >= 0 && h < temps.length;
    if (isHour) {
      const hTemp = Math.round(temps[h]);
      const hFeels = Math.round(feels[h] || temps[h]);
      $weatherTemp.textContent = `${hTemp}\xB0C`;
      const $feelsLike = document.getElementById("weatherFeelsLike");
      if ($feelsLike) $feelsLike.textContent = `${t("weather.feelsLike")} ${hFeels}\xB0C`;
      const hCat = (WMO[codes[h]] || WMO[2]).cat;
      $weatherIcon.innerHTML = weatherSVG(hCat);
      $weatherLabel.textContent = `${String(h).padStart(2, "0")}:00 \u2014 ${t(CAT_LABEL_KEYS[hCat] || "weather.cloudy")}`;
    } else {
      const avgTemp = Math.round(avg(temps));
      const avgFeels = Math.round(avg(feels));
      $weatherTemp.textContent = `${avgTemp}\xB0C`;
      const $feelsLike = document.getElementById("weatherFeelsLike");
      if ($feelsLike) $feelsLike.textContent = feels.length ? `${t("weather.feelsLike")} ${avgFeels}\xB0C` : "";
      const catCount = {};
      codes.forEach((c) => {
        const cat = (WMO[c] || WMO[2]).cat;
        catCount[cat] = (catCount[cat] || 0) + 1;
      });
      const mainCat = Object.entries(catCount).sort((a, b) => b[1] - a[1])[0][0];
      $weatherIcon.innerHTML = weatherSVG(mainCat);
      $weatherLabel.textContent = t(CAT_LABEL_KEYS[mainCat] || "weather.cloudy");
    }
    const $stats = document.getElementById("weatherStats");
    if ($stats) {
      let sHumid, sPrec, sMm, sWind, sGust, sDir, sUv, sMinT, sMaxT;
      if (isHour) {
        sHumid = humid[h] !== void 0 ? Math.round(humid[h]) : "\u2014";
        sPrec = precProb[h] !== void 0 ? Math.round(precProb[h]) : "\u2014";
        sMm = precMm[h] !== void 0 ? precMm[h].toFixed(1) : "\u2014";
        sWind = windSpd[h] !== void 0 ? Math.round(windSpd[h]) : "\u2014";
        sGust = windGust[h] !== void 0 ? Math.round(windGust[h]) : "\u2014";
        sDir = windDir[h] !== void 0 ? Math.round(windDir[h]) : 0;
        sUv = uvIdx[h] !== void 0 ? Math.round(uvIdx[h] * 10) / 10 : "\u2014";
        sMinT = Math.round(temps[h]);
        sMaxT = sMinT;
      } else {
        sHumid = Math.round(avg(humid));
        sPrec = Math.round(max(precProb));
        sMm = precMm.reduce((a, b) => a + b, 0).toFixed(1);
        sWind = Math.round(avg(windSpd));
        sGust = Math.round(max(windGust));
        sDir = Math.round(avg(windDir));
        sUv = Math.round(max(uvIdx) * 10) / 10;
        sMinT = Math.round(Math.min(...temps));
        sMaxT = Math.round(Math.max(...temps));
      }
      $stats.innerHTML = `
      <div class="ws-item"><i class="fa-solid fa-droplet"></i> ${t("weather.humidity")} <span class="ws-val">${sHumid}%</span></div>
      <div class="ws-item"><i class="fa-solid fa-umbrella"></i> ${t("weather.precProb")} <span class="ws-val">${sPrec}%</span></div>
      <div class="ws-item"><i class="fa-solid fa-cloud-rain"></i> ${t("weather.precMm")} <span class="ws-val">${sMm} mm</span></div>
      <div class="ws-item"><i class="fa-solid fa-wind"></i> ${t("weather.wind")} <span class="ws-val">${sWind} km/h ${windArrow(sDir)}</span></div>
      <div class="ws-item"><i class="fa-solid fa-wind"></i> ${t("weather.gusts")} <span class="ws-val">${sGust} km/h</span></div>
      <div class="ws-item"><i class="fa-solid fa-sun"></i> UV <span class="ws-val">${sUv}</span></div>
      <div class="ws-item"><i class="fa-solid fa-temperature-arrow-down"></i> Min <span class="ws-val">${sMinT}\xB0C</span></div>
      <div class="ws-item"><i class="fa-solid fa-temperature-arrow-up"></i> Max <span class="ws-val">${sMaxT}\xB0C</span></div>
    `;
    }
    $weatherBar.innerHTML = "";
    const usedCats = /* @__PURE__ */ new Set();
    const n = Math.min(codes.length, 24);
    for (let i = 0; i < n; i++) {
      const wmo = WMO[codes[i]] || WMO[2];
      const cat = wmo.cat;
      usedCats.add(cat);
      const el = document.createElement("div");
      el.className = "wh" + (state.selectedHour === i ? " selected" : "");
      el.style.background = CAT_COLOR[cat];
      const hour = String(i).padStart(2, "0") + ":00";
      let tip = `${hour} \u2014 ${t(CAT_LABEL_KEYS[cat])}`;
      if (temps[i] !== void 0) tip += ` ${Math.round(temps[i])}\xB0C`;
      if (precProb[i] !== void 0) tip += ` \u2614${precProb[i]}%`;
      if (windSpd[i] !== void 0) tip += ` \u{1F4A8}${Math.round(windSpd[i])} km/h`;
      el.dataset.tip = tip;
      el.dataset.hour = i;
      el.addEventListener("click", () => selectWeatherHour(i));
      $weatherBar.appendChild(el);
    }
    updateHourIndicator(n);
    updateNowIndicator(n);
    $weatherLegend.innerHTML = "";
    usedCats.forEach((cat) => {
      const d = document.createElement("div");
      d.className = "wleg";
      d.innerHTML = `<span class="wleg-dot" style="background:${CAT_COLOR[cat]}"></span>${t(CAT_LABEL_KEYS[cat])}`;
      $weatherLegend.appendChild(d);
    });
  }
  function selectWeatherHour(hour) {
    state.selectedHour = state.selectedHour === hour ? null : hour;
    if (state.lastWeatherData) renderWeather(state.lastWeatherData);
  }
  function updateHourIndicator(barCount) {
    if (state.selectedHour === null || barCount === 0) {
      $weatherHourIndicator.classList.remove("visible");
      return;
    }
    $weatherHourIndicator.classList.add("visible");
    const pct = (state.selectedHour + 0.5) / barCount * 100;
    $weatherHourIndicator.style.left = `calc(${pct}% - 5px)`;
  }
  function updateNowIndicator(barCount) {
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const nowHour = (/* @__PURE__ */ new Date()).getHours();
    if ($weatherDate.value !== today || barCount === 0 || nowHour >= barCount) {
      $weatherNowIndicator.classList.remove("visible");
      return;
    }
    $weatherNowIndicator.classList.add("visible");
    const pct = (nowHour + 0.5) / barCount * 100;
    $weatherNowIndicator.style.left = `calc(${pct}% - 5px)`;
  }
  $weatherDate.addEventListener("change", () => {
    state.selectedHour = null;
    if (state.weatherLat !== null) fetchWeather(state.weatherLat, state.weatherLon);
  });
  document.getElementById("weatherClose").addEventListener("click", () => {
    $weatherCard.classList.remove("visible");
    if (selectedOverlays.has("weather")) {
      selectedOverlays.delete("weather");
      activeOverlays.delete("weather");
      populateOverlayPanel();
      scheduleSaveConfig();
    }
  });
  document.getElementById("weatherNow").addEventListener("click", () => {
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    $weatherDate.value = today;
    state.selectedHour = (/* @__PURE__ */ new Date()).getHours();
    if (state.weatherLat !== null) fetchWeather(state.weatherLat, state.weatherLon);
  });

  // cartograpy/static/src/overlays.js
  var $overlayList = document.getElementById("overlayList");
  var $overlayMsg = document.getElementById("overlayMsg");
  function _owmKey() {
    const el = document.getElementById("owmApiKey");
    return el ? (el.value || "").trim() : "";
  }
  function _setOverlayMsg(msg) {
    if (!$overlayMsg) return;
    $overlayMsg.textContent = msg || "";
    $overlayMsg.style.display = msg ? "" : "none";
  }
  function _makeOwmLayer(owmLayer) {
    const k = _owmKey();
    if (!k) return null;
    const url = `https://tile.openweathermap.org/map/${owmLayer}/{z}/{x}/{y}.png?appid=${k}`;
    const layer = L.tileLayer(url, {
      attribution: "\xA9 OpenWeatherMap",
      opacity: 0.7,
      maxZoom: 19,
      zIndex: 410
    });
    layer.on("tileerror", () => {
      _setOverlayMsg(t("weather.overlayKeyError"));
    });
    return layer;
  }
  var STATIC_OVERLAYS_PRE = [
    {
      id: "weather",
      labelKey: "overlay.weather",
      kind: "ui",
      show: () => {
        const c = map.getCenter();
        state.weatherLat = c.lat;
        state.weatherLon = c.lng;
        state.selectedHour = null;
        fetchWeather(c.lat, c.lng);
      },
      hide: () => {
        $weatherCard.classList.remove("visible");
      }
    }
  ];
  var STATIC_OVERLAYS_POST = [
    {
      id: "rainviewer",
      labelKey: "overlay.rainviewer",
      factoryAsync: async () => {
        const data = await fetchRainviewerData();
        if (!data || !data.radar || !data.radar.past || !data.radar.past.length) return null;
        const last = data.radar.past[data.radar.past.length - 1];
        const url = `${data.host}${last.path}/256/{z}/{x}/{y}/2/1_1.png`;
        return L.tileLayer(url, {
          attribution: "\xA9 RainViewer",
          opacity: 0.7,
          maxZoom: 19,
          zIndex: 410
        });
      }
    },
    {
      id: "owm_precipitation",
      labelKey: "overlay.owmPrec",
      requires: "owm",
      owmLayer: "precipitation_new"
    },
    {
      id: "owm_clouds",
      labelKey: "overlay.owmClouds",
      requires: "owm",
      owmLayer: "clouds_new"
    },
    {
      id: "owm_temp",
      labelKey: "overlay.owmTemp",
      requires: "owm",
      owmLayer: "temp_new"
    },
    {
      id: "owm_wind",
      labelKey: "overlay.owmWind",
      requires: "owm",
      owmLayer: "wind_new"
    },
    {
      id: "owm_pressure",
      labelKey: "overlay.owmPressure",
      requires: "owm",
      owmLayer: "pressure_new"
    }
  ];
  var overlays = {
    defs: [...STATIC_OVERLAYS_PRE, ...STATIC_OVERLAYS_POST]
  };
  function setOverlayDefs(tileDefs) {
    overlays.defs = [...STATIC_OVERLAYS_PRE, ...tileDefs, ...STATIC_OVERLAYS_POST];
  }
  function buildTileOverlayDef(o) {
    return {
      id: o.overlay_id || o.name,
      labelKey: o.label_key || null,
      label: o.display_name || o.name,
      factory: () => L.tileLayer(o.url, {
        attribution: o.attribution,
        maxZoom: o.max_zoom || 19,
        opacity: o.opacity != null ? o.opacity : 0.9,
        zIndex: o.z_index != null ? o.z_index : 410
      })
    };
  }
  async function _addOverlay(id) {
    if (activeOverlays.has(id)) return;
    const def = overlays.defs.find((d) => d.id === id);
    if (!def) return;
    if (def.kind === "ui") {
      if (def.show) def.show();
      activeOverlays.set(id, { kind: "ui", def });
      return;
    }
    if (def.requires === "owm") {
      const layer2 = _makeOwmLayer(def.owmLayer);
      if (!layer2) {
        selectedOverlays.delete(id);
        populateOverlayPanel();
        return;
      }
      layer2.addTo(map);
      activeOverlays.set(id, layer2);
      return;
    }
    let layer = null;
    if (def.factoryAsync) layer = await def.factoryAsync();
    else if (def.factory) layer = def.factory();
    if (!layer) {
      selectedOverlays.delete(id);
      populateOverlayPanel();
      return;
    }
    layer.addTo(map);
    activeOverlays.set(id, layer);
  }
  function _removeOverlay(id) {
    const entry = activeOverlays.get(id);
    if (!entry) return;
    if (entry && entry.kind === "ui") {
      if (entry.def && entry.def.hide) entry.def.hide();
    } else if (entry) {
      try {
        map.removeLayer(entry);
      } catch (e) {
      }
    }
    activeOverlays.delete(id);
  }
  async function applyOverlays() {
    for (const id of Array.from(activeOverlays.keys())) {
      if (!selectedOverlays.has(id)) _removeOverlay(id);
    }
    const owmAvailable = !!_owmKey();
    for (const id of selectedOverlays) {
      if (activeOverlays.has(id)) continue;
      const def = overlays.defs.find((d) => d.id === id);
      if (!def) continue;
      if (def.requires === "owm" && !owmAvailable) continue;
      await _addOverlay(id);
    }
    if (owmAvailable) _setOverlayMsg("");
  }
  function populateOverlayPanel() {
    if (!$overlayList) return;
    $overlayList.innerHTML = "";
    const owmAvailable = !!_owmKey();
    let anyDisabled = false;
    overlays.defs.forEach((def) => {
      const row = document.createElement("label");
      row.className = "overlay-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.id = def.id;
      cb.checked = selectedOverlays.has(def.id);
      const disabled = def.requires === "owm" && !owmAvailable;
      if (disabled) {
        cb.disabled = true;
        row.classList.add("disabled");
        anyDisabled = true;
        if (selectedOverlays.has(def.id)) {
          selectedOverlays.delete(def.id);
          cb.checked = false;
        }
      }
      const span = document.createElement("span");
      if (def.labelKey) {
        span.dataset.i18n = def.labelKey;
        span.textContent = t(def.labelKey);
      } else {
        span.textContent = def.label || def.id;
      }
      cb.addEventListener("change", async () => {
        _setOverlayMsg("");
        if (cb.checked) selectedOverlays.add(def.id);
        else selectedOverlays.delete(def.id);
        await applyOverlays();
        scheduleSaveConfig();
      });
      row.appendChild(cb);
      row.appendChild(span);
      $overlayList.appendChild(row);
    });
    if (!anyDisabled) _setOverlayMsg("");
  }

  // cartograpy/static/src/tools.js
  function formatDist(m) {
    if (m >= 1e3) return (m / 1e3).toFixed(2) + " km";
    return m.toFixed(1) + " m";
  }
  function formatArea(m2) {
    if (m2 >= 1e6) return (m2 / 1e6).toFixed(3) + " km\xB2";
    if (m2 >= 1e4) return (m2 / 1e4).toFixed(2) + " ha";
    return m2.toFixed(1) + " m\xB2";
  }
  function bearing(a, b) {
    const dLon = (b.lng - a.lng) * Math.PI / 180;
    const lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
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
    const r = Math.min(vertex.distanceTo(p1), vertex.distanceTo(p2), 5e4) * 0.25;
    const b1 = bearing(vertex, p1);
    const b2 = bearing(vertex, p2);
    let start = b1, end = b2;
    let diff = (end - start + 360) % 360;
    if (diff > 180) {
      start = b2;
      diff = 360 - diff;
    }
    const pts = [];
    const steps = Math.max(20, Math.round(diff));
    for (let i = 0; i <= steps; i++) {
      const a = (start + diff * i / steps) * Math.PI / 180;
      const dLat = r * Math.cos(a) / 111320;
      const dLon = r * Math.sin(a) / (111320 * Math.cos(vertex.lat * Math.PI / 180));
      pts.push([vertex.lat + dLat, vertex.lng + dLon]);
    }
    return L.polyline(pts, { color, weight: 2, dashArray: "4 3" }).addTo(map);
  }
  function snapToWaypoint(latlng) {
    if (!document.getElementById("chkSnapWp").checked || waypoints.length === 0) return latlng;
    const pt = map.latLngToContainerPoint(latlng);
    let best = null, bestDist = Infinity;
    waypoints.forEach((wp) => {
      const wp_pt = map.latLngToContainerPoint(L.latLng(wp.lat, wp.lng));
      const d = pt.distanceTo(wp_pt);
      if (d < bestDist) {
        bestDist = d;
        best = wp;
      }
    });
    if (best && bestDist <= SNAP_PX) return L.latLng(best.lat, best.lng);
    return latlng;
  }
  function renderToolHistory(toolName, histArr, color) {
    const container = document.getElementById(toolName + "History");
    container.innerHTML = "";
    histArr.forEach((entry, i) => {
      const row = document.createElement("div");
      row.className = "tool-hist-row";
      row.style.color = color;
      const txt = document.createElement("span");
      txt.className = "tool-hist-text";
      txt.textContent = `#${i + 1}  ${entry.text}`;
      txt.title = t("msg.clickToCenter");
      txt.addEventListener("click", () => {
        const fg = L.featureGroup(entry.layers);
        try {
          map.fitBounds(fg.getBounds().pad(0.2));
        } catch (e) {
        }
      });
      const del = document.createElement("span");
      del.className = "tool-hist-del";
      del.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      del.title = t("msg.delete");
      del.addEventListener("click", () => {
        entry.layers.forEach((l) => {
          try {
            map.removeLayer(l);
          } catch (e) {
          }
        });
        histArr.splice(i, 1);
        renderToolHistory(toolName, histArr, color);
      });
      row.appendChild(txt);
      row.appendChild(del);
      container.appendChild(row);
    });
    const sep = document.getElementById("toolHistorySep");
    const hasAny = rulerHistory.length || protHistory.length || lineHistory.length || compassHistory.length;
    sep.style.display = hasAny ? "" : "none";
    updateLineUndoBtn();
  }
  function renderAllToolHistories() {
    renderToolHistory("ruler", rulerHistory, TOOL_COLORS.ruler);
    renderToolHistory("protractor", protHistory, TOOL_COLORS.protractor);
    renderToolHistory("line", lineHistory, TOOL_COLORS.line);
    renderToolHistory("compass", compassHistory, TOOL_COLORS.compass);
  }
  function restoreToolEntry(d) {
    const color = TOOL_COLORS[d.type];
    if (!color) return;
    const layers = [];
    if (d.type === "ruler") {
      const pts = d.points.map((p) => L.latLng(p[0], p[1]));
      pts.forEach((p) => layers.push(L.circleMarker(
        p,
        { radius: 4, color, fillColor: color, fillOpacity: 1 }
      ).addTo(map)));
      layers.push(L.polyline(pts, { color, weight: 2.5 }).addTo(map));
      const dist = pts[0].distanceTo(pts[1]);
      const txt = formatDist(dist);
      const midLat = (pts[0].lat + pts[1].lat) / 2, midLng = (pts[0].lng + pts[1].lng) / 2;
      layers.push(L.marker([midLat, midLng], { interactive: false, icon: L.divIcon({
        className: "ruler-label",
        html: `<span style="background:rgba(255,255,255,0.9);color:${color};font-weight:bold;font-size:12px;padding:2px 6px;border-radius:3px;white-space:nowrap;pointer-events:none">${txt}</span>`,
        iconAnchor: [0, 12]
      }) }).addTo(map));
      rulerHistory.push({ layers, text: txt, data: d });
    } else if (d.type === "protractor") {
      const pts = d.points.map((p) => L.latLng(p[0], p[1]));
      pts.forEach((p) => layers.push(L.circleMarker(
        p,
        { radius: 4, color, fillColor: color, fillOpacity: 1 }
      ).addTo(map)));
      layers.push(L.polyline([pts[0], pts[1]], { color, weight: 2 }).addTo(map));
      layers.push(L.polyline([pts[1], pts[2]], { color, weight: 2 }).addTo(map));
      const angle = computeAngle(pts[0], pts[1], pts[2]);
      const arc = drawAngleArc(pts[1], pts[0], pts[2], angle, color);
      if (arc) layers.push(arc);
      const txt = `${angle.toFixed(1)}\xB0`;
      layers.push(L.marker([pts[1].lat, pts[1].lng], { interactive: false, icon: L.divIcon({
        className: "prot-label",
        html: `<span style="background:rgba(255,255,255,0.9);color:${color};font-weight:bold;font-size:12px;padding:2px 6px;border-radius:3px;white-space:nowrap;pointer-events:none">${txt}</span>`,
        iconAnchor: [-8, 12]
      }) }).addTo(map));
      const d1 = pts[1].distanceTo(pts[0]), d2 = pts[1].distanceTo(pts[2]);
      protHistory.push({
        layers,
        text: `${txt} (${formatDist(d1)} / ${formatDist(d2)})`,
        data: d
      });
    } else if (d.type === "line") {
      const pts = d.points.map((p) => L.latLng(p[0], p[1]));
      const segLayers = [], segLabels = [];
      pts.forEach((p) => layers.push(L.circleMarker(
        p,
        { radius: 4, color, fillColor: color, fillOpacity: 1 }
      ).addTo(map)));
      for (let i = 1; i < pts.length; i++) {
        segLayers.push(L.polyline([pts[i - 1], pts[i]], { color, weight: 2.5 }).addTo(map));
        const sd = pts[i - 1].distanceTo(pts[i]);
        const ml = (pts[i - 1].lat + pts[i].lat) / 2;
        const mg = (pts[i - 1].lng + pts[i].lng) / 2;
        segLabels.push(L.marker([ml, mg], { interactive: false, icon: L.divIcon({
          className: "line-label",
          html: `<span style="background:rgba(255,255,255,0.9);color:${color};font-weight:bold;font-size:11px;padding:1px 5px;border-radius:3px;white-space:nowrap;pointer-events:none">${formatDist(sd)}</span>`,
          iconAnchor: [0, 12]
        }) }).addTo(map));
      }
      layers.push(...segLayers, ...segLabels);
      let total = 0;
      for (let i = 1; i < pts.length; i++) total += pts[i - 1].distanceTo(pts[i]);
      const txt = `${pts.length} pt \u2014 ${formatDist(total)}`;
      lineHistory.push({ layers, text: txt, data: d });
    } else if (d.type === "compass") {
      const center = L.latLng(d.center[0], d.center[1]);
      const edge = L.latLng(d.edge[0], d.edge[1]);
      const r = center.distanceTo(edge);
      layers.push(L.circleMarker(
        center,
        { radius: 5, color, fillColor: color, fillOpacity: 1 }
      ).addTo(map));
      layers.push(L.circle(center, {
        radius: r,
        color,
        weight: 2.5,
        fill: true,
        fillColor: color,
        fillOpacity: 0.08
      }).addTo(map));
      layers.push(L.polyline([center, edge], { color, weight: 2 }).addTo(map));
      layers.push(L.circleMarker(
        edge,
        { radius: 4, color, fillColor: color, fillOpacity: 1 }
      ).addTo(map));
      const midLat = (center.lat + edge.lat) / 2, midLng = (center.lng + edge.lng) / 2;
      layers.push(L.marker([midLat, midLng], { interactive: false, icon: L.divIcon({
        className: "compass-label",
        html: `<span style="background:rgba(255,255,255,0.9);color:${color};font-weight:bold;font-size:12px;padding:2px 6px;border-radius:3px;white-space:nowrap;pointer-events:none">r = ${formatDist(r)}</span>`,
        iconAnchor: [0, 12]
      }) }).addTo(map));
      const area = Math.PI * r * r;
      const shortTxt = `r=${formatDist(r)} A=${formatArea(area)}`;
      compassHistory.push({ layers, text: shortTxt, data: d });
    }
  }
  function collectToolData() {
    const all = [];
    rulerHistory.forEach((e) => {
      if (e.data) all.push(e.data);
    });
    protHistory.forEach((e) => {
      if (e.data) all.push(e.data);
    });
    lineHistory.forEach((e) => {
      if (e.data) all.push(e.data);
    });
    compassHistory.forEach((e) => {
      if (e.data) all.push(e.data);
    });
    return all;
  }
  function clearAllTools() {
    [rulerHistory, protHistory, lineHistory, compassHistory].forEach((arr) => {
      arr.forEach((e) => e.layers.forEach((l) => {
        try {
          map.removeLayer(l);
        } catch (x) {
        }
      }));
      arr.length = 0;
    });
    renderAllToolHistories();
  }
  function loadToolData(dataArr) {
    clearAllTools();
    dataArr.forEach((d) => restoreToolEntry(d));
    renderAllToolHistories();
  }
  var rulerPoints = [];
  var rulerMarkers = [];
  var rulerLine = null;
  var rulerMoveHandler = null;
  var rulerTempLine = null;
  var rulerLabel = null;
  var rulerLiveDist = null;
  function activateRuler() {
    document.getElementById("rulerInfo").style.display = "block";
    document.getElementById("rulerResult").textContent = "";
    if (isTouch) {
      const el = document.querySelector('#rulerInfo [data-i18n="tool.ruler.info"]');
      if (el) el.textContent = t("tool.ruler.infoTouch");
    }
    map.getContainer().classList.add("ruler-cursor");
    map.on("click", rulerClick);
  }
  function deactivateRuler() {
    document.getElementById("rulerInfo").style.display = "none";
    map.getContainer().classList.remove("ruler-cursor");
    map.off("click", rulerClick);
    resetRulerDraw();
  }
  function rulerClick(e) {
    if (rulerPoints.length >= 2) resetRulerDraw();
    const pt = snapToWaypoint(e.latlng);
    rulerPoints.push(pt);
    const color = TOOL_COLORS.ruler;
    rulerMarkers.push(L.circleMarker(
      pt,
      { radius: 5, color, fillColor: color, fillOpacity: 1 }
    ).addTo(map));
    if (rulerPoints.length === 1) {
      rulerTempLine = L.polyline([pt, pt], { color, weight: 2, dashArray: "6 4" }).addTo(map);
      rulerMoveHandler = (ev) => {
        const sp = snapToWaypoint(ev.latlng);
        rulerTempLine.setLatLngs([rulerPoints[0], sp]);
        const d = rulerPoints[0].distanceTo(sp);
        if (rulerLiveDist) map.removeLayer(rulerLiveDist);
        const mLat = (rulerPoints[0].lat + sp.lat) / 2;
        const mLng = (rulerPoints[0].lng + sp.lng) / 2;
        rulerLiveDist = L.marker([mLat, mLng], { interactive: false, icon: L.divIcon({
          className: "ruler-label",
          html: `<span style="background:rgba(255,255,255,0.85);color:#dc2626;font-weight:bold;font-size:12px;padding:1px 5px;border-radius:3px;white-space:nowrap;pointer-events:none">${formatDist(d)}</span>`,
          iconAnchor: [0, 12]
        }) }).addTo(map);
        status(`${t("msg.distance")}: ${formatDist(d)} \u2014 ${t("msg.clickEndPoint")}`);
      };
      map.on("mousemove", rulerMoveHandler);
    }
    if (rulerPoints.length === 2) {
      if (rulerTempLine) {
        map.removeLayer(rulerTempLine);
        rulerTempLine = null;
      }
      if (rulerMoveHandler) {
        map.off("mousemove", rulerMoveHandler);
        rulerMoveHandler = null;
      }
      if (rulerLiveDist) {
        map.removeLayer(rulerLiveDist);
        rulerLiveDist = null;
      }
      rulerLine = L.polyline(rulerPoints, { color, weight: 2.5 }).addTo(map);
      const dist = rulerPoints[0].distanceTo(rulerPoints[1]);
      const txt = formatDist(dist);
      const midLat = (rulerPoints[0].lat + rulerPoints[1].lat) / 2;
      const midLng = (rulerPoints[0].lng + rulerPoints[1].lng) / 2;
      rulerLabel = L.marker([midLat, midLng], { interactive: false, icon: L.divIcon({
        className: "ruler-label",
        html: `<span style="background:rgba(255,255,255,0.9);color:#dc2626;font-weight:bold;font-size:12px;padding:2px 6px;border-radius:3px;white-space:nowrap;pointer-events:none">${txt}</span>`,
        iconAnchor: [0, 12]
      }) }).addTo(map);
      document.getElementById("rulerResult").textContent = txt;
      status(`${t("msg.measuredDistance")}: ${txt}`);
      rulerHistory.push({
        layers: [...rulerMarkers, rulerLine, rulerLabel],
        text: txt,
        data: { type: "ruler", points: rulerPoints.map((p) => [p.lat, p.lng]) }
      });
      rulerMarkers = [];
      rulerLine = null;
      rulerLabel = null;
      rulerPoints = [];
      renderToolHistory("ruler", rulerHistory, TOOL_COLORS.ruler);
    }
  }
  function resetRulerDraw() {
    rulerMarkers.forEach((m) => map.removeLayer(m));
    rulerMarkers = [];
    rulerPoints = [];
    if (rulerLine) {
      map.removeLayer(rulerLine);
      rulerLine = null;
    }
    if (rulerTempLine) {
      map.removeLayer(rulerTempLine);
      rulerTempLine = null;
    }
    if (rulerMoveHandler) {
      map.off("mousemove", rulerMoveHandler);
      rulerMoveHandler = null;
    }
    if (rulerLabel) {
      map.removeLayer(rulerLabel);
      rulerLabel = null;
    }
    if (rulerLiveDist) {
      map.removeLayer(rulerLiveDist);
      rulerLiveDist = null;
    }
    document.getElementById("rulerResult").textContent = "";
  }
  var protPoints = [];
  var protMarkers = [];
  var protLines = [];
  var protArc = null;
  var protLabel = null;
  var protArm1Label = null;
  var protArm2Label = null;
  var protMoveHandler = null;
  var protTempLine = null;
  function activateProtractor() {
    document.getElementById("protractorInfo").style.display = "block";
    document.getElementById("protractorResult").textContent = "";
    if (isTouch) {
      const el = document.querySelector('#protractorInfo [data-i18n="tool.protractor.info"]');
      if (el) el.textContent = t("tool.protractor.infoTouch");
    }
    map.getContainer().classList.add("ruler-cursor");
    map.on("click", protractorClick);
  }
  function deactivateProtractor() {
    document.getElementById("protractorInfo").style.display = "none";
    map.getContainer().classList.remove("ruler-cursor");
    map.off("click", protractorClick);
    resetProtDraw();
  }
  function protractorClick(e) {
    if (protPoints.length >= 3) resetProtDraw();
    const pt = snapToWaypoint(e.latlng);
    protPoints.push(pt);
    const color = TOOL_COLORS.protractor;
    protMarkers.push(L.circleMarker(
      pt,
      { radius: 5, color, fillColor: color, fillOpacity: 1 }
    ).addTo(map));
    if (protPoints.length === 1) {
      protTempLine = L.polyline([pt, pt], { color, weight: 2, dashArray: "6 4" }).addTo(map);
      protMoveHandler = (ev) => {
        const sp = snapToWaypoint(ev.latlng);
        protTempLine.setLatLngs([protPoints[0], sp]);
        status(t("msg.protClickVertex"));
      };
      map.on("mousemove", protMoveHandler);
    }
    if (protPoints.length === 2) {
      if (protTempLine) {
        map.removeLayer(protTempLine);
        protTempLine = null;
      }
      if (protMoveHandler) {
        map.off("mousemove", protMoveHandler);
        protMoveHandler = null;
      }
      protLines.push(L.polyline([protPoints[0], protPoints[1]], { color, weight: 2.5 }).addTo(map));
      protTempLine = L.polyline(
        [protPoints[1], protPoints[1]],
        { color, weight: 2, dashArray: "6 4" }
      ).addTo(map);
      protMoveHandler = (ev) => {
        const sp = snapToWaypoint(ev.latlng);
        protTempLine.setLatLngs([protPoints[1], sp]);
        const angle = computeAngle(protPoints[0], protPoints[1], sp);
        if (protLabel) map.removeLayer(protLabel);
        protLabel = L.marker(
          [protPoints[1].lat, protPoints[1].lng],
          { interactive: false, icon: L.divIcon({
            className: "prot-label",
            html: `<span style="background:rgba(255,255,255,0.85);color:#7c3aed;font-weight:bold;font-size:12px;padding:1px 5px;border-radius:3px;white-space:nowrap;pointer-events:none">${angle.toFixed(1)}\xB0</span>`,
            iconAnchor: [-8, 12]
          }) }
        ).addTo(map);
        status(`${t("msg.angle")}: ${angle.toFixed(1)}\xB0 \u2014 ${t("msg.clickToFix")}`);
      };
      map.on("mousemove", protMoveHandler);
    }
    if (protPoints.length === 3) {
      if (protTempLine) {
        map.removeLayer(protTempLine);
        protTempLine = null;
      }
      if (protMoveHandler) {
        map.off("mousemove", protMoveHandler);
        protMoveHandler = null;
      }
      protLines.push(L.polyline([protPoints[1], protPoints[2]], { color, weight: 2.5 }).addTo(map));
      const angle = computeAngle(protPoints[0], protPoints[1], protPoints[2]);
      protArc = drawAngleArc(protPoints[1], protPoints[0], protPoints[2], angle, color);
      const txt = `${angle.toFixed(1)}\xB0`;
      document.getElementById("protractorResult").textContent = txt;
      const d1 = protPoints[1].distanceTo(protPoints[0]);
      const d2 = protPoints[1].distanceTo(protPoints[2]);
      if (protLabel) map.removeLayer(protLabel);
      protLabel = L.marker(
        [protPoints[1].lat, protPoints[1].lng],
        { interactive: false, icon: L.divIcon({
          className: "prot-label",
          html: `<span style="background:rgba(255,255,255,0.9);color:#7c3aed;font-weight:bold;font-size:12px;padding:2px 6px;border-radius:3px;white-space:nowrap;pointer-events:none">${txt}</span>`,
          iconAnchor: [-8, 12]
        }) }
      ).addTo(map);
      const mid1Lat = (protPoints[0].lat + protPoints[1].lat) / 2;
      const mid1Lng = (protPoints[0].lng + protPoints[1].lng) / 2;
      protArm1Label = L.marker([mid1Lat, mid1Lng], { interactive: false, icon: L.divIcon({
        className: "prot-label",
        html: `<span style="background:rgba(255,255,255,0.9);color:#7c3aed;font-weight:bold;font-size:11px;padding:1px 5px;border-radius:3px;white-space:nowrap;pointer-events:none">${formatDist(d1)}</span>`,
        iconAnchor: [0, 12]
      }) }).addTo(map);
      const mid2Lat = (protPoints[1].lat + protPoints[2].lat) / 2;
      const mid2Lng = (protPoints[1].lng + protPoints[2].lng) / 2;
      protArm2Label = L.marker([mid2Lat, mid2Lng], { interactive: false, icon: L.divIcon({
        className: "prot-label",
        html: `<span style="background:rgba(255,255,255,0.9);color:#7c3aed;font-weight:bold;font-size:11px;padding:1px 5px;border-radius:3px;white-space:nowrap;pointer-events:none">${formatDist(d2)}</span>`,
        iconAnchor: [0, 12]
      }) }).addTo(map);
      status(`${t("msg.measuredAngle")}: ${txt}  |  ${t("msg.arm")} 1: ${formatDist(d1)}  |  ${t("msg.arm")} 2: ${formatDist(d2)}`);
      const allLayers = [...protMarkers, ...protLines];
      if (protArc) allLayers.push(protArc);
      if (protLabel) allLayers.push(protLabel);
      if (protArm1Label) allLayers.push(protArm1Label);
      if (protArm2Label) allLayers.push(protArm2Label);
      protHistory.push({
        layers: allLayers,
        text: `${txt} (${formatDist(d1)} / ${formatDist(d2)})`,
        data: { type: "protractor", points: protPoints.map((p) => [p.lat, p.lng]) }
      });
      protMarkers = [];
      protLines = [];
      protArc = null;
      protLabel = null;
      protArm1Label = null;
      protArm2Label = null;
      protPoints = [];
      renderToolHistory("protractor", protHistory, TOOL_COLORS.protractor);
    }
  }
  function resetProtDraw() {
    protMarkers.forEach((m) => map.removeLayer(m));
    protMarkers = [];
    protLines.forEach((l) => map.removeLayer(l));
    protLines = [];
    if (protArc) {
      map.removeLayer(protArc);
      protArc = null;
    }
    if (protLabel) {
      map.removeLayer(protLabel);
      protLabel = null;
    }
    if (protArm1Label) {
      map.removeLayer(protArm1Label);
      protArm1Label = null;
    }
    if (protArm2Label) {
      map.removeLayer(protArm2Label);
      protArm2Label = null;
    }
    if (protTempLine) {
      map.removeLayer(protTempLine);
      protTempLine = null;
    }
    if (protMoveHandler) {
      map.off("mousemove", protMoveHandler);
      protMoveHandler = null;
    }
    protPoints = [];
    document.getElementById("protractorResult").textContent = "";
  }
  var linePoints = [];
  var lineMarkers = [];
  var lineSegments = [];
  var lineSegLabels = [];
  var lineMoveHandler = null;
  var lineTempLine = null;
  var lineLiveDist = null;
  function activateLine() {
    if (linePoints.length >= 2) {
      lineFinish();
      return;
    }
    document.getElementById("lineInfo").style.display = "block";
    document.getElementById("lineResult").textContent = "";
    if (isTouch) {
      const el = document.querySelector('#lineInfo [data-i18n="tool.line.info"]');
      if (el) el.textContent = t("tool.line.infoTouch");
    }
    map.getContainer().classList.add("ruler-cursor");
    map.on("click", lineClick);
    map.on("dblclick", lineFinish);
    map.on("contextmenu", lineFinishRight);
  }
  function deactivateLine() {
    if (linePoints.length >= 2) lineFinish();
    document.getElementById("lineInfo").style.display = "none";
    map.getContainer().classList.remove("ruler-cursor");
    map.off("click", lineClick);
    map.off("dblclick", lineFinish);
    map.off("contextmenu", lineFinishRight);
    resetLineDraw();
  }
  function lineClick(e) {
    const color = TOOL_COLORS.line;
    const pt = snapToWaypoint(e.latlng);
    linePoints.push(pt);
    lineMarkers.push(L.circleMarker(
      pt,
      { radius: 4, color, fillColor: color, fillOpacity: 1 }
    ).addTo(map));
    if (linePoints.length > 1) {
      const prev = linePoints[linePoints.length - 2];
      lineSegments.push(L.polyline([prev, pt], { color, weight: 2.5 }).addTo(map));
      const segDist = prev.distanceTo(pt);
      const midLat = (prev.lat + pt.lat) / 2;
      const midLng = (prev.lng + pt.lng) / 2;
      lineSegLabels.push(L.marker(
        [midLat, midLng],
        { interactive: false, icon: L.divIcon({
          className: "line-label",
          html: `<span style="background:rgba(255,255,255,0.9);color:#0891b2;font-weight:bold;font-size:11px;padding:1px 5px;border-radius:3px;white-space:nowrap;pointer-events:none">${formatDist(segDist)}</span>`,
          iconAnchor: [0, 12]
        }) }
      ).addTo(map));
      if (lineTempLine) {
        map.removeLayer(lineTempLine);
        lineTempLine = null;
      }
      if (lineMoveHandler) {
        map.off("mousemove", lineMoveHandler);
        lineMoveHandler = null;
      }
    }
    lineTempLine = L.polyline([pt, pt], { color, weight: 2, dashArray: "6 4" }).addTo(map);
    lineMoveHandler = (ev) => {
      const sp = snapToWaypoint(ev.latlng);
      lineTempLine.setLatLngs([linePoints[linePoints.length - 1], sp]);
      const segDist = linePoints[linePoints.length - 1].distanceTo(sp);
      const totalDist = lineTotalDist() + segDist;
      if (lineLiveDist) map.removeLayer(lineLiveDist);
      const mLat = (linePoints[linePoints.length - 1].lat + sp.lat) / 2;
      const mLng = (linePoints[linePoints.length - 1].lng + sp.lng) / 2;
      lineLiveDist = L.marker([mLat, mLng], { interactive: false, icon: L.divIcon({
        className: "line-label",
        html: `<span style="background:rgba(255,255,255,0.85);color:#0891b2;font-weight:bold;font-size:11px;padding:1px 5px;border-radius:3px;white-space:nowrap;pointer-events:none">${formatDist(segDist)}</span>`,
        iconAnchor: [0, 12]
      }) }).addTo(map);
      let info = `${t("msg.segment")}: ${formatDist(segDist)} | ${t("msg.total")}: ${formatDist(totalDist)}`;
      if (linePoints.length >= 2) {
        const prev = linePoints[linePoints.length - 2];
        const cur = linePoints[linePoints.length - 1];
        const angle = computeAngle(prev, cur, sp);
        info += ` | ${t("msg.angle")}: ${angle.toFixed(1)}\xB0`;
      }
      info += ` \u2014 ${t("msg.rightClickFinish")}`;
      status(info);
    };
    map.on("mousemove", lineMoveHandler);
    updateLineResult();
    updateLineUndoBtn();
    updateMobileToolBar();
  }
  function lineFinishRight(e) {
    if (e && e.originalEvent) e.originalEvent.preventDefault();
    lineFinish();
  }
  function lineFinish() {
    if (lineTempLine) {
      map.removeLayer(lineTempLine);
      lineTempLine = null;
    }
    if (lineMoveHandler) {
      map.off("mousemove", lineMoveHandler);
      lineMoveHandler = null;
    }
    if (lineLiveDist) {
      map.removeLayer(lineLiveDist);
      lineLiveDist = null;
    }
    if (linePoints.length >= 2) {
      const txt = `${linePoints.length} pt \u2014 ${formatDist(lineTotalDist())}`;
      updateLineResult();
      status(`${t("msg.trackComplete")}: ${linePoints.length} ${t("msg.points")}, ${formatDist(lineTotalDist())}`);
      lineHistory.push({
        layers: [...lineMarkers, ...lineSegments, ...lineSegLabels],
        text: txt,
        data: { type: "line", points: linePoints.map((p) => [p.lat, p.lng]) }
      });
      lineMarkers = [];
      lineSegments = [];
      lineSegLabels = [];
      linePoints = [];
      renderToolHistory("line", lineHistory, TOOL_COLORS.line);
    }
    updateMobileToolBar();
  }
  function lineTotalDist() {
    let total = 0;
    for (let i = 1; i < linePoints.length; i++) total += linePoints[i - 1].distanceTo(linePoints[i]);
    return total;
  }
  function updateLineResult() {
    const el = document.getElementById("lineResult");
    if (linePoints.length < 2) {
      el.textContent = "";
      return;
    }
    let txt = `${linePoints.length} ${t("msg.points")} \u2014 ${t("msg.total")}: ${formatDist(lineTotalDist())}`;
    const parts = [];
    for (let i = 1; i < linePoints.length; i++) {
      parts.push(formatDist(linePoints[i - 1].distanceTo(linePoints[i])));
    }
    txt += `
${t("msg.segments")}: ${parts.join(" \u2192 ")}`;
    if (linePoints.length >= 3) {
      const angles = [];
      for (let i = 1; i < linePoints.length - 1; i++) {
        angles.push(
          computeAngle(linePoints[i - 1], linePoints[i], linePoints[i + 1]).toFixed(1) + "\xB0"
        );
      }
      txt += `
${t("msg.angles")}: ${angles.join(", ")}`;
    }
    el.textContent = txt;
  }
  function updateLineUndoBtn() {
    const btn = document.getElementById("btnLineUndo");
    if (!btn) return;
    btn.style.display = linePoints.length || lineHistory.length ? "" : "none";
  }
  function lineUndo() {
    if (linePoints.length) {
      linePoints.pop();
      if (lineMarkers.length) map.removeLayer(lineMarkers.pop());
      if (lineSegments.length) map.removeLayer(lineSegments.pop());
      if (lineSegLabels.length) map.removeLayer(lineSegLabels.pop());
      if (lineTempLine) {
        map.removeLayer(lineTempLine);
        lineTempLine = null;
      }
      if (lineMoveHandler) {
        map.off("mousemove", lineMoveHandler);
        lineMoveHandler = null;
      }
      if (lineLiveDist) {
        map.removeLayer(lineLiveDist);
        lineLiveDist = null;
      }
      if (linePoints.length) {
        const color = TOOL_COLORS.line;
        const lastPt = linePoints[linePoints.length - 1];
        lineTempLine = L.polyline(
          [lastPt, lastPt],
          { color, weight: 2, dashArray: "6 4" }
        ).addTo(map);
        lineMoveHandler = (ev) => {
          lineTempLine.setLatLngs([linePoints[linePoints.length - 1], ev.latlng]);
          const segDist = linePoints[linePoints.length - 1].distanceTo(ev.latlng);
          const totalDist = lineTotalDist() + segDist;
          if (lineLiveDist) map.removeLayer(lineLiveDist);
          const mLat = (linePoints[linePoints.length - 1].lat + ev.latlng.lat) / 2;
          const mLng = (linePoints[linePoints.length - 1].lng + ev.latlng.lng) / 2;
          lineLiveDist = L.marker([mLat, mLng], { interactive: false, icon: L.divIcon({
            className: "line-label",
            html: `<span style="background:rgba(255,255,255,0.85);color:#0891b2;font-weight:bold;font-size:11px;padding:1px 5px;border-radius:3px;white-space:nowrap;pointer-events:none">${formatDist(segDist)}</span>`,
            iconAnchor: [0, 12]
          }) }).addTo(map);
          let info = `${t("msg.segment")}: ${formatDist(segDist)} | ${t("msg.total")}: ${formatDist(totalDist)}`;
          if (linePoints.length >= 2) {
            const prev = linePoints[linePoints.length - 2];
            const cur = linePoints[linePoints.length - 1];
            const angle = computeAngle(prev, cur, ev.latlng);
            info += ` | ${t("msg.angle")}: ${angle.toFixed(1)}\xB0`;
          }
          info += ` \u2014 ${t("msg.rightClickFinish")}`;
          status(info);
        };
        map.on("mousemove", lineMoveHandler);
      }
      updateLineResult();
    } else if (lineHistory.length) {
      const last = lineHistory.pop();
      last.layers.forEach((l) => {
        try {
          map.removeLayer(l);
        } catch (e) {
        }
      });
      const pts = last.data.points;
      pts.pop();
      if (pts.length >= 2) {
        const color = TOOL_COLORS.line;
        const markers = [], segs = [], labels = [];
        for (let i = 0; i < pts.length; i++) {
          markers.push(L.circleMarker(
            pts[i],
            { radius: 4, color, fillColor: color, fillOpacity: 1 }
          ).addTo(map));
          if (i > 0) {
            segs.push(L.polyline(
              [pts[i - 1], pts[i]],
              { color, weight: 2.5 }
            ).addTo(map));
            const d = L.latLng(pts[i - 1]).distanceTo(L.latLng(pts[i]));
            const mLat = (pts[i - 1][0] + pts[i][0]) / 2;
            const mLng = (pts[i - 1][1] + pts[i][1]) / 2;
            labels.push(L.marker([mLat, mLng], { interactive: false, icon: L.divIcon({
              className: "line-label",
              html: `<span style="background:rgba(255,255,255,0.9);color:#0891b2;font-weight:bold;font-size:11px;padding:1px 5px;border-radius:3px;white-space:nowrap;pointer-events:none">${formatDist(d)}</span>`,
              iconAnchor: [0, 12]
            }) }).addTo(map));
          }
        }
        let total = 0;
        for (let i = 1; i < pts.length; i++) {
          total += L.latLng(pts[i - 1]).distanceTo(L.latLng(pts[i]));
        }
        const txt = `${pts.length} pt \u2014 ${formatDist(total)}`;
        lineHistory.push({
          layers: [...markers, ...segs, ...labels],
          text: txt,
          data: { type: "line", points: pts }
        });
      }
      renderToolHistory("line", lineHistory, TOOL_COLORS.line);
    }
    updateLineUndoBtn();
    updateMobileToolBar();
  }
  function resetLineDraw() {
    lineMarkers.forEach((m) => map.removeLayer(m));
    lineMarkers = [];
    lineSegments.forEach((s) => map.removeLayer(s));
    lineSegments = [];
    lineSegLabels.forEach((l) => map.removeLayer(l));
    lineSegLabels = [];
    if (lineTempLine) {
      map.removeLayer(lineTempLine);
      lineTempLine = null;
    }
    if (lineMoveHandler) {
      map.off("mousemove", lineMoveHandler);
      lineMoveHandler = null;
    }
    if (lineLiveDist) {
      map.removeLayer(lineLiveDist);
      lineLiveDist = null;
    }
    linePoints = [];
    document.getElementById("lineResult").textContent = "";
  }
  var compassCenter = null;
  var compassCenterMarker = null;
  var compassCircle = null;
  var compassRadiusLine = null;
  var compassMoveHandler = null;
  var compassFixed = false;
  var compassRadiusLabel = null;
  var compassCircumfLabel = null;
  var compassAreaLabel = null;
  function activateCompass() {
    document.getElementById("compassInfo").style.display = "block";
    document.getElementById("compassResult").textContent = "";
    if (isTouch) {
      const el = document.querySelector('#compassInfo [data-i18n="tool.compass.info"]');
      if (el) el.textContent = t("tool.compass.infoTouch");
    }
    compassFixed = false;
    map.getContainer().classList.add("ruler-cursor");
    map.on("click", compassClick);
  }
  function deactivateCompass() {
    document.getElementById("compassInfo").style.display = "none";
    map.getContainer().classList.remove("ruler-cursor");
    map.off("click", compassClick);
    resetCompassDraw();
  }
  function compassClick(e) {
    const color = TOOL_COLORS.compass;
    if (!compassCenter) {
      const pt = snapToWaypoint(e.latlng);
      compassCenter = pt;
      compassCenterMarker = L.circleMarker(
        pt,
        { radius: 5, color, fillColor: color, fillOpacity: 1 }
      ).addTo(map);
      compassMoveHandler = (ev) => {
        const sp = snapToWaypoint(ev.latlng);
        const r = compassCenter.distanceTo(sp);
        if (compassCircle) map.removeLayer(compassCircle);
        if (compassRadiusLine) map.removeLayer(compassRadiusLine);
        if (compassRadiusLabel) map.removeLayer(compassRadiusLabel);
        compassCircle = L.circle(compassCenter, {
          radius: r,
          color,
          weight: 2,
          fill: true,
          fillColor: color,
          fillOpacity: 0.08
        }).addTo(map);
        compassRadiusLine = L.polyline(
          [compassCenter, sp],
          { color, weight: 2, dashArray: "6 4" }
        ).addTo(map);
        const midLat = (compassCenter.lat + sp.lat) / 2;
        const midLng = (compassCenter.lng + sp.lng) / 2;
        compassRadiusLabel = L.marker(
          [midLat, midLng],
          { interactive: false, icon: L.divIcon({
            className: "compass-label",
            html: `<span style="background:rgba(255,255,255,0.85);color:#ea580c;font-weight:bold;font-size:12px;padding:1px 5px;border-radius:3px;white-space:nowrap;pointer-events:none">r = ${formatDist(r)}</span>`,
            iconAnchor: [0, 12]
          }) }
        ).addTo(map);
        const area = Math.PI * r * r;
        const circumf = 2 * Math.PI * r;
        status(`${t("msg.radius")}: ${formatDist(r)} | ${t("msg.diameter")}: ${formatDist(r * 2)} | ${t("msg.circumference")}: ${formatDist(circumf)} | ${t("msg.area")}: ${formatArea(area)}`);
      };
      map.on("mousemove", compassMoveHandler);
    } else {
      const pt = snapToWaypoint(e.latlng);
      if (compassMoveHandler) {
        map.off("mousemove", compassMoveHandler);
        compassMoveHandler = null;
      }
      const r = compassCenter.distanceTo(pt);
      if (compassCircle) map.removeLayer(compassCircle);
      if (compassRadiusLine) map.removeLayer(compassRadiusLine);
      compassCircle = L.circle(compassCenter, {
        radius: r,
        color,
        weight: 2.5,
        fill: true,
        fillColor: color,
        fillOpacity: 0.08
      }).addTo(map);
      compassRadiusLine = L.polyline([compassCenter, pt], { color, weight: 2 }).addTo(map);
      const edgeMarker = L.circleMarker(
        pt,
        { radius: 4, color, fillColor: color, fillOpacity: 1 }
      ).addTo(map);
      const area = Math.PI * r * r;
      const circumf = 2 * Math.PI * r;
      if (compassRadiusLabel) map.removeLayer(compassRadiusLabel);
      const midLat = (compassCenter.lat + pt.lat) / 2;
      const midLng = (compassCenter.lng + pt.lng) / 2;
      compassRadiusLabel = L.marker(
        [midLat, midLng],
        { interactive: false, icon: L.divIcon({
          className: "compass-label",
          html: `<span style="background:rgba(255,255,255,0.9);color:#ea580c;font-weight:bold;font-size:12px;padding:2px 6px;border-radius:3px;white-space:nowrap;pointer-events:none">r = ${formatDist(r)}</span>`,
          iconAnchor: [0, 12]
        }) }
      ).addTo(map);
      const topLat = compassCenter.lat + r / 111320;
      compassCircumfLabel = L.marker(
        [topLat, compassCenter.lng],
        { interactive: false, icon: L.divIcon({
          className: "compass-label",
          html: `<span style="background:rgba(255,255,255,0.9);color:#ea580c;font-weight:bold;font-size:12px;padding:2px 6px;border-radius:3px;white-space:nowrap;pointer-events:none">C = ${formatDist(circumf)}</span>`,
          iconAnchor: [30, 24]
        }) }
      ).addTo(map);
      compassAreaLabel = L.marker(
        [compassCenter.lat, compassCenter.lng],
        { interactive: false, icon: L.divIcon({
          className: "compass-label",
          html: `<span style="background:rgba(255,255,255,0.9);color:#ea580c;font-weight:bold;font-size:11px;padding:2px 6px;border-radius:3px;white-space:nowrap;pointer-events:none">A = ${formatArea(area)}</span>`,
          iconAnchor: [30, 6]
        }) }
      ).addTo(map);
      const shortTxt = `r=${formatDist(r)} A=${formatArea(area)}`;
      const fullTxt = `${t("msg.radius")}: ${formatDist(r)} | ${t("msg.diameter")}: ${formatDist(r * 2)}
${t("msg.circumference")}: ${formatDist(circumf)} | ${t("msg.area")}: ${formatArea(area)}`;
      document.getElementById("compassResult").textContent = fullTxt;
      status(`${t("msg.circleFixed")} \u2014 ${fullTxt.replace(/\n/g, " | ")}`);
      const layers = [
        compassCenterMarker,
        compassCircle,
        compassRadiusLine,
        compassRadiusLabel,
        compassCircumfLabel,
        compassAreaLabel,
        edgeMarker
      ].filter(Boolean);
      compassHistory.push({
        layers,
        text: shortTxt,
        data: { type: "compass", center: [compassCenter.lat, compassCenter.lng], edge: [pt.lat, pt.lng] }
      });
      compassCenterMarker = null;
      compassCircle = null;
      compassRadiusLine = null;
      compassRadiusLabel = null;
      compassCircumfLabel = null;
      compassAreaLabel = null;
      compassCenter = null;
      compassFixed = false;
      renderToolHistory("compass", compassHistory, TOOL_COLORS.compass);
    }
  }
  function resetCompassDraw() {
    if (compassCenterMarker) {
      map.removeLayer(compassCenterMarker);
      compassCenterMarker = null;
    }
    if (compassCircle) {
      map.removeLayer(compassCircle);
      compassCircle = null;
    }
    if (compassRadiusLine) {
      map.removeLayer(compassRadiusLine);
      compassRadiusLine = null;
    }
    if (compassMoveHandler) {
      map.off("mousemove", compassMoveHandler);
      compassMoveHandler = null;
    }
    if (compassRadiusLabel) {
      map.removeLayer(compassRadiusLabel);
      compassRadiusLabel = null;
    }
    if (compassCircumfLabel) {
      map.removeLayer(compassCircumfLabel);
      compassCircumfLabel = null;
    }
    if (compassAreaLabel) {
      map.removeLayer(compassAreaLabel);
      compassAreaLabel = null;
    }
    compassCenter = null;
    compassFixed = false;
    document.getElementById("compassResult").textContent = "";
  }
  var TOOL_TABLE = {
    ruler: { btn: $btnRuler, activate: activateRuler, deactivate: deactivateRuler },
    protractor: { btn: $btnProtractor, activate: activateProtractor, deactivate: deactivateProtractor },
    line: { btn: $btnLine, activate: activateLine, deactivate: deactivateLine },
    compass: { btn: $btnCompass, activate: activateCompass, deactivate: deactivateCompass }
  };
  function toggleTool(name) {
    if (state.activeTool === name) {
      deactivateAllTools();
      return;
    }
    deactivateAllTools();
    state.activeTool = name;
    const tool = TOOL_TABLE[name];
    if (tool) {
      tool.btn.classList.add("active");
      tool.activate();
    }
    renderWaypointMarkers();
    map.doubleClickZoom.disable();
    if (window.innerWidth <= 768 || isTouch) {
      closeSidebarMobile();
      showMobileToolBar();
      updateMobileToolBar();
    }
  }
  function deactivateAllTools() {
    if (state.activeTool && TOOL_TABLE[state.activeTool]) {
      TOOL_TABLE[state.activeTool].deactivate();
    }
    state.activeTool = null;
    for (const k of Object.keys(TOOL_TABLE)) TOOL_TABLE[k].btn.classList.remove("active");
    renderWaypointMarkers();
    if (state.wpMapActive) deactivateWaypoint();
    map.doubleClickZoom.enable();
    hideMobileToolBar();
  }
  function updateMobileToolBar() {
    if (!$mobileToolBar.classList.contains("visible")) return;
    $mtbDone.style.display = state.activeTool === "line" && linePoints.length >= 2 ? "" : "none";
    $mtbUndo.style.display = state.activeTool === "line" && (linePoints.length > 0 || lineHistory.length > 0) ? "" : "none";
  }

  // cartograpy/static/src/config.js
  var CONFIG_FIELDS = {
    scale: { el: () => $scale, type: "value" },
    paper: { el: () => $paper, type: "value" },
    sheets: { el: () => $sheets, type: "value" },
    landscape: { el: () => $landscape, type: "checked" },
    source: { el: () => $source, type: "value" },
    dpi: { el: () => $dpi, type: "value" },
    mapTextScale: { el: () => $mapTextScale, type: "value" },
    gridType: { el: () => $gridType, type: "value" },
    gridScale: { el: () => $gridScale, type: "value" },
    fullLabels: { el: () => $fullLabels, type: "checked" },
    language: { el: () => document.getElementById("language"), type: "value" },
    owmApiKey: { el: () => document.getElementById("owmApiKey"), type: "value" }
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
  function scheduleSaveConfig() {
    clearTimeout(state.cfgTimer);
    state.cfgTimer = setTimeout(saveConfig, 800);
  }
  async function saveConfig() {
    try {
      await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gatherConfig())
      });
    } catch (e) {
    }
  }
  async function loadConfig() {
    try {
      const res = await fetch("/api/config");
      const cfg = await res.json();
      if (!cfg || !cfg.scale) return;
      for (const [k, def] of Object.entries(CONFIG_FIELDS)) {
        if (cfg[k] !== void 0) def.el()[def.type] = cfg[k];
      }
      if (cfg.lat && cfg.lon) map.setView([cfg.lat, cfg.lon], cfg.zoom || 13);
      const src = $source.value;
      Object.values(tileLayers).forEach((tl) => map.removeLayer(tl));
      if (tileLayers[src]) {
        tileLayers[src].addTo(map);
        state.activeBaseLayerName = src;
      }
      await loadLanguage(document.getElementById("language").value || "en");
      if (Array.isArray(cfg.searchHistory)) {
        searchHistory.length = 0;
        searchHistory.push(...cfg.searchHistory.slice(0, MAX_HISTORY));
        renderHistory();
      }
      showOwmState();
      populateOverlayPanel();
      if (Array.isArray(cfg.overlays)) {
        selectedOverlays.clear();
        cfg.overlays.forEach((id) => selectedOverlays.add(id));
        populateOverlayPanel();
        applyOverlays();
      }
    } catch (e) {
    }
  }
  function attachAutoSaveListeners() {
    [$scale, $paper, $sheets, $source, $dpi, $mapTextScale, $gridType, $gridScale].forEach((el) => el.addEventListener("change", scheduleSaveConfig));
    $sheets.addEventListener("input", scheduleSaveConfig);
    [$landscape, $fullLabels].forEach((el) => el.addEventListener("change", scheduleSaveConfig));
    map.on("moveend", scheduleSaveConfig);
  }
  var $owmHidden = document.getElementById("owmApiKey");
  var $owmField = document.getElementById("owmKeyField");
  var $owmInput = document.getElementById("owmKeyInput");
  var $owmBadge = document.getElementById("owmKeyBadge");
  var $owmError = document.getElementById("owmKeyError");
  function showOwmState() {
    const hasKey = !!$owmHidden.value.trim();
    $owmInput.style.display = hasKey ? "none" : "";
    $owmBadge.style.display = hasKey ? "" : "none";
    $owmError.textContent = "";
    $owmError.style.display = "none";
  }
  async function validateOwmKey(key) {
    try {
      const res = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?q=London&appid=${encodeURIComponent(key)}`
      );
      return res.ok;
    } catch {
      return false;
    }
  }
  function setupOwmKeyUI() {
    document.getElementById("owmKeyConfirm").addEventListener("click", async () => {
      const key = $owmField.value.trim();
      if (!key) return;
      const btn = document.getElementById("owmKeyConfirm");
      btn.disabled = true;
      $owmError.style.display = "none";
      const ok = await validateOwmKey(key);
      btn.disabled = false;
      if (ok) {
        $owmHidden.value = key;
        $owmField.value = "";
        showOwmState();
        populateOverlayPanel();
        scheduleSaveConfig();
      } else {
        $owmError.textContent = t("label.owmInvalidKey");
        $owmError.style.display = "block";
      }
    });
    $owmField.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        document.getElementById("owmKeyConfirm").click();
      }
    });
    document.getElementById("owmKeyDelete").addEventListener("click", () => {
      $owmHidden.value = "";
      for (const def of overlays.defs) {
        if (def.requires === "owm") selectedOverlays.delete(def.id);
      }
      showOwmState();
      populateOverlayPanel();
      applyOverlays();
      scheduleSaveConfig();
    });
    document.getElementById("language").addEventListener("change", async () => {
      await loadLanguage(document.getElementById("language").value);
      populateOverlayPanel();
      scheduleSaveConfig();
    });
  }
  async function exportPDF() {
    const c = map.getCenter();
    const params = {
      lat: c.lat,
      lon: c.lng,
      scale: parseInt($scale.value) || 25e3,
      paper: $paper.value,
      landscape: $landscape.checked,
      dpi: parseInt($dpi.value) || 300,
      source: $source.value,
      grid_type: $gridType.value,
      grid_full_labels: $fullLabels.checked,
      grid_scale: parseInt($gridScale.value) || 50,
      map_text_scale: parseInt($mapTextScale.value) || 50,
      sheets: parseInt($sheets.value) || 1,
      waypoints: waypoints.map((w) => ({
        lat: w.lat,
        lng: w.lng,
        icon: w.icon,
        color: w.color,
        name: w.name || ""
      })),
      drawings: document.getElementById("chkToolsInPdf").checked ? collectToolData() : []
    };
    $btnExport.disabled = true;
    $btnExport.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${t("status.generating")}`;
    status(t("status.exporting"));
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params)
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mappa_${params.scale}_${params.paper}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      status(t("status.exported"));
    } catch (e) {
      status(t("msg.exportError") + e.message);
      alert(t("msg.error") + e.message);
    } finally {
      $btnExport.disabled = false;
      $btnExport.innerHTML = `<i class="fa-solid fa-file-pdf"></i> <span data-i18n="btn.export">${t("btn.export")}</span>`;
    }
  }

  // cartograpy/static/src/print.js
  function computeSheetLayout(n, landscape) {
    if (n <= 1) return { cols: 1, rows: 1 };
    let cols, rows;
    if (landscape) {
      cols = Math.ceil(Math.sqrt(n));
      rows = Math.ceil(n / cols);
    } else {
      rows = Math.ceil(Math.sqrt(n));
      cols = Math.ceil(n / rows);
    }
    return { cols, rows };
  }
  function getPrintAreaMetres() {
    const scale = parseInt($scale.value) || 25e3;
    const pKey = $paper.value;
    let [pw, ph] = PAPERS[pKey] || [210, 297];
    if ($landscape.checked) [pw, ph] = [ph, pw];
    const margins = 10;
    const sheetW = (pw - 2 * margins) * scale / 1e3;
    const sheetH = (ph - 2 * margins - 20) * scale / 1e3;
    const n = Math.max(1, parseInt($sheets.value) || 1);
    const { cols, rows } = computeSheetLayout(n, $landscape.checked);
    const overlap_mm = 10;
    const stepW = (pw - 2 * margins - overlap_mm) * scale / 1e3;
    const stepH = (ph - 2 * margins - 20 - overlap_mm) * scale / 1e3;
    const wM = sheetW + (cols - 1) * stepW;
    const hM = sheetH + (rows - 1) * stepH;
    return { wM, hM, scale, cols, rows, sheetW, sheetH, stepW, stepH };
  }
  function updateOverlays() {
    drawPrintRect();
    scheduleGridUpdate();
  }
  function drawPrintRect() {
    if (state.printRect) {
      map.removeLayer(state.printRect);
      state.printRect = null;
    }
    sheetDividers.forEach((l) => map.removeLayer(l));
    sheetDividers.length = 0;
    const center = map.getCenter();
    const { wM, hM, cols, rows, stepW, stepH } = getPrintAreaMetres();
    const dLat = hM / 2 / 111320;
    const dLon = wM / 2 / (111320 * Math.cos(center.lat * Math.PI / 180));
    const south = center.lat - dLat, north = center.lat + dLat;
    const west = center.lng - dLon, east = center.lng + dLon;
    state.printRect = L.rectangle(
      [[south, west], [north, east]],
      { color: "#e11d48", weight: 3, fill: false, dashArray: "10 6", interactive: false }
    ).addTo(map);
    const cosLat = Math.cos(center.lat * Math.PI / 180);
    for (let c = 1; c < cols; c++) {
      const lon = west + stepW * c / (111320 * cosLat);
      sheetDividers.push(L.polyline(
        [[south, lon], [north, lon]],
        { color: "#e11d48", weight: 1.5, dashArray: "6 4", interactive: false }
      ).addTo(map));
    }
    for (let r = 1; r < rows; r++) {
      const lat = north - stepH * r / 111320;
      sheetDividers.push(L.polyline(
        [[lat, west], [lat, east]],
        { color: "#e11d48", weight: 1.5, dashArray: "6 4", interactive: false }
      ).addTo(map));
    }
  }
  function scheduleGridUpdate() {
    drawPrintRect();
    if (state.gridTimeout) clearTimeout(state.gridTimeout);
    state.gridTimeout = setTimeout(fetchGrid, 400);
  }
  async function fetchGrid() {
    if (state.gridLayer) {
      map.removeLayer(state.gridLayer);
      state.gridLayer = null;
    }
    const gridType = $gridType.value;
    if (gridType === "none") return;
    const c = map.getCenter();
    const scale = parseInt($scale.value) || 25e3;
    const paper = $paper.value;
    const landscape = $landscape.checked ? "1" : "0";
    try {
      const sheets = parseInt($sheets.value) || 1;
      const url = `/api/grid?lat=${c.lat}&lon=${c.lng}&scale=${scale}&paper=${paper}&landscape=${landscape}&grid_type=${gridType}&full_labels=${$fullLabels.checked ? "1" : "0"}&sheets=${sheets}`;
      const res = await fetch(url);
      const geojson = await res.json();
      if (geojson.error) return;
      state.gridLayer = L.geoJSON(geojson, {
        style: { color: "#1e40af", weight: 1.5, opacity: 0.6 },
        onEachFeature: (feature, layer) => {
          if (feature.properties.label) {
            layer.bindTooltip(feature.properties.label, {
              permanent: true,
              direction: feature.properties.direction === "v" ? "top" : "left",
              className: "grid-label",
              offset: [0, 0]
            });
          }
        }
      }).addTo(map);
      const sysName = geojson.system || gridType;
      const info = `${sysName.toUpperCase()} ${geojson.zone ? "\u2014 " + geojson.zone + " " : ""}${geojson.epsg ? "\u2014 EPSG:" + geojson.epsg + " " : ""}${geojson.spacing ? "\u2014 " + t("msg.gridStep") + " " + geojson.spacing + "m" : ""}`;
      status(info);
    } catch (e) {
    }
  }

  // cartograpy/static/src/search.js
  async function doSearch() {
    const q = $search.value.trim();
    if (!q) return;
    hideSuggestions();
    status(t("status.searching"));
    try {
      const res = await fetch("/api/search?q=" + encodeURIComponent(q));
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (!data.length) {
        status(t("status.noResults"));
        $results.style.display = "none";
        return;
      }
      setSearchResults(data);
      $resList.innerHTML = data.map((r2) => `<option>${r2.name.substring(0, 120)}</option>`).join("");
      $results.style.display = "block";
      $resList.selectedIndex = 0;
      const r = data[0];
      goToPlace(r.name, r.lat, r.lon);
    } catch (e) {
      status(t("msg.error") + e.message);
    }
  }
  function goToPlace(name, lat, lon) {
    map.setView([lat, lon], 14);
    updateOverlays();
    closeSidebarMobile();
    status(`${lat.toFixed(5)}\xB0N  ${Math.abs(lon).toFixed(5)}\xB0${lon >= 0 ? "E" : "W"}`);
    const short = name.substring(0, 80);
    if (!searchHistory.some((h) => h.name === short && Math.abs(h.lat - lat) < 1e-4))
      searchHistory.unshift({ name: short, lat, lon });
    if (searchHistory.length > MAX_HISTORY) searchHistory.pop();
    renderHistory();
    scheduleSaveConfig();
    state.weatherLat = lat;
    state.weatherLon = lon;
    if (!selectedOverlays.has("weather")) {
      selectedOverlays.add("weather");
      populateOverlayPanel();
      applyOverlays();
      scheduleSaveConfig();
    } else {
      fetchWeather(lat, lon);
    }
  }
  async function fetchSuggestions(q) {
    if (state.suggestController) state.suggestController.abort();
    state.suggestController = new AbortController();
    try {
      const res = await fetch(
        "/api/suggest?q=" + encodeURIComponent(q) + "&lang=" + encodeURIComponent(state.currentLang),
        { signal: state.suggestController.signal }
      );
      if (!res.ok) {
        hideSuggestions();
        return;
      }
      const data = await res.json();
      if (data.error || !data.length) {
        hideSuggestions();
        return;
      }
      setSuggestData(data.slice(0, MAX_SUGGESTIONS));
      const box = document.getElementById("searchSuggestions");
      box.innerHTML = suggestData.map(
        (r, i) => `<div class="sg-item" data-idx="${i}">${r.name.substring(0, 100)}</div>`
      ).join("");
      box.style.display = "block";
    } catch (e) {
      if (e.name !== "AbortError") hideSuggestions();
    }
  }
  function hideSuggestions() {
    document.getElementById("searchSuggestions").style.display = "none";
  }
  function renderHistory() {
    const sec = document.getElementById("historySection");
    const list = document.getElementById("histList");
    if (!searchHistory.length) {
      sec.style.display = "none";
      return;
    }
    sec.style.display = "";
    list.innerHTML = searchHistory.map(
      (h, i) => `<div class="hist-item">
       <i class="fa-solid fa-location-dot" style="color:#64748b; font-size:12px;"></i>
       <span class="hist-name" data-idx="${i}">${h.name}</span>
       <span class="hist-del" data-idx="${i}"><i class="fa-solid fa-xmark"></i></span>
     </div>`
    ).join("");
    list.querySelectorAll(".hist-name").forEach((el) => {
      el.addEventListener("click", () => {
        const h = searchHistory[parseInt(el.dataset.idx)];
        goToPlace(h.name, h.lat, h.lon);
      });
    });
    list.querySelectorAll(".hist-del").forEach((el) => {
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        searchHistory.splice(parseInt(el.dataset.idx), 1);
        renderHistory();
        scheduleSaveConfig();
      });
    });
  }

  // cartograpy/static/src/main.js
  document.getElementById("toggleSidebar").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("collapsed");
    document.body.classList.toggle("sidebar-hidden");
    setTimeout(() => map.invalidateSize(), 300);
  });
  document.getElementById("sidebarBackdrop").addEventListener("click", closeSidebarMobile);
  document.getElementById("closeSidebar").addEventListener("click", closeSidebarMobile);
  if (window.innerWidth <= 768) {
    document.getElementById("sidebar").classList.add("collapsed");
    document.body.classList.add("sidebar-hidden");
  }
  document.getElementById("btnSearch").addEventListener("click", doSearch);
  $search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      hideSuggestions();
      doSearch();
    }
    if (e.key === "Escape") hideSuggestions();
  });
  $search.addEventListener("input", () => {
    if (state.suggestTimeout) clearTimeout(state.suggestTimeout);
    const q = $search.value.trim();
    if (q.length < 3) {
      hideSuggestions();
      return;
    }
    state.suggestTimeout = setTimeout(() => fetchSuggestions(q), 350);
  });
  document.getElementById("searchSuggestions").addEventListener("click", (e) => {
    const item = e.target.closest(".sg-item");
    if (!item) return;
    const d = suggestData[parseInt(item.dataset.idx, 10)];
    if (!d) return;
    $search.value = d.name.substring(0, 80);
    hideSuggestions();
    goToPlace(d.name, d.lat, d.lon);
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#search") && !e.target.closest("#searchSuggestions")) hideSuggestions();
  });
  $resList.addEventListener("change", () => {
    const r = searchResults[$resList.selectedIndex];
    if (r) goToPlace(r.name, r.lat, r.lon);
  });
  $scale.addEventListener("change", updateOverlays);
  $paper.addEventListener("change", updateOverlays);
  $sheets.addEventListener("input", updateOverlays);
  $landscape.addEventListener("change", updateOverlays);
  $gridType.addEventListener("change", () => {
    const show = $gridType.value !== "none";
    document.getElementById("gridScaleGroup").style.display = show ? "flex" : "none";
    document.getElementById("fullLabelsGroup").style.display = show ? "flex" : "none";
    document.getElementById("wpDatumLabel").textContent = document.getElementById("gridType").selectedOptions[0].textContent;
    updateOverlays();
  });
  $fullLabels.addEventListener("change", updateOverlays);
  $source.addEventListener("change", () => {
    Object.values(tileLayers).forEach((l) => map.removeLayer(l));
    if (tileLayers[$source.value]) {
      tileLayers[$source.value].addTo(map);
      state.activeBaseLayerName = $source.value;
    }
  });
  map.on("moveend", scheduleGridUpdate);
  map.on("zoomend", scheduleGridUpdate);
  $btnExport.addEventListener("click", exportPDF);
  $btnRuler.addEventListener("click", () => toggleTool("ruler"));
  $btnProtractor.addEventListener("click", () => toggleTool("protractor"));
  $btnLine.addEventListener("click", () => toggleTool("line"));
  $btnCompass.addEventListener("click", () => toggleTool("compass"));
  document.getElementById("btnLineUndo").addEventListener("click", lineUndo);
  $mtbDone.addEventListener("click", () => {
    if (state.activeTool === "line") lineFinish();
    updateMobileToolBar();
  });
  $mtbUndo.addEventListener("click", () => {
    if (state.activeTool === "line") lineUndo();
    updateMobileToolBar();
  });
  $mtbCancel.addEventListener("click", deactivateAllTools);
  document.getElementById("btnToolSave").addEventListener("click", () => {
    const fp = document.getElementById("toolFilePanel");
    const sp = document.getElementById("toolSavePanel");
    const lp = document.getElementById("toolLoadPanel");
    lp.style.display = "none";
    sp.style.display = sp.style.display === "none" ? "" : "none";
    fp.style.display = sp.style.display === "none" && lp.style.display === "none" ? "none" : "";
  });
  document.getElementById("btnToolLoad").addEventListener("click", async () => {
    const fp = document.getElementById("toolFilePanel");
    const sp = document.getElementById("toolSavePanel");
    const lp = document.getElementById("toolLoadPanel");
    sp.style.display = "none";
    lp.style.display = lp.style.display === "none" ? "" : "none";
    fp.style.display = sp.style.display === "none" && lp.style.display === "none" ? "none" : "";
    if (lp.style.display !== "none") await refreshToolFileList();
  });
  document.getElementById("btnToolSaveConfirm").addEventListener("click", async () => {
    const name = document.getElementById("toolFileName").value.trim();
    if (!name) {
      alert(t("msg.enterName"));
      return;
    }
    const data = collectToolData();
    try {
      const res = await fetch("/api/tools/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, drawings: data })
      });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      status(t("msg.toolsSaved"));
      document.getElementById("toolSavePanel").style.display = "none";
      document.getElementById("toolFilePanel").style.display = "none";
    } catch (e) {
      alert(t("msg.saveError") + ": " + e.message);
    }
  });
  document.getElementById("btnToolClearAll").addEventListener("click", () => {
    clearAllTools();
    status(t("msg.toolsCleared"));
  });
  async function refreshToolFileList() {
    const list = document.getElementById("toolFileList");
    try {
      const res = await fetch("/api/tools/list");
      const files = await res.json();
      if (!files.length) {
        list.innerHTML = `<div style="font-size:11px;color:#94a3b8;" data-i18n="tool.noFiles">${t("tool.noFiles")}</div>`;
        return;
      }
      list.innerHTML = "";
      files.forEach((name) => {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:3px 6px;margin-bottom:2px;border-radius:4px;font-size:12px;background:#f1f5f9;cursor:pointer";
        const lbl = document.createElement("span");
        lbl.textContent = name;
        lbl.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
        lbl.addEventListener("click", async () => {
          try {
            const r = await fetch("/api/tools/load?name=" + encodeURIComponent(name));
            const data = await r.json();
            if (data.error) throw new Error(data.error);
            loadToolData(data);
            status(t("msg.toolsLoaded", data.length, name));
            document.getElementById("toolLoadPanel").style.display = "none";
            document.getElementById("toolFilePanel").style.display = "none";
          } catch (e) {
            alert(t("msg.loadError") + ": " + e.message);
          }
        });
        const del = document.createElement("span");
        del.innerHTML = '<i class="fa-solid fa-trash"></i>';
        del.style.cssText = "cursor:pointer;margin-left:6px;color:#94a3b8;padding:0 3px;font-size:11px";
        del.addEventListener("mouseenter", () => del.style.color = "#dc2626");
        del.addEventListener("mouseleave", () => del.style.color = "#94a3b8");
        del.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          if (!confirm(t("msg.confirmDelete", name))) return;
          await fetch("/api/tools/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name })
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
  $btnWpAddOnMap.addEventListener("click", () => {
    if (getWaypointMapActive()) deactivateWaypoint();
    else activateWaypoint();
  });
  document.getElementById("btnWpAdd").addEventListener("click", manualWpAddAsync);
  document.getElementById("wpCoordInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") manualWpAddAsync();
  });
  document.getElementById("btnWpBulk").addEventListener("click", bulkWpImport);
  document.getElementById("btnWpClearAll").addEventListener("click", clearAllWaypoints);
  document.getElementById("btnWpSave").addEventListener("click", () => {
    const panel = document.getElementById("wpFilePanel");
    const sp = document.getElementById("wpSavePanel");
    const lp = document.getElementById("wpLoadPanel");
    lp.style.display = "none";
    sp.style.display = "";
    panel.style.display = "";
    document.getElementById("wpFileName").focus();
  });
  document.getElementById("btnWpLoad").addEventListener("click", refreshWpFileList);
  document.getElementById("btnWpSaveConfirm").addEventListener("click", saveWpFile);
  attachAutoSaveListeners();
  setupOwmKeyUI();
  async function loadSources() {
    let payload = null;
    try {
      const res = await fetch("/api/constants");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      payload = data.sources;
    } catch (e) {
      console.error("loadSources failed:", e);
    }
    if (!payload) return;
    state.sourcesPayload = payload;
    for (const s of payload.base) {
      tileLayers[s.name] = L.tileLayer(s.url, {
        maxZoom: s.max_zoom,
        attribution: s.attribution || ""
      });
    }
    populateSourceSelect(payload);
    const tileDefs = payload.overlays.map(buildTileOverlayDef);
    setOverlayDefs(tileDefs);
    const first = payload.base[0]?.name;
    if (first && tileLayers[first]) {
      tileLayers[first].addTo(map);
      $source.value = first;
      state.activeBaseLayerName = first;
    }
  }
  function populateSourceSelect(payload) {
    const buckets = new Map(payload.groups.map((g) => [g.key, []]));
    const extras = /* @__PURE__ */ new Map();
    for (const s of payload.base) {
      if (buckets.has(s.group)) buckets.get(s.group).push(s);
      else {
        if (!extras.has(s.group)) extras.set(s.group, []);
        extras.get(s.group).push(s);
      }
    }
    $source.innerHTML = "";
    const append = (label, labelKey, items) => {
      if (!items.length) return;
      const og = document.createElement("optgroup");
      if (labelKey) og.dataset.i18nLabel = labelKey;
      og.label = labelKey ? t(labelKey) : label;
      for (const s of items) og.appendChild(buildSourceOption(s));
      $source.appendChild(og);
    };
    for (const g of payload.groups) append(g.key, g.label_key, buckets.get(g.key));
    for (const [key, items] of extras) append(key, null, items);
  }
  function buildSourceOption(s) {
    const opt = document.createElement("option");
    opt.value = s.name;
    if (s.label_key) {
      opt.dataset.i18n = s.label_key;
      opt.textContent = t(s.label_key);
    } else {
      opt.textContent = s.display_name || s.name;
    }
    return opt;
  }
  buildIconColorGrids();
  populateOverlayPanel();
  renderWaypointList();
  loadSources().then(() => loadLanguage("en")).then(() => populateOverlayPanel()).then(() => loadConfig()).then(() => setTimeout(updateOverlays, 500));
})();
//# sourceMappingURL=app.js.map
