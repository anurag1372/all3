// ═══════════════════════════════════════════════════════════════════════════════
//  Academic Platform Hub — Frontend Orchestrator
// ═══════════════════════════════════════════════════════════════════════════════

const API = {
  health: '/api/health',
  canvas: {
    test: '/api/canvas/test',
    courses: '/api/canvas/courses',
  },
  gradescope: {
    test: '/api/gradescope/test',
    courses: '/api/gradescope/courses',
    pending: '/api/gradescope/pending',
  },
  edstem: {
    test: '/api/edstem/test',
    courses: '/api/edstem/courses',
    recentThreads: '/api/edstem/recent-threads?limit=30',
  },
};

// ─── 1. Server Health ─────────────────────────────────────────────────────────
async function checkServerHealth() {
  const statusEl = document.getElementById('server-status');
  try {
    const res = await fetch(API.health);
    const data = await res.json();
    statusEl.classList.remove('error');
    statusEl.classList.add('connected');
    statusEl.querySelector('.status-text').textContent = 'Server online (127.0.0.1)';
    return data;
  } catch {
    statusEl.classList.remove('connected');
    statusEl.classList.add('error');
    statusEl.querySelector('.status-text').textContent = 'Server offline';
    return null;
  }
}

// ─── 2. Auto-load Canvas Status ──────────────────────────────────────────────
async function loadCanvasStatus() {
  const card = document.getElementById('card-canvas');
  const badge = document.getElementById('badge-canvas');
  const resultEl = document.getElementById('result-canvas');

  try {
    const [testRes, coursesRes] = await Promise.all([
      fetch(API.canvas.test).then(r => r.json()).catch(() => ({ success: false })),
      fetch(API.canvas.courses).then(r => r.json()).catch(() => ({ success: false })),
    ]);

    if (testRes.success) {
      badge.textContent = 'Active & Ready';
      badge.className = 'card-badge success';
      card.className = 'platform-card success';

      const userName = testRes.data?.[0]?.name || 'Authenticated Student';
      const courseCount = coursesRes.success ? (coursesRes.recordCount ?? coursesRes.data?.length ?? 0) : 'Active';

      resultEl.innerHTML = `
        <div class="result-summary success">
          <strong>✓ Connected as ${escapeHtml(userName)}</strong>
          <div style="margin-top: 4px; font-size: 12px; color: var(--text-secondary);">
            • ${courseCount} enrolled courses discovered<br>
            • Module file resolver & PDF text cache operational
          </div>
        </div>
      `;
      const drawerCanvas = document.getElementById('drawer-status-canvas');
      if (drawerCanvas) drawerCanvas.innerHTML = `Canvas Token: <span class="badge-status connected">✓ Valid</span>`;
    } else {
      badge.textContent = 'Token Missing / Invalid';
      badge.className = 'card-badge error';
      card.className = 'platform-card error';
      resultEl.innerHTML = `
        <div class="result-summary error">
          <strong>✗ Not connected</strong><br>
          ${escapeHtml(testRes.error || 'Check CANVAS_API_TOKEN in .env')}
        </div>
      `;
      const drawerCanvas = document.getElementById('drawer-status-canvas');
      if (drawerCanvas) drawerCanvas.innerHTML = `Canvas Token: <span class="badge-status missing">✗ Missing</span>`;
    }
  } catch (err) {
    badge.textContent = 'Error';
    badge.className = 'card-badge error';
    resultEl.innerHTML = `<div class="result-summary error">${escapeHtml(err.message)}</div>`;
  }
}

// ─── 3. Auto-load Gradescope Status ──────────────────────────────────────────
async function loadGradescopeStatus() {
  const card = document.getElementById('card-gradescope');
  const badge = document.getElementById('badge-gradescope');
  const resultEl = document.getElementById('result-gradescope');

  try {
    const [testRes, coursesRes] = await Promise.all([
      fetch(API.gradescope.test).then(r => r.json()).catch(() => ({ success: false })),
      fetch(API.gradescope.courses).then(r => r.json()).catch(() => ({ success: false })),
    ]);

    if (testRes.success) {
      badge.textContent = 'Active & Synced';
      badge.className = 'card-badge success';
      card.className = 'platform-card success';

      const courseCount = coursesRes.success ? (coursesRes.recordCount ?? coursesRes.data?.length ?? 0) : 'Active';

      resultEl.innerHTML = `
        <div class="result-summary success">
          <strong>✓ Session Authenticated via Cookies</strong>
          <div style="margin-top: 4px; font-size: 12px; color: var(--text-secondary);">
            • ${courseCount} active courses auto-crawled<br>
            • Chrome extension background sync active
          </div>
        </div>
      `;
      const drawerGs = document.getElementById('drawer-status-gradescope');
      if (drawerGs) drawerGs.innerHTML = `Gradescope Cookies: <span class="badge-status connected">✓ Synced</span>`;
    } else {
      badge.textContent = 'Waiting for Sync';
      badge.className = 'card-badge not-configured';
      card.className = 'platform-card';
      resultEl.innerHTML = `
        <div class="result-summary loading">
          Waiting for Gradescope session cookies.<br>
          <span style="font-size: 11px; opacity: 0.8;">Open Gradescope in Chrome with extension installed to auto-sync.</span>
        </div>
      `;
      const drawerGs = document.getElementById('drawer-status-gradescope');
      if (drawerGs) drawerGs.innerHTML = `Gradescope Cookies: <span class="badge-status missing">✗ Waiting</span>`;
    }
  } catch (err) {
    badge.textContent = 'Error';
    badge.className = 'card-badge error';
    resultEl.innerHTML = `<div class="result-summary error">${escapeHtml(err.message)}</div>`;
  }
}

// ─── 4. Auto-load EdStem Status ──────────────────────────────────────────────
async function loadEdStemStatus() {
  const card = document.getElementById('card-edstem');
  const badge = document.getElementById('badge-edstem');
  const resultEl = document.getElementById('result-edstem');

  try {
    const [testRes, coursesRes] = await Promise.all([
      fetch(API.edstem.test).then(r => r.json()).catch(() => ({ success: false })),
      fetch(API.edstem.courses).then(r => r.json()).catch(() => ({ success: false })),
    ]);

    if (testRes.success) {
      badge.textContent = 'Active & Ready';
      badge.className = 'card-badge success';
      card.className = 'platform-card success';

      const userName = testRes.data?.[0]?.name || 'Student';
      const courseCount = coursesRes.success ? (coursesRes.recordCount ?? coursesRes.data?.length ?? 0) : 'Active';

      resultEl.innerHTML = `
        <div class="result-summary success">
          <strong>✓ Connected as ${escapeHtml(userName)}</strong>
          <div style="margin-top: 4px; font-size: 12px; color: var(--text-secondary);">
            • ${courseCount} enrolled discussion spaces<br>
            • Rolling historical thread sync enabled
          </div>
        </div>
      `;
      const drawerEd = document.getElementById('drawer-status-edstem');
      if (drawerEd) drawerEd.innerHTML = `EdStem Token: <span class="badge-status connected">✓ Valid</span>`;
    } else {
      badge.textContent = 'Token Missing / Invalid';
      badge.className = 'card-badge error';
      card.className = 'platform-card error';
      resultEl.innerHTML = `
        <div class="result-summary error">
          <strong>✗ Not connected</strong><br>
          ${escapeHtml(testRes.error || 'Check EDSTEM_API_TOKEN in .env')}
        </div>
      `;
      const drawerEd = document.getElementById('drawer-status-edstem');
      if (drawerEd) drawerEd.innerHTML = `EdStem Token: <span class="badge-status missing">✗ Missing</span>`;
    }
  } catch (err) {
    badge.textContent = 'Error';
    badge.className = 'card-badge error';
    resultEl.innerHTML = `<div class="result-summary error">${escapeHtml(err.message)}</div>`;
  }
}

// ─── 5. Action: Show All Pending (Gradescope: STRICTLY Unsubmitted Only) ─────
let pendingAssignmentsCache = [];
let pendingSortMode = 'default'; // 'default' or 'time'

function setPendingSort(mode) {
  pendingSortMode = mode;
  renderPendingTable();
}

function renderPendingTable() {
  const body = document.getElementById('inspector-body');
  const title = document.getElementById('inspector-title');

  title.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="1" y="1" width="16" height="16" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="M5 5h8M5 9h6M5 13h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
    Unsubmitted Pending Deadlines (${pendingAssignmentsCache.length})
  `;

  if (pendingAssignmentsCache.length === 0) {
    body.innerHTML = `
      <div class="inspector-empty">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" opacity="0.3">
          <path d="M12 24l8 8 16-16" stroke="var(--success)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <p style="color: var(--success); font-weight: 500;">All caught up!</p>
        <p style="font-size: 13px; color: var(--text-secondary);">No unsubmitted assignments found across your Gradescope courses.</p>
      </div>
    `;
    return;
  }

  // Clone and sort if needed
  let displayList = [...pendingAssignmentsCache];
  if (pendingSortMode === 'time') {
    displayList.sort((a, b) => {
      const timeA = a.dueTimestamp || Infinity;
      const timeB = b.dueTimestamp || Infinity;
      return timeA - timeB; // Earliest deadline first
    });
  }

  const rowsHtml = displayList.map(a => {
    const lateHtml = a.lateDueDate ? `<div style="font-size: 11px; color: var(--text-tertiary); margin-top: 2px;">Late cutoff: ${escapeHtml(a.lateDueDate)}</div>` : '';
    return `
      <tr>
        <td><span class="badge-code">${escapeHtml(a.courseCode || a.courseName)}</span></td>
        <td><strong>${escapeHtml(a.name)}</strong></td>
        <td><span class="status-badge-inline warning">⚠️ ${escapeHtml(a.status || 'Not Submitted')}</span></td>
        <td>
          <div style="font-weight: 600; color: #fbbf24;">⏳ ${escapeHtml(a.timeLeft || 'Upcoming')}</div>
          <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">Due: <strong>${escapeHtml(a.dueDate)}</strong></div>
          ${lateHtml}
        </td>
        <td>
          <a href="${a.assignmentUrl}" target="_blank" rel="noopener" class="link-btn">
            Submit on Gradescope ↗
          </a>
        </td>
      </tr>
    `;
  }).join('');

  const sortControlsHtml = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding: 4px 2px;">
      <div style="font-size: 12px; color: var(--text-secondary);">
        Showing <strong>${displayList.length}</strong> unsubmitted assignments
      </div>
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="font-size: 11px; color: var(--text-tertiary);">Sort by:</span>
        <button class="btn btn-sm ${pendingSortMode === 'default' ? 'btn-primary' : 'btn-ghost'}" onclick="setPendingSort('default')">
          📋 Default Order
        </button>
        <button class="btn btn-sm ${pendingSortMode === 'time' ? 'btn-primary' : 'btn-ghost'}" onclick="setPendingSort('time')">
          ⏱️ By Time (Urgent First)
        </button>
      </div>
    </div>
  `;

  body.innerHTML = `
    ${sortControlsHtml}
    <div class="table-container">
      <table class="data-table">
        <thead>
          <tr>
            <th>Course</th>
            <th>Assignment</th>
            <th>Submission Status</th>
            <th style="cursor: pointer;" onclick="setPendingSort(pendingSortMode === 'time' ? 'default' : 'time')" title="Click to toggle sorting by time">
              Time Left & Due Date ${pendingSortMode === 'time' ? '▲ (Sorted)' : '⇅'}
            </th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  `;
}

async function loadPendingAssignments() {
  const btn = document.getElementById('btn-gradescope-pending');
  const otherBtn = document.getElementById('btn-edstem-threads');
  const body = document.getElementById('inspector-body');

  // Set active state on button
  if (btn) btn.classList.add('active');
  if (otherBtn) otherBtn.classList.remove('active');

  const btnText = btn?.querySelector('.btn-text');
  const btnIcon = btn?.querySelector('.btn-icon');
  const origText = btnText ? btnText.textContent : '';
  const origIcon = btnIcon ? btnIcon.innerHTML : '';

  if (btnText) btnText.textContent = 'Scanning courses...';
  if (btnIcon) btnIcon.innerHTML = '<span class="spinner" style="width:12px;height:12px;border-width:2px;"></span>';
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(API.gradescope.pending);
    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch pending assignments');
    }

    pendingAssignmentsCache = data.data || [];
    renderPendingTable();

    document.getElementById('inspector').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    body.innerHTML = `
      <div class="result-summary error" style="margin: 16px;">
        <strong>Error loading pending assignments:</strong> ${escapeHtml(err.message)}
      </div>
    `;
  } finally {
    if (btnText) btnText.textContent = origText || 'Show all pending';
    if (btnIcon) btnIcon.innerHTML = origIcon || '⏳';
    if (btn) btn.disabled = false;
  }
}

// ─── 6. Action: Last 30 Threads (Ed Discussion: WITH THREAD BODY) ─────────────
async function loadRecentThreads() {
  const btn = document.getElementById('btn-edstem-threads');
  const otherBtn = document.getElementById('btn-gradescope-pending');
  const body = document.getElementById('inspector-body');
  const title = document.getElementById('inspector-title');

  // Set active state on button
  if (btn) btn.classList.add('active');
  if (otherBtn) otherBtn.classList.remove('active');

  const btnText = btn?.querySelector('.btn-text');
  const btnIcon = btn?.querySelector('.btn-icon');
  const origText = btnText ? btnText.textContent : '';
  const origIcon = btnIcon ? btnIcon.innerHTML : '';

  if (btnText) btnText.textContent = 'Fetching threads...';
  if (btnIcon) btnIcon.innerHTML = '<span class="spinner" style="width:12px;height:12px;border-width:2px;"></span>';
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(API.edstem.recentThreads);
    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch discussion threads');
    }

    const threads = data.data || [];
    title.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="1" y="1" width="16" height="16" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="M5 5h8M5 9h6M5 13h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      Ed Discussion — Last ${threads.length} Threads (With Post Text)
    `;

    if (threads.length === 0) {
      body.innerHTML = `
        <div class="inspector-empty">
          <p>No discussion threads found.</p>
        </div>
      `;
      return;
    }

    const cardsHtml = threads.map((t, index) => {
      const createdStr = t.created_at ? new Date(t.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
      const answeredBadge = t.is_answered ? `<span class="status-badge-inline success">✓ Answered</span>` : '';
      const docText = t.document || t.content || '(No additional text content)';

      return `
        <div class="thread-card-item">
          <div class="thread-card-header">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span class="badge-code">${escapeHtml(t.courseCode)}</span>
              <span class="badge-category">${escapeHtml(t.category || 'General')}</span>
              ${answeredBadge}
              <span style="font-size: 13px; font-weight: 600; color: var(--text-primary);">
                #${t.number || ''} ${escapeHtml(t.title)}
              </span>
            </div>
            <div style="display: flex; align-items: center; gap: 10px; font-size: 11px; color: var(--text-secondary); margin-left: auto;">
              <span>💬 ${t.reply_count ?? 0}</span>
              <span>❤️ ${t.vote_count ?? 0}</span>
              <span>${createdStr}</span>
              <a href="${t.url}" target="_blank" rel="noopener" class="link-btn" style="padding: 2px 8px; font-size: 11px;">
                Open Thread ↗
              </a>
            </div>
          </div>
          <div class="thread-author-line">
            Posted by <strong style="color: var(--text-primary);">${escapeHtml(t.user_name || 'Anonymous')}</strong>
          </div>
          <div class="thread-card-content">
            ${formatThreadText(docText)}
          </div>
        </div>
      `;
    }).join('');

    body.innerHTML = `
      <div class="thread-feed-container">
        ${cardsHtml}
      </div>
    `;

    document.getElementById('inspector').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    body.innerHTML = `
      <div class="result-summary error" style="margin: 16px;">
        <strong>Error loading threads:</strong> ${escapeHtml(err.message)}
      </div>
    `;
  } finally {
    if (btnText) btnText.textContent = origText || 'last 30 threads';
    if (btnIcon) btnIcon.innerHTML = origIcon || '💬';
    if (btn) btn.disabled = false;
  }
}

// ─── Format Thread Text ──────────────────────────────────────────────────────
function formatThreadText(text) {
  if (!text) return '<span style="color: var(--text-tertiary); font-style: italic;">(Empty post body)</span>';
  
  // Clean up XML tags if raw Lexical content leaked
  let clean = text.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').trim();
  
  // Split into paragraphs
  const paragraphs = clean.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  if (paragraphs.length === 0) return escapeHtml(clean);

  return paragraphs.map(p => `<p class="thread-paragraph">${escapeHtml(p.trim())}</p>`).join('');
}

// ─── 7. Clear Inspector ───────────────────────────────────────────────────────
function clearInspector() {
  const body = document.getElementById('inspector-body');
  const title = document.getElementById('inspector-title');

  // Clear active state on action buttons
  document.getElementById('btn-gradescope-pending')?.classList.remove('active');
  document.getElementById('btn-edstem-threads')?.classList.remove('active');

  title.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="1" y="1" width="16" height="16" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="M5 5h8M5 9h6M5 13h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
    Data Inspector
  `;

  body.innerHTML = `
    <div class="inspector-empty">
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" opacity="0.3">
        <circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="2"/>
        <path d="M16 20h16M16 28h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <p>Click <strong>"Show all pending"</strong> or <strong>"last 30 threads"</strong> above to inspect records here</p>
    </div>
  `;
}

// ─── 8. Setup Sidebar Drawer Controls ────────────────────────────────────────
function toggleSetupSidebar(forceState) {
  const drawer = document.getElementById('setup-sidebar');
  const backdrop = document.getElementById('setup-backdrop');
  if (!drawer || !backdrop) return;

  const isOpen = drawer.classList.contains('open');
  const shouldOpen = typeof forceState === 'boolean' ? forceState : !isOpen;

  if (shouldOpen) {
    drawer.classList.add('open');
    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
  } else {
    drawer.classList.remove('open');
    backdrop.classList.remove('open');
    document.body.style.overflow = '';
  }
}

// ─── Utility Helpers ─────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Ambient Lifecycle ───────────────────────────────────────────────────────
async function initDashboard() {
  await checkServerHealth();
  await Promise.all([
    loadCanvasStatus(),
    loadGradescopeStatus(),
    loadEdStemStatus(),
  ]);
}

document.addEventListener('DOMContentLoaded', () => {
  initDashboard();
  // Auto-refresh platform status every 15 seconds
  setInterval(initDashboard, 15000);

  // Keyboard shortcut: Escape closes setup drawer
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      toggleSetupSidebar(false);
    }
  });
});
