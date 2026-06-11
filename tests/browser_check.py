"""Manual browser-level smoke check (not part of the pytest suite).

Loads the app in headless Edge, reports console errors and the runtime
state of theme chrome elements. Run:  python tests/browser_check.py
"""
import json
import time

from selenium import webdriver
from selenium.webdriver.edge.options import Options

opts = Options()
opts.add_argument("--headless=new")
opts.add_argument("--window-size=1600,900")
opts.set_capability("ms:loggingPrefs", {"browser": "ALL"})

driver = webdriver.Edge(options=opts)
try:
    driver.get("http://127.0.0.1:8271/")
    time.sleep(6)  # let bootstrap chain + theme.js settle

    state = driver.execute_script("""
      const $ = id => document.getElementById(id);
      const vis = el => {
        if (!el) return 'MISSING';
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
          display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
          color: cs.color, text: (el.textContent || '').trim().slice(0, 60),
        };
      };
      return {
        theme: document.title,
        cartograpyApi: typeof window.CartograPy,
        footer: vis(document.querySelector('.tac-foot') || document.querySelector('.cls-foot')),
        right: vis(document.querySelector('.tac-foot .right') || document.querySelector('.cls-foot .right')),
        tacSrc: vis($('tacSrc') || $('clsSrc')),
        tacNight: vis($('tacNight')),
        status: vis($('status')),
        compass: vis(document.querySelector('.compass-btn')),
        magBadge: vis($('magBadge')),
        weatherCard: vis($('weatherCard')),
      };
    """)
    print(json.dumps(state, indent=2, ensure_ascii=False))

    print("\n--- console errors/warnings ---")
    for entry in driver.get_log("browser"):
        if entry["level"] in ("SEVERE", "WARNING"):
            print(entry["level"], entry["message"][:300])
finally:
    driver.quit()
