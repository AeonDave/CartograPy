"""Small Windows-friendly launcher for the CartograPy local server."""
from __future__ import annotations

import os
import queue
import threading
import tkinter as tk
import webbrowser
from pathlib import Path
from tkinter import messagebox

from PIL import Image

from cartograpy.runtime import get_data_dir, get_resource_path, load_server_settings
from cartograpy.server import create_server, open_browser_later

try:
    import pystray
except ImportError:  # pragma: no cover - optional for source mode
    pystray = None


class LauncherApp:
    """Desktop controller for starting and stopping the local CartograPy server."""

    def __init__(self) -> None:
        self.settings, self.config_path, self.warnings = load_server_settings()
        self.data_dir = get_data_dir()
        self.logo_path = get_resource_path("img", "logo.png")
        self.server, self.url = create_server(
            host=self.settings.host,
            port=self.settings.port,
        )
        self.server_thread: threading.Thread | None = None
        self.stop_thread: threading.Thread | None = None
        self.event_queue: queue.Queue[tuple[str, str]] = queue.Queue()
        self.exit_when_stopped = False
        self.server_running = False
        self.tray_icon: pystray.Icon | None = None if pystray else None

        self.root = tk.Tk()
        self.root.title("CartograPy Launcher")
        self.root.geometry("420x235")
        self.root.resizable(False, False)
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self.window_icon: tk.PhotoImage | None = None
        self._apply_window_icon()

        self.status_var = tk.StringVar(value="Starting local server...")
        self.detail_var = tk.StringVar(value=self.url)
        self.tray_var = tk.StringVar(
            value=(
                "Close hides to tray; use Exit to stop everything."
                if pystray
                else "Tray support unavailable in source mode: install build requirements."
            )
        )

        self._build_ui()
        self._start_server()
        self._apply_warnings()
        self.root.after(200, self._poll_events)

    def run(self) -> None:
        """Run the launcher main loop."""
        self.root.mainloop()

    def _build_ui(self) -> None:
        frame = tk.Frame(self.root, padx=14, pady=14)
        frame.pack(fill="both", expand=True)

        title = tk.Label(frame, text="CartograPy is running locally", font=("Segoe UI", 13, "bold"))
        title.pack(anchor="w")

        status = tk.Label(frame, textvariable=self.status_var, fg="#1d4ed8", pady=6)
        status.pack(anchor="w")

        url = tk.Label(frame, textvariable=self.detail_var, fg="#0f766e", cursor="hand2")
        url.pack(anchor="w")
        url.bind("<Button-1>", lambda _event: self.open_browser())

        cfg = tk.Label(frame, text=f"Config: {self.config_path.name}", fg="#475569")
        cfg.pack(anchor="w", pady=(8, 0))
        data = tk.Label(frame, text=f"Data: {self.data_dir}", fg="#475569", wraplength=390, justify="left")
        data.pack(anchor="w")

        buttons = tk.Frame(frame, pady=14)
        buttons.pack(fill="x")

        self.open_button = tk.Button(buttons, text="Apri browser", width=14, command=self.open_browser)
        self.open_button.grid(row=0, column=0, padx=(0, 8), pady=(0, 8))

        cfg_button = tk.Button(buttons, text="Apri config", width=14, command=self.open_config)
        cfg_button.grid(row=0, column=1, padx=(0, 8), pady=(0, 8))

        folder_button = tk.Button(buttons, text="Apri cartella dati", width=16, command=self.open_data_dir)
        folder_button.grid(row=0, column=2, pady=(0, 8))

        self.hide_button = tk.Button(
            buttons,
            text="Nascondi nel tray",
            width=14,
            command=self.hide_to_tray,
            state=("normal" if pystray else "disabled"),
        )
        self.hide_button.grid(row=1, column=0, padx=(0, 8))

        self.stop_button = tk.Button(buttons, text="Ferma server", width=14, command=self.stop_server)
        self.stop_button.grid(row=1, column=1, padx=(0, 8))

        exit_button = tk.Button(buttons, text="Esci", width=16, command=self.exit_app)
        exit_button.grid(row=1, column=2)

        tray_note = tk.Label(frame, textvariable=self.tray_var, fg="#64748b", wraplength=390, justify="left")
        tray_note.pack(anchor="w", pady=(8, 0))

    def _apply_window_icon(self) -> None:
        """Apply the PNG logo to the launcher window when available."""
        if not self.logo_path.is_file():
            return

        try:
            self.window_icon = tk.PhotoImage(file=str(self.logo_path))
            self.root.iconphoto(False, self.window_icon)
        except tk.TclError:
            self.window_icon = None

    def _apply_warnings(self) -> None:
        if not self.warnings:
            return
        messagebox.showwarning("CartograPy config", "\n".join(self.warnings), parent=self.root)

    def _start_server(self) -> None:
        self.server_running = True
        self.server_thread = threading.Thread(target=self._serve_forever, daemon=True)
        self.server_thread.start()
        self.status_var.set(f"Server attivo su {self.settings.host}:{self.settings.port}")
        if self.settings.open_browser:
            open_browser_later(self.url, self.settings.browser_delay_sec)

    def _serve_forever(self) -> None:
        try:
            self.server.serve_forever()
        except Exception as exc:  # pragma: no cover - defensive thread handoff
            self.event_queue.put(("error", str(exc)))
        finally:
            self.server.server_close()
            self.event_queue.put(("stopped", "Server stopped"))

    def _poll_events(self) -> None:
        while True:
            try:
                event, payload = self.event_queue.get_nowait()
            except queue.Empty:
                break

            if event == "error":
                self.server_running = False
                self.status_var.set("Server terminato con errore")
                self.detail_var.set(payload)
                self.stop_button.configure(state="disabled")
                self.hide_button.configure(state="disabled")
                messagebox.showerror("CartograPy server", payload, parent=self.root)
            elif event == "stopped":
                self.server_running = False
                self.status_var.set("Server fermato")
                self.detail_var.set(self.url)
                self.stop_button.configure(state="disabled")
                self.hide_button.configure(state="disabled")
                if self.exit_when_stopped:
                    self._finalize_exit()

        self.root.after(200, self._poll_events)

    def open_browser(self) -> None:
        """Open the local CartograPy UI in the default browser."""
        webbrowser.open(self.url)

    def open_config(self) -> None:
        """Open the dedicated server config file with the default application."""
        self._open_path(self.config_path)

    def open_data_dir(self) -> None:
        """Open the persistent data directory."""
        self._open_path(self.data_dir)

    def hide_to_tray(self) -> None:
        """Hide the launcher window while keeping the local server alive."""
        if not pystray:
            return
        self._ensure_tray_icon()
        self.root.withdraw()
        if self.tray_icon is not None:
            try:
                self.tray_icon.notify("CartograPy continua a servire localhost in background.")
            except Exception:
                pass

    def show_window(self) -> None:
        """Restore the launcher window from the tray icon."""
        self.root.after(0, self._show_window_on_ui_thread)

    def stop_server(self) -> None:
        """Stop the local HTTP server but keep the launcher window alive."""
        if not self.server_running or self.stop_thread is not None:
            return
        self.status_var.set("Arresto del server in corso...")
        self.stop_button.configure(state="disabled")
        self.stop_thread = threading.Thread(target=self._shutdown_server, daemon=True)
        self.stop_thread.start()

    def exit_app(self) -> None:
        """Stop the server and exit the launcher."""
        self.exit_when_stopped = True
        if self.server_running:
            self.stop_server()
            return
        self._finalize_exit()

    def _shutdown_server(self) -> None:
        try:
            self.server.shutdown()
        finally:
            self.stop_thread = None

    def _finalize_exit(self) -> None:
        if self.tray_icon is not None:
            self.tray_icon.stop()
            self.tray_icon = None
        self.root.after(0, self.root.destroy)

    def _show_window_on_ui_thread(self) -> None:
        self.root.deiconify()
        self.root.lift()
        self.root.focus_force()

    def _on_close(self) -> None:
        if pystray and self.server_running:
            self.hide_to_tray()
            return
        self.exit_app()

    def _ensure_tray_icon(self) -> None:
        if not pystray or self.tray_icon is not None:
            return

        menu = pystray.Menu(
            pystray.MenuItem("Show", lambda _icon, _item: self.show_window(), default=True),
            pystray.MenuItem("Open Browser", lambda _icon, _item: self.open_browser()),
            pystray.MenuItem("Open Config", lambda _icon, _item: self.open_config()),
            pystray.MenuItem("Stop Server", lambda _icon, _item: self.stop_server()),
            pystray.MenuItem("Exit", lambda _icon, _item: self.exit_app()),
        )
        self.tray_icon = pystray.Icon("cartograpy", self._create_tray_image(), "CartograPy", menu)
        self.tray_icon.run_detached()

    @staticmethod
    def _create_tray_image() -> Image.Image:
        logo_path = get_resource_path("img", "logo.png")
        if logo_path.is_file():
            image = Image.open(logo_path).convert("RGBA")
            if image.size != (64, 64):
                image = image.resize((64, 64), Image.Resampling.LANCZOS)
            return image

        return Image.new("RGBA", (64, 64), (37, 99, 235, 255))

    @staticmethod
    def _open_path(path: Path) -> None:
        try:
            os.startfile(path)  # type: ignore[attr-defined]
        except AttributeError:
            webbrowser.open(path.resolve().as_uri())


def main() -> None:
    """Launch the desktop controller for the local CartograPy server."""
    try:
        app = LauncherApp()
    except Exception as exc:
        root = tk.Tk()
        root.withdraw()
        messagebox.showerror("CartograPy launcher", str(exc), parent=root)
        root.destroy()
        raise SystemExit(1) from exc

    app.run()


if __name__ == "__main__":
    main()