# Shorts Auto-Scroller (Chrome extension + desktop widget)

Auto-scrolls YouTube Shorts with an adjustable delay, controllable from a
floating always-on-top desktop icon that works even while Chrome is in the
background.

## How it fits together

```
┌─────────────────────┐  native messaging (JSON over stdio)  ┌──────────────┐
│ Chrome extension    │ ◄──────────────────────────────────► │ Desktop      │
│  content.js (tab)   │        background.js ◄──► host.py    │ widget       │
│  background.js (MV3)│                                      │ (tkinter)    │
└─────────────────────┘                                      └──────────────┘
```

- `extension/content.js` — on `youtube.com/shorts`: watches the active video's
  `ended` event, waits the configured delay, clicks YouTube's next button.
- `extension/background.js` — service worker; relays commands/status between
  the tab and the native host, auto-reconnects, keeps itself alive.
- `extension/popup.html/js` — toolbar fallback controls.
- `native-host/host.py` — the floating desktop widget (tkinter, always on
  top, draggable, remembers position, minimizes back to the small icon).
- `native-host/install.bat` — registers the native messaging host in the
  registry (current user only; no admin needed).

## Setup

1. **Install Python 3** from python.org (the standard Windows installer
   includes tkinter). Check with `python --version`.
2. **Load the extension**: Chrome → `chrome://extensions` → enable
   *Developer mode* → *Load unpacked* → select the `extension/` folder.
3. **Copy the extension ID** shown on the extension card.
4. **Register the native host**: run `native-host\install.bat`, paste the
   extension ID when prompted. It writes
   `com.ytshorts.autoscroll.json` and adds the
   `HKCU\...\NativeMessagingHosts\com.ytshorts.autoscroll` registry key.
5. **Reload the extension** (circular-arrows icon on its card), then open
   `youtube.com/shorts`.

The red "▶" widget appears (top-left area of the screen). Drag it anywhere —
the position is saved. Click it (or right-click) to open/close the control
menu: Auto-Scroll ON/OFF, Pause/Resume, Next, Previous, and the delay in
seconds. Green dot = connected; red "Disconnected" means no Shorts tab is
open (or Chrome is closed).

## Behaviour & limitations (honest notes)

- **Chrome running, tab in background**: works. Video `ended` events keep
  firing, and a tab that plays audio is exempt from Chrome's timer
  throttling. Very long delays (> 1 min) in a muted/backgrounded tab may be
  slightly less precise.
- **Chrome fully closed**: the widget disappears. Chrome spawns and owns the
  native host process, so nothing can stay on screen when the browser exits —
  this is a hard browser limitation. The widget shows *Disconnected* in all
  less-severe cases (host missing, no Shorts tab, tab reloaded).
- **Reconnection**: the widget heartbeats every 15 s and the extension
  retries the native connection every 3 s, so closing/reopening Chrome or the
  Shorts tab recovers automatically.
- Using Chrome Beta/Dev/Edge? Duplicate the `reg add` line in
  `install.bat` under that browser's `NativeMessagingHosts` key.
- Keep the `extension/` folder where it is — loading unpacked points Chrome
  at that directory.
