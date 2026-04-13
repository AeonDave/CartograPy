#!/usr/bin/env python3
"""Launch CartograPy using the dedicated server bootstrap config."""
from __future__ import annotations

from cartograpy.runtime import load_server_settings
from cartograpy.server import run_server


def main() -> None:
    """Load bootstrap settings and start the local HTTP server."""
    settings, config_path, warnings = load_server_settings()
    print(f"Server config: {config_path}")
    for warning in warnings:
        print(f"[config] {warning}")

    run_server(
        host=settings.host,
        port=settings.port,
        open_browser=settings.open_browser,
        browser_delay_sec=settings.browser_delay_sec,
    )

if __name__ == "__main__":
    main()
