// Popup: mirrors the desktop widget controls. Sends commands through the
// background worker (same path the widget uses) so state stays consistent.

let latest = null;

function send(command, value) {
  chrome.runtime.sendMessage({ type: 'command', command, value }, (res) => {
    if (res && res.ok) applyState(res);
  });
}

function applyState(s) {
  latest = s;
  const on = s.enabled !== false;
  const primary = document.getElementById('primary');
  primary.textContent = 'Auto-Scroll: ' + (on ? 'ON' : 'OFF');
  primary.classList.toggle('on', on);
  document.getElementById('pauseBtn').textContent = s.paused ? 'Resume' : 'Pause';
  document.getElementById('state').textContent = s.connectedToPage
    ? 'Connected to a Shorts tab'
    : 'Open a YouTube Shorts tab';
  if (s.delayMs !== undefined) document.getElementById('delay').value = s.delayMs / 1000;
}

// Ask the active shorts tab for its current state.
chrome.tabs.query({ url: '*://*.youtube.com/shorts*' }, (tabs) => {
  if (tabs.length) {
    chrome.tabs.sendMessage(tabs[0].id, { cmd: 'ping' }, (res) => {
      if (!chrome.runtime.lastError && res && res.ok) applyState(res);
    });
  }
});

document.getElementById('primary').addEventListener('click', () => send('toggle'));
document.getElementById('pauseBtn').addEventListener('click', () => send(latest && latest.paused ? 'resume' : 'pause'));
document.getElementById('nextBtn').addEventListener('click', () => send('next'));
document.getElementById('prevBtn').addEventListener('click', () => send('prev'));
document.getElementById('setDelay').addEventListener('click', () => {
  const secs = parseFloat(document.getElementById('delay').value);
  if (!isNaN(secs)) send('delay', Math.round(secs * 1000));
});
