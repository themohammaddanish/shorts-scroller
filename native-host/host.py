#!/usr/bin/env python3
"""
Floating desktop control widget for the Shorts Auto-Scroller Chrome extension.

Talks to the extension over Chrome Native Messaging (stdin/stdout, 4-byte
little-endian length-prefixed JSON). Chrome launches this process; it stays
alive as long as Chrome is running, even when Chrome is in the background.

Requires: Python 3.8+ with tkinter (standard on python.org Windows installs).
"""

import json
import os
import queue
import struct
import sys
import threading
import time
import tkinter as tk

POSITION_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "widget_pos.json")

MSG = sys.stdout.buffer  # native messaging channel to Chrome
HB_INTERVAL_MS = 15000   # heartbeat to keep the MV3 service worker alive
STALE_AFTER_S = 45       # no traffic for this long -> show "disconnected"


# --------------------------------------------------------------------------
# Native messaging I/O
# --------------------------------------------------------------------------

def send_message(obj):
    try:
        data = json.dumps(obj).encode("utf-8")
        MSG.write(struct.pack("<I", len(data)))
        MSG.write(data)
        MSG.flush()
    except OSError:
        # Chrome closed the pipe (browser exiting); exit quietly.
        os._exit(0)


class NativeReader(threading.Thread):
    """Reads length-prefixed JSON from stdin and pushes messages to a queue."""

    def __init__(self, inbox):
        super().__init__(daemon=True)
        self.inbox = inbox

    def run(self):
        stdin = sys.stdin.buffer
        try:
            while True:
                header = stdin.read(4)
                if len(header) < 4:
                    break
                (length,) = struct.unpack("<I", header)
                payload = stdin.read(length)
                if len(payload) < length:
                    break
                try:
                    self.inbox.put(json.loads(payload.decode("utf-8")))
                except (ValueError, UnicodeDecodeError):
                    continue
        except OSError:
            pass
        # stdin EOF: Chrome is shutting down.
        self.inbox.put({"type": "_exit"})


# --------------------------------------------------------------------------
# Widget UI
# --------------------------------------------------------------------------

class Widget:
    def __init__(self, root, inbox):
        self.root = root
        self.inbox = inbox
        self.connected = False
        self.last_seen = time.time()
        self.expanded = False
        self.paused = False
        self.enabled = True

        root.overrideredirect(True)          # frameless
        root.attributes("-topmost", True)    # always on top of other apps
        root.attributes("-alpha", 0.95)
        root.configure(bg="#181818")

        self.load_position()

        # --- collapsed icon ---
        self.icon = tk.Label(
            root, text="▶", font=("Segoe UI", 16, "bold"),
            fg="white", bg="#cc0000", width=3, height=1, cursor="fleur",
        )
        self.icon.pack(fill="both", expand=True)
        self.icon.bind("<ButtonPress-1>", self.drag_start)
        self.icon.bind("<B1-Motion>", self.drag_move)
        self.icon.bind("<ButtonRelease-1>", self.drag_end)
        self.icon.bind("<Double-Button-1>", lambda e: self.toggle_menu())

        # --- expanded menu ---
        self.menu = tk.Toplevel(root)
        self.menu.overrideredirect(True)
        self.menu.attributes("-topmost", True)
        self.menu.configure(bg="#181818")
        self.menu.withdraw()

        self.status_label = tk.Label(
            self.menu, text="Connecting…", font=("Segoe UI", 9),
            fg="#ffcc00", bg="#181818",
        )
        self.status_label.pack(fill="x", padx=8, pady=(6, 2))

        def btn(text, cmd):
            b = tk.Button(
                self.menu, text=text, command=cmd, relief="flat",
                bg="#323232", fg="#eee", activebackground="#444",
                activeforeground="#fff", font=("Segoe UI", 9),
            )
            b.pack(fill="x", padx=8, pady=2)
            return b

        self.toggle_btn = btn("Auto-Scroll: ON", lambda: self.command("toggle"))
        self.pause_btn = btn("Pause", lambda: self.command("pause"))
        btn("⟵ Previous", lambda: self.command("prev"))
        btn("Next ⟶", lambda: self.command("next"))

        delay_row = tk.Frame(self.menu, bg="#181818")
        delay_row.pack(fill="x", padx=8, pady=2)
        tk.Label(delay_row, text="Delay (s):", fg="#aaa", bg="#181818",
                 font=("Segoe UI", 9)).pack(side="left")
        self.delay_var = tk.StringVar(value="0.3")
        self.delay_entry = tk.Entry(delay_row, textvariable=self.delay_var, width=6,
                                    bg="#262626", fg="#eee", insertbackground="#eee",
                                    relief="flat", justify="center")
        self.delay_entry.pack(side="left", padx=4)
        tk.Button(delay_row, text="Set", command=self.set_delay, relief="flat",
                  bg="#323232", fg="#eee", activebackground="#444",
                  font=("Segoe UI", 9)).pack(side="left")

        btn("Minimize", self.toggle_menu)

        for w in (self.menu, self.icon):
            w.bind("<ButtonPress-3>", lambda e: self.toggle_menu())  # right-click toggles too

        # --- background loops ---
        threading.Thread(target=self.heartbeat_loop, daemon=True).start()
        self.root.after(100, self.poll_inbox)
        self.root.after(5000, self.check_stale)

    # ---- commands to the extension ----

    def command(self, name, value=None):
        send_message({"type": "command", "command": name, "value": value})

    def set_delay(self):
        try:
            secs = float(self.delay_var.get())
        except ValueError:
            return
        self.command("delay", int(max(0.0, min(60.0, secs)) * 1000))

    def heartbeat_loop(self):
        while True:
            send_message({"type": "hb"})
            time.sleep(15)

    # ---- inbox / connection state ----

    def poll_inbox(self):
        try:
            while True:
                msg = self.inbox.get_nowait()
                if msg.get("type") == "_exit":
                    self.root.after(200, self.root.destroy)
                    return
                self.last_seen = time.time()
                if msg.get("type") == "status":
                    self.apply_status(msg)
        except queue.Empty:
            pass
        self.root.after(100, self.poll_inbox)

    def apply_status(self, msg):
        if "connected" in msg:
            self.connected = bool(msg["connected"])
        if "enabled" in msg:
            self.enabled = bool(msg["enabled"])
        if "paused" in msg:
            self.paused = bool(msg["paused"])
        if "delayMs" in msg:
            try:
                self.delay_var.set(f"{msg['delayMs'] / 1000:g}")
            except (tk.TclError, ValueError):
                pass
        self.refresh_labels()

    def refresh_labels(self):
        if self.connected:
            self.status_label.config(text="● Connected", fg="#6f6")
            self.icon.config(bg="#cc0000")
        else:
            self.status_label.config(text="● Disconnected — open a Shorts tab", fg="#f66")
            self.icon.config(bg="#555555")
        self.toggle_btn.config(text="Auto-Scroll: " + ("ON" if self.enabled else "OFF"))
        self.pause_btn.config(text="Resume" if self.paused else "Pause")

    def check_stale(self):
        if time.time() - self.last_seen > STALE_AFTER_S and self.connected:
            self.connected = False
            self.refresh_labels()
        self.root.after(5000, self.check_stale)

    # ---- drag & expand ----

    def drag_start(self, event):
        self._dx = event.x
        self._dy = event.y
        self._moved = False

    def drag_move(self, event):
        self._moved = True
        x = self.root.winfo_x() + event.x - self._dx
        y = self.root.winfo_y() + event.y - self._dy
        self.root.geometry(f"+{max(0, x)}+{max(0, y)}")
        if self.expanded:
            self.menu.geometry(f"+{max(0, x)}+{max(0, y + self.root.winfo_height() + 2)}")

    def drag_end(self, event):
        if self._moved:
            self.save_position()
        else:
            self.toggle_menu()  # plain click on the icon expands/collapses

    def toggle_menu(self):
        if self.expanded:
            self.menu.withdraw()
            self.expanded = False
        else:
            x = self.root.winfo_x()
            y = self.root.winfo_y() + self.root.winfo_height() + 2
            self.menu.geometry(f"+{max(0, x)}+{max(0, y)}")
            self.menu.deiconify()
            self.expanded = True

    # ---- position persistence ----

    def load_position(self):
        x, y = 60, 60
        try:
            with open(POSITION_FILE, "r", encoding="utf-8") as f:
                pos = json.load(f)
            x, y = int(pos.get("x", x)), int(pos.get("y", y))
        except (OSError, ValueError):
            pass
        self.root.geometry(f"+{x}+{y}")

    def save_position(self):
        try:
            with open(POSITION_FILE, "w", encoding="utf-8") as f:
                json.dump({"x": self.root.winfo_x(), "y": self.root.winfo_y()}, f)
        except OSError:
            pass


def main():
    root = tk.Tk()
    inbox = queue.Queue()
    NativeReader(inbox).start()
    Widget(root, inbox)
    root.mainloop()


if __name__ == "__main__":
    main()
