// ═══════════════════════════════════════════════════════════════════════════════
//  All3 Academic Sync — Background Service Worker
//  Zero-click automatic cookie extraction and local backend synchronization
// ═══════════════════════════════════════════════════════════════════════════════

const LOCAL_SERVER_URL = 'http://127.0.0.1:3000/api/gradescope/set-cookies';
const GRADESCOPE_URL = 'https://www.gradescope.com';

let lastSyncedCookieString = null;
let lastSyncStatus = { success: false, timestamp: null, message: 'Initialized' };

/**
 * Extracts Gradescope authentication cookies and posts them to local server
 */
async function syncGradescopeSession() {
  try {
    const signedCookie = await chrome.cookies.get({ url: GRADESCOPE_URL, name: 'signed_token' });
    const sessionCookie = await chrome.cookies.get({ url: GRADESCOPE_URL, name: '_gradescope_session' });

    if (!signedCookie && !sessionCookie) {
      lastSyncStatus = { success: false, timestamp: new Date().toISOString(), message: 'No Gradescope cookies found in browser. Please log in to Gradescope.' };
      return lastSyncStatus;
    }

    const parts = [];
    if (signedCookie) parts.push(`signed_token=${signedCookie.value}`);
    if (sessionCookie) parts.push(`_gradescope_session=${sessionCookie.value}`);
    const cookieString = parts.join('; ');

    // Only transmit if cookies changed
    if (cookieString === lastSyncedCookieString) {
      return { success: true, timestamp: new Date().toISOString(), message: 'Cookies already in sync' };
    }

    const response = await fetch(LOCAL_SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'All3-Academic-Sync-Extension',
      },
      body: JSON.stringify({ cookies: cookieString }),
    });

    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }

    const result = await response.json();
    if (result.success) {
      lastSyncedCookieString = cookieString;
      lastSyncStatus = { success: true, timestamp: new Date().toISOString(), message: 'Synced successfully with local backend!' };
      console.log('✅ [All3 Sync] Gradescope session synced to localhost:3000');
    } else {
      throw new Error(result.error || 'Server rejected cookie payload');
    }

    return lastSyncStatus;
  } catch (err) {
    lastSyncStatus = { success: false, timestamp: new Date().toISOString(), message: `Sync failed: ${err.message}` };
    console.warn('⚠️ [All3 Sync] Sync error:', err.message);
    return lastSyncStatus;
  }
}

// ── 1. Listen for Cookie Changes in Gradescope ───────────────────────────────
chrome.cookies.onChanged.addListener((changeInfo) => {
  if (changeInfo.cookie.domain.includes('gradescope.com')) {
    if (changeInfo.cookie.name === 'signed_token' || changeInfo.cookie.name === '_gradescope_session') {
      console.log('🔄 [All3 Sync] Gradescope cookie changed, auto-syncing...');
      syncGradescopeSession();
    }
  }
});

// ── 2. Listen for Tab Navigation to Gradescope ──────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('gradescope.com')) {
    syncGradescopeSession();
  }
});

// ── 3. Periodic Keep-Alive Alarm (Every 30 mins) ─────────────────────────────
chrome.alarms.create('gradescope-periodic-sync', { periodInMinutes: 30 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'gradescope-periodic-sync') {
    syncGradescopeSession();
  }
});

// ── 4. Initial Sync on Startup ──────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  syncGradescopeSession();
});
chrome.runtime.onStartup.addListener(() => {
  syncGradescopeSession();
});

// ── 5. Message Handler for Popup ────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'syncNow') {
    lastSyncedCookieString = null; // Force sync
    syncGradescopeSession().then(res => sendResponse(res));
    return true; // Keep message channel open for async response
  }
  if (request.action === 'getStatus') {
    sendResponse(lastSyncStatus);
    return false;
  }
});
