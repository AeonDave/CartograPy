"""Interactive slippy-map canvas widget (tkinter)."""
from __future__ import annotations

import math
import threading
import tkinter as tk

from PIL import Image, ImageTk

from .grid import compute_utm_grid, compute_grid
from .tiles import TILE_SIZE, TileCache
from .utils import (
    PAPER_SIZES,
    auto_grid_spacing,
    deg2num,
    ground_resolution,
    num2deg,
)


class MapWidget(tk.Canvas):
    """Pannable / zoomable tile-map canvas with print-area overlay."""

    def __init__(self, parent, tile_cache: TileCache, **kw) -> None:
        kw.setdefault("bg", "#b5d0d0")
        kw.setdefault("highlightthickness", 0)
        super().__init__(parent, **kw)

        self.tile_cache = tile_cache
        self.source_name = "OpenTopoMap"

        # View
        self.zoom = 13
        self.center_lat = 44.4949
        self.center_lon = 11.3426  # Bologna default

        # Print-area overlay (None = hidden)
        self._print_w_m: float | None = None
        self._print_h_m: float | None = None
        self._scale: int = 25_000
        self._show_grid = True

        # Internals
        self._photos: dict[tuple, ImageTk.PhotoImage] = {}
        self._loading: set[tuple] = set()
        self._drag: tuple[int, int] | None = None
        self._redraw_pending = False

        # Callbacks: (lat, lon, zoom) on view change
        self.on_view_change: list = []

        self.bind("<Configure>", lambda e: self._schedule_redraw())
        self.bind("<ButtonPress-1>", self._on_press)
        self.bind("<B1-Motion>", self._on_drag)
        self.bind("<ButtonRelease-1>", self._on_release)
        self.bind("<MouseWheel>", self._on_scroll)
        # Linux scroll
        self.bind("<Button-4>", lambda e: self._zoom_in())
        self.bind("<Button-5>", lambda e: self._zoom_out())

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def set_center(self, lat: float, lon: float, zoom: int | None = None) -> None:
        self.center_lat = lat
        self.center_lon = lon
        if zoom is not None:
            self.zoom = zoom
        self._schedule_redraw()

    def set_source(self, name: str) -> None:
        self.source_name = name
        self._photos.clear()
        self._schedule_redraw()

    def set_print_area(self, scale: int, paper: str, landscape: bool,
                       margins_mm: int = 10) -> None:
        pw, ph = PAPER_SIZES[paper]
        if landscape:
            pw, ph = ph, pw
        self._print_w_m = (pw - 2 * margins_mm) * scale / 1000.0
        self._print_h_m = (ph - 2 * margins_mm - 20) * scale / 1000.0
        self._scale = scale
        self._schedule_redraw()

    def set_grid_visible(self, visible: bool) -> None:
        self._show_grid = visible
        self._schedule_redraw()

    def fit_print_area(self) -> None:
        """Zoom so the print area fits in the canvas with some padding."""
        if self._print_w_m is None:
            return
        cw = self.winfo_width()
        ch = self.winfo_height()
        if cw <= 1:
            return
        # ground per canvas pixel at optimal zoom
        target_mpp = max(self._print_w_m / (cw * 0.85),
                         self._print_h_m / (ch * 0.85))
        for z in range(18, 0, -1):
            if ground_resolution(self.center_lat, z) <= target_mpp:
                self.zoom = z
                break
        self._schedule_redraw()

    # ------------------------------------------------------------------
    # Events
    # ------------------------------------------------------------------

    def _on_press(self, event) -> None:
        self._drag = (event.x, event.y)

    def _on_release(self, _event) -> None:
        self._drag = None

    def _on_drag(self, event) -> None:
        if self._drag is None:
            return
        dx = event.x - self._drag[0]
        dy = event.y - self._drag[1]
        self._drag = (event.x, event.y)
        cx, cy = deg2num(self.center_lat, self.center_lon, self.zoom)
        cx -= dx / TILE_SIZE
        cy -= dy / TILE_SIZE
        self.center_lat, self.center_lon = num2deg(cx, cy, self.zoom)
        self._schedule_redraw()

    def _on_scroll(self, event) -> None:
        if event.delta > 0:
            self._zoom_in()
        else:
            self._zoom_out()

    def _zoom_in(self) -> None:
        if self.zoom < 18:
            self.zoom += 1
            self._schedule_redraw()

    def _zoom_out(self) -> None:
        if self.zoom > 2:
            self.zoom -= 1
            self._schedule_redraw()

    # ------------------------------------------------------------------
    # Drawing
    # ------------------------------------------------------------------

    def _schedule_redraw(self) -> None:
        if not self._redraw_pending:
            self._redraw_pending = True
            self.after(40, self._do_redraw)

    def _do_redraw(self) -> None:
        self._redraw_pending = False
        self._redraw()

    def _redraw(self) -> None:
        self.delete("all")
        w = self.winfo_width()
        h = self.winfo_height()
        if w <= 1 or h <= 1:
            return

        cx, cy = deg2num(self.center_lat, self.center_lon, self.zoom)
        tiles_x = int(w / TILE_SIZE / 2) + 2
        tiles_y = int(h / TILE_SIZE / 2) + 2
        n = 1 << self.zoom

        for dtx in range(-tiles_x, tiles_x + 1):
            for dty in range(-tiles_y, tiles_y + 1):
                tx = int(math.floor(cx)) + dtx
                ty = int(math.floor(cy)) + dty
                if ty < 0 or ty >= n:
                    continue
                actual_tx = tx % n

                # Canvas position (center of tile)
                px = w / 2 + (tx + 0.5 - cx) * TILE_SIZE
                py = h / 2 + (ty + 0.5 - cy) * TILE_SIZE

                key = (self.source_name, self.zoom, actual_tx, ty)

                img = self.tile_cache.get_tile_async(
                    self.source_name, self.zoom, actual_tx, ty,
                    callback=lambda _k, _i: self.after(0, self._schedule_redraw),
                )
                if img is not None:
                    if key not in self._photos:
                        self._photos[key] = ImageTk.PhotoImage(img)
                    self.create_image(px, py, image=self._photos[key], tags="tile")

        self._draw_print_area(w, h)
        self._draw_status(w, h)
        self._fire_view_change()

    # ------------------------------------------------------------------
    # Overlays
    # ------------------------------------------------------------------

    def _draw_print_area(self, cw: int, ch: int) -> None:
        if self._print_w_m is None or self._print_h_m is None:
            return

        mpp = ground_resolution(self.center_lat, self.zoom)
        pw_px = self._print_w_m / mpp
        ph_px = self._print_h_m / mpp

        x1 = cw / 2 - pw_px / 2
        y1 = ch / 2 - ph_px / 2
        x2 = cw / 2 + pw_px / 2
        y2 = ch / 2 + ph_px / 2

        # Dim outside
        self.create_rectangle(0, 0, cw, y1, fill="white", stipple="gray25", tags="over")
        self.create_rectangle(0, y2, cw, ch, fill="white", stipple="gray25", tags="over")
        self.create_rectangle(0, y1, x1, y2, fill="white", stipple="gray25", tags="over")
        self.create_rectangle(x2, y1, cw, y2, fill="white", stipple="gray25", tags="over")

        # Border
        self.create_rectangle(x1, y1, x2, y2, outline="red", width=3, tags="over")
        self.create_text(x1 + 6, y1 - 12, text="Area di stampa", anchor="w",
                         fill="red", font=("Arial", 10, "bold"), tags="over")

        # UTM grid on canvas
        if self._show_grid and pw_px > 50:
            self._draw_canvas_grid(cw, ch, x1, y1, x2, y2)

    def _draw_canvas_grid(self, cw, ch, ax1, ay1, ax2, ay2) -> None:
        spacing = auto_grid_spacing(self._scale)
        try:
            gi = compute_utm_grid(
                self.center_lat, self.center_lon,
                self._print_w_m, self._print_h_m, spacing,
            )
        except Exception:
            return

        for gl in gi.lines:
            p1 = self._latlon_to_canvas(gl.lat1, gl.lon1, cw, ch)
            p2 = self._latlon_to_canvas(gl.lat2, gl.lon2, cw, ch)
            if p1 is None or p2 is None:
                continue
            self.create_line(p1[0], p1[1], p2[0], p2[1],
                             fill="#0033CC", width=1, dash=(6, 4), tags="grid")
            if gl.direction == "v":
                self.create_text(p1[0], ay1 + 2, text=gl.label, anchor="n",
                                 fill="#0033CC", font=("Arial", 8), tags="grid")
            else:
                self.create_text(ax1 + 2, p1[1], text=gl.label, anchor="w",
                                 fill="#0033CC", font=("Arial", 8), tags="grid")

    def _latlon_to_canvas(self, lat, lon, cw, ch):
        cx, cy = deg2num(self.center_lat, self.center_lon, self.zoom)
        px, py = deg2num(lat, lon, self.zoom)
        x = cw / 2 + (px - cx) * TILE_SIZE
        y = ch / 2 + (py - cy) * TILE_SIZE
        return (x, y)

    def _draw_status(self, cw, ch) -> None:
        mpp = ground_resolution(self.center_lat, self.zoom)
        info = (f"Z{self.zoom}  {self.center_lat:.4f}°N  "
                f"{abs(self.center_lon):.4f}°{'E' if self.center_lon >= 0 else 'W'}  "
                f"({mpp:.1f} m/px)")
        self.create_text(cw - 6, ch - 6, text=info, anchor="se",
                         fill="black", font=("Arial", 9),
                         tags="status")

    def _fire_view_change(self) -> None:
        for cb in self.on_view_change:
            try:
                cb(self.center_lat, self.center_lon, self.zoom)
            except Exception:
                pass
