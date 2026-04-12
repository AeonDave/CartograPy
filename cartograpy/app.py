"""Main CartograPy application window (tkinter)."""
from __future__ import annotations

import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from .export import export_map_pdf
from .geocoder import geocode
from .map_widget import MapWidget
from .tiles import TILE_SOURCES, TileCache
from .utils import PAPER_SIZES, SCALES


class CartograPyApp(tk.Tk):
    """Full GUI: search → preview → export PDF at correct physical scale."""

    def __init__(self) -> None:
        super().__init__()
        self.title("CartograPy — Stampa Mappe in Scala")
        self.geometry("1200x820")
        self.minsize(800, 600)

        self.tile_cache = TileCache()
        self._search_results = []

        self._build_toolbar()
        self._build_map()
        self._build_statusbar()
        self._update_print_area()

    # ------------------------------------------------------------------
    # Layout — toolbar
    # ------------------------------------------------------------------

    def _build_toolbar(self) -> None:
        top = ttk.Frame(self)
        top.pack(side="top", fill="x", padx=6, pady=(6, 2))

        # --- row 1: search ------------------------------------------------
        ttk.Label(top, text="Cerca luogo:").pack(side="left")
        self._search_var = tk.StringVar()
        se = ttk.Entry(top, textvariable=self._search_var, width=32)
        se.pack(side="left", padx=4)
        se.bind("<Return>", lambda _: self._do_search())
        ttk.Button(top, text="Cerca", command=self._do_search).pack(side="left")

        ttk.Separator(top, orient="vertical").pack(side="left", fill="y", padx=8)

        # Scale
        ttk.Label(top, text="Scala 1 :").pack(side="left")
        self._scale_var = tk.StringVar(value="25000")
        sc = ttk.Combobox(top, textvariable=self._scale_var, width=9,
                          values=[str(s) for s in SCALES])
        sc.pack(side="left", padx=4)
        sc.bind("<<ComboboxSelected>>", lambda _: self._update_print_area())
        sc.bind("<Return>", lambda _: self._update_print_area())

        # Paper
        ttk.Label(top, text="Foglio:").pack(side="left", padx=(8, 0))
        self._paper_var = tk.StringVar(value="A4")
        pp = ttk.Combobox(top, textvariable=self._paper_var, width=7,
                          values=list(PAPER_SIZES.keys()), state="readonly")
        pp.pack(side="left", padx=4)
        pp.bind("<<ComboboxSelected>>", lambda _: self._update_print_area())

        # Orientation
        self._landscape_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(top, text="Orizzontale",
                        variable=self._landscape_var,
                        command=self._update_print_area).pack(side="left", padx=6)

        # --- row 2: source, grid, DPI, export ----------------------------
        row2 = ttk.Frame(self)
        row2.pack(side="top", fill="x", padx=6, pady=(0, 4))

        ttk.Label(row2, text="Fonte mappa:").pack(side="left")
        self._source_var = tk.StringVar(value="OpenTopoMap")
        sv = ttk.Combobox(row2, textvariable=self._source_var, width=16,
                          values=list(TILE_SOURCES.keys()), state="readonly")
        sv.pack(side="left", padx=4)
        sv.bind("<<ComboboxSelected>>", lambda _: self._change_source())

        self._grid_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(row2, text="Griglia UTM", variable=self._grid_var,
                        command=self._toggle_grid).pack(side="left", padx=10)

        ttk.Label(row2, text="DPI:").pack(side="left", padx=(8, 0))
        self._dpi_var = tk.StringVar(value="300")
        ttk.Combobox(row2, textvariable=self._dpi_var, width=5,
                     values=["150", "200", "300", "600"],
                     state="readonly").pack(side="left", padx=4)

        ttk.Button(row2, text="Adatta vista", command=self._fit).pack(side="left", padx=8)

        ttk.Button(row2, text="  Esporta PDF  ",
                   command=self._export_pdf).pack(side="right", padx=4)

        # --- search results dropdown (hidden until needed) ----------------
        self._res_frame = ttk.Frame(self)
        self._res_var = tk.StringVar()
        self._res_combo = ttk.Combobox(self._res_frame,
                                       textvariable=self._res_var,
                                       width=100, state="readonly")
        self._res_combo.pack(fill="x", padx=6)
        self._res_combo.bind("<<ComboboxSelected>>", self._on_result_selected)

    # ------------------------------------------------------------------
    # Layout — map
    # ------------------------------------------------------------------

    def _build_map(self) -> None:
        self.map_widget = MapWidget(self, self.tile_cache)
        self.map_widget.pack(fill="both", expand=True, padx=6, pady=2)

    # ------------------------------------------------------------------
    # Layout — status bar
    # ------------------------------------------------------------------

    def _build_statusbar(self) -> None:
        self._status_var = tk.StringVar(value="Pronto")
        sb = ttk.Label(self, textvariable=self._status_var, relief="sunken",
                       anchor="w", padding=(4, 2))
        sb.pack(side="bottom", fill="x")

    # ------------------------------------------------------------------
    # Actions
    # ------------------------------------------------------------------

    def _do_search(self) -> None:
        query = self._search_var.get().strip()
        if not query:
            return
        self._status("Ricerca in corso…")

        def _bg():
            try:
                results = geocode(query)
            except Exception as exc:
                self.after(0, lambda: self._status(f"Errore ricerca: {exc}"))
                return
            self.after(0, lambda: self._show_results(results))

        threading.Thread(target=_bg, daemon=True).start()

    def _show_results(self, results) -> None:
        self._search_results = results
        if not results:
            self._status("Nessun risultato")
            self._res_frame.pack_forget()
            return
        names = [r.name[:120] for r in results]
        self._res_combo["values"] = names
        self._res_var.set(names[0])
        self._res_frame.pack(side="top", fill="x", after=self.children.get(
            list(self.children.keys())[1] if len(self.children) > 1 else list(self.children.keys())[0]
        ))
        self._on_result_selected(None)

    def _on_result_selected(self, _event) -> None:
        idx = self._res_combo.current()
        if idx < 0 or idx >= len(self._search_results):
            return
        r = self._search_results[idx]
        self.map_widget.set_center(r.lat, r.lon)
        self.map_widget.fit_print_area()
        self._status(f"{r.lat:.5f}°N  {abs(r.lon):.5f}°{'E' if r.lon >= 0 else 'W'}")

    def _update_print_area(self) -> None:
        try:
            scale = int(self._scale_var.get())
        except ValueError:
            return
        paper = self._paper_var.get()
        landscape = self._landscape_var.get()
        self.map_widget.set_print_area(scale, paper, landscape)

    def _change_source(self) -> None:
        self.map_widget.set_source(self._source_var.get())

    def _toggle_grid(self) -> None:
        self.map_widget.set_grid_visible(self._grid_var.get())

    def _fit(self) -> None:
        self.map_widget.fit_print_area()

    def _export_pdf(self) -> None:
        try:
            scale = int(self._scale_var.get())
        except ValueError:
            messagebox.showerror("Errore", "Scala non valida")
            return
        paper = self._paper_var.get()
        dpi = int(self._dpi_var.get())
        landscape = self._landscape_var.get()
        source = self._source_var.get()
        show_grid = self._grid_var.get()

        path = filedialog.asksaveasfilename(
            defaultextension=".pdf",
            filetypes=[("PDF", "*.pdf")],
            initialfile=f"mappa_{scale}_{paper}.pdf",
            title="Salva mappa PDF",
        )
        if not path:
            return

        self._status("Esportazione in corso…")
        self.update_idletasks()

        def _bg():
            try:
                export_map_pdf(
                    tile_cache=self.tile_cache,
                    source_name=source,
                    center_lat=self.map_widget.center_lat,
                    center_lon=self.map_widget.center_lon,
                    scale=scale,
                    paper=paper,
                    landscape=landscape,
                    dpi=dpi,
                    output=path,
                    show_grid=show_grid,
                    progress_cb=lambda msg: self.after(0, lambda m=msg: self._status(m)),
                )
                self.after(0, lambda: messagebox.showinfo(
                    "Esportazione completata",
                    f"PDF salvato in:\n{path}\n\n"
                    "IMPORTANTE: stampare al 100 % (scala reale),\n"
                    "senza 'adatta alla pagina'.",
                ))
            except Exception as exc:
                self.after(0, lambda: messagebox.showerror("Errore esportazione", str(exc)))
            finally:
                self.after(0, lambda: self._status("Pronto"))

        threading.Thread(target=_bg, daemon=True).start()

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _status(self, msg: str) -> None:
        self._status_var.set(msg)
