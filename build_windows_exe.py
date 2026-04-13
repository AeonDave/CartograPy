#!/usr/bin/env python3
"""Build a portable Windows executable for CartograPy."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from PIL import Image


def ensure_windows_icon(root: Path) -> Path:
    """Generate a multi-size ICO file from img/logo.png for PyInstaller."""
    logo_path = root / "img" / "logo.png"
    if not logo_path.is_file():
        raise SystemExit(f"Logo file not found: {logo_path}")

    out_dir = root / "build" / "generated"
    out_dir.mkdir(parents=True, exist_ok=True)
    icon_path = out_dir / "cartograpy.ico"

    with Image.open(logo_path).convert("RGBA") as image:
        sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
        image.save(icon_path, format="ICO", sizes=sizes)

    return icon_path


def main() -> None:
    """Build the Windows launcher with PyInstaller."""
    if sys.platform != "win32":
        raise SystemExit("This builder targets Windows and should be run on Windows.")

    root = Path(__file__).resolve().parent
    static_dir = root / "cartograpy" / "static"
    logo_path = root / "img" / "logo.png"
    if not static_dir.is_dir():
        raise SystemExit(f"Static directory not found: {static_dir}")
    if not logo_path.is_file():
        raise SystemExit(f"Logo file not found: {logo_path}")

    icon_path = ensure_windows_icon(root)

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--name",
        "CartograPy",
        "--onedir",
        "--windowed",
        "--icon",
        str(icon_path),
        "--hidden-import",
        "pystray._win32",
        "--add-data",
        f"{static_dir};cartograpy/static",
        "--add-data",
        f"{logo_path};img",
        str(root / "cartograpy" / "launcher.py"),
    ]

    print("Building CartograPy.exe...")
    subprocess.run(cmd, check=True, cwd=root)
    print("Done. Launch dist/CartograPy/CartograPy.exe")
    print("The EXE shows a small controller window with tray icon, browser, and stop actions.")
    print("On first start it creates cartograpy-server.json and data/ beside itself.")


if __name__ == "__main__":
    main()
