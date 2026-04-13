"""Runtime paths and bootstrap configuration for CartograPy."""
from __future__ import annotations

import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

_SERVER_CONFIG_FILENAME = "cartograpy-server.json"
_DEFAULT_HOST = "127.0.0.1"
_DEFAULT_PORT = 8271
_DEFAULT_OPEN_BROWSER = True
_DEFAULT_BROWSER_DELAY_SEC = 0.8


@dataclass(frozen=True, slots=True)
class ServerSettings:
    """Bootstrap settings used to start the local HTTP server."""

    host: str = _DEFAULT_HOST
    port: int = _DEFAULT_PORT
    open_browser: bool = _DEFAULT_OPEN_BROWSER
    browser_delay_sec: float = _DEFAULT_BROWSER_DELAY_SEC


def get_runtime_root() -> Path:
    """Return the writable runtime root.

    In source mode this is the project root. In frozen mode this is the
    directory that contains the executable, so users can keep config and data
    next to the launcher.
    """
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def get_resource_root() -> Path:
    """Return the root directory for bundled read-only resources."""
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return Path(meipass)
    return Path(__file__).resolve().parent.parent


def get_resource_path(*parts: str) -> Path:
    """Return the absolute path to a bundled resource."""
    return get_resource_root().joinpath(*parts)


def get_data_dir() -> Path:
    """Return the persistent data directory, creating it if necessary."""
    data_dir = get_runtime_root() / "data"
    data_dir.mkdir(exist_ok=True)
    return data_dir


def get_server_config_path() -> Path:
    """Return the path of the dedicated server bootstrap config file."""
    return get_runtime_root() / _SERVER_CONFIG_FILENAME


def load_server_settings() -> tuple[ServerSettings, Path, list[str]]:
    """Load server settings from the dedicated bootstrap config.

    If the config file does not exist yet, a default one is created beside the
    script/executable so users can edit it for future launches.
    """
    config_path = get_server_config_path()
    warnings: list[str] = []

    if not config_path.is_file():
        settings = ServerSettings()
        _write_server_config(config_path, settings)
        return settings, config_path, warnings

    try:
        raw = json.loads(config_path.read_text("utf-8"))
    except json.JSONDecodeError as exc:
        warnings.append(
            f"Invalid JSON in {config_path.name}: {exc}. Falling back to defaults."
        )
        return ServerSettings(), config_path, warnings

    if not isinstance(raw, dict):
        warnings.append(
            f"{config_path.name} must contain a JSON object. Falling back to defaults."
        )
        return ServerSettings(), config_path, warnings

    settings = ServerSettings(
        host=_normalize_host(raw.get("host"), warnings),
        port=_normalize_port(raw.get("port"), warnings),
        open_browser=_normalize_bool(
            raw.get("open_browser", _DEFAULT_OPEN_BROWSER),
            key="open_browser",
            warnings=warnings,
        ),
        browser_delay_sec=_normalize_delay(raw.get("browser_delay_sec"), warnings),
    )

    normalized = asdict(settings)
    if raw != normalized:
        _write_server_config(config_path, settings)

    return settings, config_path, warnings


def _write_server_config(path: Path, settings: ServerSettings) -> None:
    """Write a normalized server config file to disk."""
    path.write_text(json.dumps(asdict(settings), ensure_ascii=False, indent=2) + "\n", "utf-8")


def _normalize_host(value: object, warnings: list[str]) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if value not in (None, _DEFAULT_HOST):
        warnings.append("Invalid 'host' value in server config. Using 127.0.0.1.")
    return _DEFAULT_HOST


def _normalize_port(value: object, warnings: list[str]) -> int:
    try:
        port = int(value)
    except (TypeError, ValueError):
        if value is not None:
            warnings.append("Invalid 'port' value in server config. Using 8271.")
        return _DEFAULT_PORT

    if 1 <= port <= 65535:
        return port

    warnings.append("Server 'port' must be between 1 and 65535. Using 8271.")
    return _DEFAULT_PORT


def _normalize_bool(value: object, *, key: str, warnings: list[str]) -> bool:
    if isinstance(value, bool):
        return value

    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"1", "true", "yes", "on"}:
            return True
        if lowered in {"0", "false", "no", "off"}:
            return False

    warnings.append(f"Invalid '{key}' value in server config. Using default value.")
    if key == "open_browser":
        return _DEFAULT_OPEN_BROWSER
    return False


def _normalize_delay(value: object, warnings: list[str]) -> float:
    if value is None:
        return _DEFAULT_BROWSER_DELAY_SEC

    try:
        delay = float(value)
    except (TypeError, ValueError):
        warnings.append("Invalid 'browser_delay_sec' value in server config. Using 0.8.")
        return _DEFAULT_BROWSER_DELAY_SEC

    if delay >= 0:
        return delay

    warnings.append("'browser_delay_sec' cannot be negative. Using 0.8.")
    return _DEFAULT_BROWSER_DELAY_SEC
