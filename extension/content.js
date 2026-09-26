// Content script: runs on youtube.com/shorts. Watches the active Short's video,
// and when it ends, waits `delayMs` then advances to the next Short.

const DEFAULTS = { enabled: true, paused: false, delayMs: 300 };

let state = { ...DEFAULTS };

let countdownTimer = null;   // 250ms watchdog that fires the scroll when the delay elapses
let endedAt = 0;             // timestamp when the active video ended (0 = not ended)
let pendingScroll = false;   // a scroll is scheduled but hasn't happened yet
let currentVideo = null;

// ---------- state / reporting ----------

function publicState() {
  return {
    enabled: state.enabled,
    paused: state.paused,
    delayMs: state.delayMs,
    onShortsPage: true,
  };
}

function report(type) {
  try {
    chrome.runtime.sendMessage({ type, ...publicState() }, () => void chrome.runtime.lastError);
  } catch {
    /* extension reloaded / background asleep - ignore */
  }
}

// ---------- finding the active Short's video ----------

function getActiveVideo() {
  // Preferred: YouTube marks the visible reel renderer as active.
  const active = document.querySelector('ytd-reel-video-renderer[is-active] video');
  if (active) return active;

  // Fallback: the video element closest to the viewport center.
  let best = null;
  let bestDist = Infinity;
  const centerY = window.innerHeight / 2;
  for (const v of document.querySelectorAll('ytd-reel-video-renderer video, shorts-video video, video')) {
    const r = v.getBoundingClientRect();
    if (r.height === 0) continue;
    const dist = Math.abs(r.top + r.height / 2 - centerY);
    if (dist < bestDist) {
      bestDist = dist;
      best = v;
    }
  }
  return best;
}

// ---------- navigation ----------

function clickNav(down) {
  const sel = down ? '#navigation-button-down button' : '#navigation-button-up button';
  const btn = document.querySelector(sel);
  if (btn) {
    btn.click();
    return true;
  }
  // Fallback: scroll the neighbouring reel into view.
  const active = document.querySelector('ytd-reel-video-renderer[is-active]');
  const sib = down ? active && active.nextElementSibling : active && active.previousElementSibling;
  if (sib) {
    sib.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  }
  return false;
}

// ---------- auto-scroll engine ----------

function cancelScheduledScroll() {
  pendingScroll = false;
  endedAt = 0;
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function scheduleNextScroll() {
  if (!state.enabled || state.paused || pendingScroll) return;
  pendingScroll = true;
  endedAt = Date.now();
  // Watchdog interval instead of a single setTimeout: media events still fire
  // in background tabs, and a repeating timer survives throttling better.
  countdownTimer = setInterval(() => {
    if (!state.enabled || state.paused) {
      cancelScheduledScroll();
      report('status');
      return;
    }
    if (Date.now() - endedAt >= state.delayMs) {
      cancelScheduledScroll();
      if (clickNav(true)) report('status');
    }
  }, 250);
}

function watchVideo(video) {
  if (currentVideo === video) return;
  currentVideo = video;
  cancelScheduledScroll();
  video.addEventListener('ended', () => {
    // Only react if this video is still the visible one.
    if (video === getActiveVideo()) scheduleNextScroll();
  });
}

function tick() {
  if (!location.pathname.startsWith('/shorts')) return;
  const video = getActiveVideo();
  if (video) watchVideo(video);
}

// ---------- commands (from popup, background, or the desktop widget) ----------

function handleCommand(cmd, value) {
  switch (cmd) {
    case 'toggle':
      state.enabled = !state.enabled;
      if (!state.enabled) cancelScheduledScroll();
      break;
    case 'enable':
      state.enabled = true;
      break;
    case 'disable':
      state.enabled = false;
      cancelScheduledScroll();
      break;
    case 'pause':
      state.paused = true;
      cancelScheduledScroll();
      break;
    case 'resume':
      state.paused = false;
      break;
    case 'next':
      cancelScheduledScroll();
      clickNav(true);
      break;
    case 'prev':
      cancelScheduledScroll();
      clickNav(false);
      break;
    case 'delay':
      state.delayMs = Math.max(0, Math.min(60000, Number(value) || 0));
      chrome.storage.local.set({ delayMs: state.delayMs });
      break;
    default:
      return;
  }
  report('status');
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.cmd) {
    handleCommand(msg.cmd, msg.value);
    sendResponse({ ok: true, ...publicState(), connectedToPage: true });
  } else if (msg && msg.cmd === undefined && msg.type === 'ping') {
    sendResponse({ ok: true, ...publicState(), connectedToPage: true });
  }
  return false; // handled synchronously
});

// Settings changed from the popup / other pages -> keep in sync.
chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled) {
    state.enabled = changes.enabled.newValue !== false;
    if (!state.enabled) cancelScheduledScroll();
  }
  if (changes.delayMs) state.delayMs = Math.max(0, Number(changes.delayMs.newValue) || 0);
  report('status');
});

// ---------- startup ----------

chrome.storage.local.get(['enabled', 'delayMs'], (res) => {
  if (res.enabled !== undefined) state.enabled = res.enabled !== false;
  if (res.delayMs !== undefined) state.delayMs = Math.max(0, Number(res.delayMs) || 0);
});

// Announce ourselves so the background worker knows which tab to command.
report('hello');

// YouTube is a SPA: re-attach whenever navigation lands on a new Short.
window.addEventListener('yt-navigate-finish', () => {
  currentVideo = null;
  cancelScheduledScroll();
  report('hello');
  setTimeout(tick, 300);
});

setInterval(tick, 1000);
