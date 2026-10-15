const serverDot = document.getElementById('server-dot');
const serverText = document.getElementById('server-text');
const cookieDot = document.getElementById('cookie-dot');
const cookieText = document.getElementById('cookie-text');
const btnSync = document.getElementById('btn-sync');
const logMsg = document.getElementById('log-msg');

async function checkState() {
  // Check local server
  try {
    const res = await fetch('http://127.0.0.1:3000/api/health');
    if (res.ok) {
      serverDot.className = 'dot online';
      serverText.textContent = 'Connected';
    } else {
      throw new Error();
    }
  } catch {
    serverDot.className = 'dot offline';
    serverText.textContent = 'Offline (Run npm start)';
  }

  // Check Gradescope cookies in browser
  try {
    const signed = await chrome.cookies.get({ url: 'https://www.gradescope.com', name: 'signed_token' });
    const session = await chrome.cookies.get({ url: 'https://www.gradescope.com', name: '_gradescope_session' });
    if (signed || session) {
      cookieDot.className = 'dot online';
      cookieText.textContent = 'Detected in Chrome';
    } else {
      cookieDot.className = 'dot offline';
      cookieText.textContent = 'Not Logged In';
    }
  } catch (err) {
    cookieDot.className = 'dot offline';
    cookieText.textContent = 'Cookie Error';
  }

  // Get last sync status from background
  chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
    if (response && response.message) {
      logMsg.textContent = response.message;
      if (logMsg.parentElement) logMsg.parentElement.title = `Sync Status: ${response.message}`;
    }
  });
}

btnSync.addEventListener('click', () => {
  btnSync.textContent = 'Syncing...';
  btnSync.disabled = true;
  chrome.runtime.sendMessage({ action: 'syncNow' }, (response) => {
    btnSync.textContent = '⚡ Sync Now';
    btnSync.disabled = false;
    if (response) {
      logMsg.textContent = response.message;
      if (logMsg.parentElement) logMsg.parentElement.title = `Sync Status: ${response.message}`;
      checkState();
    }
  });
});

document.addEventListener('DOMContentLoaded', checkState);
