// Service worker: bridges the YouTube tab <-> the desktop widget over
// Chrome native messaging. The widget sends commands here; the tab sends
// status here and we relay it to the widget.

const HOST_NAME = 'com.ytshorts.autoscroll';

let nativePort = null;
let nativeConnected = false;
let shortsTabId = null;

// ---------- native messaging ----------

function connectNative() {
  try {
    nativePort = chrome.runtime.connectNative(HOST_NAME);
    nativePort.onMessage.addListener(onNativeMessage);
    nativePort.onDisconnect.addListener(() => {
      nativeConnected = false;
      nativePort = null;
      pushStatus();
      // Auto-reconnect so the widget starts working again when the host
      // comes back (or Chrome restarts it on the next keepalive attempt).
      setTimeout(connectNative, 3000);
    });
    nativeConnected = true;
  } catch {
    nativeConnected = false;
    setTimeout(connectNative, 3000);
  }
}

function sendToWidget(msg) {
  if (nativePort && nativeConnected) {
    try {
      nativePort.postMessage(msg);
    } catch {
      /* port died mid-send; onDisconnect handles recovery */
    }
  }
}

function onNativeMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'hb') {
    // Heartbeat from the widget; echo it back so both sides stay alive.
    sendToWidget({ type: 'hb' });
    return;
  }
  if (msg.type === 'command') {
    sendCommandToTab(msg.command, msg.value, (ok) => {
      if (!ok) sendToWidget({ type: 'status', connected: false, error: 'no shorts tab' });
    });
  }
}

// ---------- tab <-> widget ----------

function sendCommandToTab(command, value, done) {
  if (shortsTabId == null) {
    findShortsTab((id) => {
      shortsTabId = id;
      if (id == null) {
        done(false);
        return;
      }
      deliver(id, command, value, done);
    });
    return;
  }
  deliver(shortsTabId, command, value, done);
}

function deliver(tabId, command, value, done) {
  chrome.tabs.sendMessage(tabId, { cmd: command, value }, (res) => {
    if (chrome.runtime.lastError || !res || !res.ok) {
      // Tab closed or the content script is gone; rediscover.
      shortsTabId = null;
      findShortsTab((id) => {
        shortsTabId = id;
        if (id == null) {
          done(false);
          return;
        }
        chrome.tabs.sendMessage(id, { cmd: command, value }, (res2) => {
          done(!!(res2 && res2.ok));
        });
      });
      return;
    }
    done(true);
  });
}

function findShortsTab(done) {
  chrome.tabs.query({ url: '*://*.youtube.com/shorts*', active: true, currentWindow: true }, (tabs) => {
    if (tabs.length) {
      done(tabs[0].id);
      return;
    }
    chrome.tabs.query({ url: '*://*.youtube.com/shorts*' }, (all) => {
      done(all.length ? all[0].id : null);
    });
  });
}

function pushStatus() {
  sendToWidget({ type: 'status', connected: nativeConnected && shortsTabId != null });
}

// Content script announcements.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && (msg.type === 'hello' || msg.type === 'status') && sender.tab) {
    shortsTabId = sender.tab.id;
    sendToWidget({
      type: 'status',
      connected: nativeConnected,
      enabled: msg.enabled,
      paused: msg.paused,
      delayMs: msg.delayMs,
    });
    sendResponse({ ok: true });
  } else if (msg && msg.type === 'command') {
    // From the popup: same path the widget uses.
    sendCommandToTab(msg.command, msg.value, (ok) => sendResponse({ ok }));
    return true; // async response
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === shortsTabId) {
    shortsTabId = null;
    pushStatus();
  }
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId === shortsTabId && info.status === 'loading') {
    // Full page reload wipes the content script; wait for its next hello.
    shortsTabId = null;
    pushStatus();
  }
});

// Keepalive: a native-messaging port alone doesn't guarantee the MV3 worker
// survives; the widget also heartbeats every 15s. This alarm is a fallback.
chrome.alarms.create('keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'keepalive') sendToWidget({ type: 'hb' });
});

connectNative();
