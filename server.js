require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const { PDFParse } = require('pdf-parse');
const cacheManager = require('./cache');
const outputManager = require('./output');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ─── Security: Local Loopback & Extension Origin Validation ──────────────────
app.use((req, res, next) => {
  const origin = req.headers.origin;
  // Requests without Origin (direct curl, CLI tools, scripts) are allowed locally
  if (!origin) return next();

  const isLocal = origin.includes('127.0.0.1') || origin.includes('localhost');
  const isExtension = origin.startsWith('chrome-extension://');

  if (isLocal || isExtension) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  }

  // Reject foreign websites trying to cross-site access localhost
  return res.status(403).json({ error: 'Forbidden: Origin unauthorized' });
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    canvas: { configured: !!process.env.CANVAS_API_TOKEN },
    edstem: { configured: !!process.env.EDSTEM_API_TOKEN },
    gradescope: { configured: !!(getGradescopeCookies() || (process.env.GRADESCOPE_EMAIL && process.env.GRADESCOPE_PASSWORD)) },
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  CANVAS LMS
// ═══════════════════════════════════════════════════════════════════════════════

const CANVAS_BASE = (process.env.CANVAS_BASE_URL || 'https://canvas.eee.uci.edu').replace(/\/$/, '');
const CANVAS_TOKEN = process.env.CANVAS_API_TOKEN;

async function canvasFetch(endpoint) {
  if (!CANVAS_TOKEN) throw new Error('CANVAS_API_TOKEN not configured in .env');
  const url = `${CANVAS_BASE}/api/v1${endpoint}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${CANVAS_TOKEN}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Canvas API ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

// Test connection — fetch user profile
app.get('/api/canvas/test', async (req, res) => {
  try {
    const profile = await canvasFetch('/users/self/profile');
    res.json({
      success: true,
      platform: 'Canvas LMS',
      category: 'User Profile',
      recordCount: 1,
      data: [profile],
      fields: Object.keys(profile),
      sourceUrl: `${CANVAS_BASE}/api/v1/users/self/profile`,
    });
  } catch (err) {
    res.json({ success: false, platform: 'Canvas LMS', error: err.message });
  }
});

// Fetch courses
app.get('/api/canvas/courses', async (req, res) => {
  try {
    const courses = await canvasFetch('/courses?per_page=20&include[]=term&include[]=total_scores&enrollment_state=active');
    res.json({
      success: true,
      platform: 'Canvas LMS',
      category: 'Courses',
      recordCount: courses.length,
      data: courses.map(c => ({
        id: c.id,
        name: c.name,
        code: c.course_code,
        term: c.term?.name,
        enrollment_type: c.enrollments?.[0]?.type,
        workflow_state: c.workflow_state,
      })),
      fields: ['id', 'name', 'code', 'term', 'enrollment_type', 'workflow_state'],
      sourceUrl: `${CANVAS_BASE}/api/v1/courses`,
    });
  } catch (err) {
    res.json({ success: false, platform: 'Canvas LMS', error: err.message });
  }
});

// Fetch assignments for a course
app.get('/api/canvas/courses/:id/assignments', async (req, res) => {
  try {
    const assignments = await canvasFetch(`/courses/${req.params.id}/assignments?per_page=20&order_by=due_at`);
    res.json({
      success: true,
      platform: 'Canvas LMS',
      category: 'Assignments',
      recordCount: assignments.length,
      data: assignments.map(a => ({
        id: a.id,
        name: a.name,
        due_at: a.due_at,
        points_possible: a.points_possible,
        submission_types: a.submission_types,
        has_submitted_submissions: a.has_submitted_submissions,
      })),
      fields: ['id', 'name', 'due_at', 'points_possible', 'submission_types', 'has_submitted_submissions'],
      sourceUrl: `${CANVAS_BASE}/api/v1/courses/${req.params.id}/assignments`,
    });
  } catch (err) {
    res.json({ success: false, platform: 'Canvas LMS', error: err.message });
  }
});

// Fetch modules for a course
app.get('/api/canvas/courses/:id/modules', async (req, res) => {
  try {
    const modules = await canvasFetch(`/courses/${req.params.id}/modules?include[]=items&per_page=50`);
    res.json({
      success: true,
      platform: 'Canvas LMS',
      category: 'Modules',
      recordCount: modules.length,
      data: modules,
      sourceUrl: `${CANVAS_BASE}/api/v1/courses/${req.params.id}/modules`,
    });
  } catch (err) {
    res.json({ success: false, platform: 'Canvas LMS', error: err.message });
  }
});

// Download and parse text from a Canvas file / PDF (with transparent caching)
app.get('/api/canvas/courses/:courseId/files/:fileId/text', async (req, res) => {
  const courseId = req.params.courseId;
  const fileId = req.params.fileId;
  const forceRefresh = req.query.refresh === 'true';

  try {
    // 1. Fetch metadata first (lightweight JSON check)
    let fileInfo;
    try {
      fileInfo = await canvasFetch(`/courses/${courseId}/files/${fileId}`);
    } catch (err) {
      // If Canvas API is unreachable, fall back seamlessly to offline cache
      const cached = cacheManager.getCanvasFileCache(courseId, fileId);
      if (cached) {
        return res.json({
          success: true,
          fileName: cached.fileName,
          size: cached.size,
          contentType: cached.contentType,
          text: cached.text,
          sourceUrl: cached.sourceUrl,
          fromCache: true,
          cachedAt: cached.cachedAt,
          notice: 'Served from offline cache (Canvas API unreachable)',
        });
      }
      throw err;
    }

    // 2. Check cache: if not forcing refresh and size matches, return in 2ms!
    if (!forceRefresh) {
      const cached = cacheManager.getCanvasFileCache(courseId, fileId, fileInfo.size);
      if (cached) {
        return res.json({
          success: true,
          fileName: cached.fileName,
          size: cached.size,
          contentType: cached.contentType,
          text: cached.text,
          sourceUrl: cached.sourceUrl,
          fromCache: true,
          cachedAt: cached.cachedAt,
        });
      }
    }

    // 3. Cache miss or updated file: download & extract text
    if (!fileInfo.url) throw new Error('File download URL unavailable');
    const downloadRes = await fetch(fileInfo.url);
    const buffer = await downloadRes.buffer();

    let extractedText = '';
    if (fileInfo['content-type'] === 'application/pdf' || fileInfo.display_name?.endsWith('.pdf')) {
      const parser = new PDFParse(new Uint8Array(buffer));
      await parser.load();
      const parsed = await parser.getText();
      extractedText = parsed.text || parsed;
    } else {
      extractedText = buffer.toString('utf8');
    }

    // 4. Save to cache transparently (errors never block response)
    cacheManager.saveCanvasFileCache(courseId, fileId, {
      fileName: fileInfo.display_name,
      size: fileInfo.size,
      contentType: fileInfo['content-type'],
      text: extractedText,
      sourceUrl: fileInfo.url,
      updatedAt: fileInfo.updated_at,
    });

    res.json({
      success: true,
      fileName: fileInfo.display_name,
      size: fileInfo.size,
      contentType: fileInfo['content-type'],
      text: extractedText,
      sourceUrl: fileInfo.url,
      fromCache: false,
    });
  } catch (err) {
    res.json({ success: false, platform: 'Canvas LMS', error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  ED DISCUSSION (EDSTEM)
// ═══════════════════════════════════════════════════════════════════════════════

const EDSTEM_BASE = (process.env.EDSTEM_BASE_URL || 'https://us.edstem.org/api').replace(/\/$/, '');
const EDSTEM_TOKEN = process.env.EDSTEM_API_TOKEN;

async function edstemFetch(endpoint) {
  if (!EDSTEM_TOKEN) throw new Error('EDSTEM_API_TOKEN not configured in .env');
  const url = `${EDSTEM_BASE}${endpoint}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${EDSTEM_TOKEN}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`EdStem API ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

// Test connection — fetch user info
app.get('/api/edstem/test', async (req, res) => {
  try {
    const data = await edstemFetch('/user');
    const user = data.user || data;
    res.json({
      success: true,
      platform: 'Ed Discussion',
      category: 'User Profile',
      recordCount: 1,
      data: [user],
      fields: Object.keys(user),
      sourceUrl: `${EDSTEM_BASE}/user`,
    });
  } catch (err) {
    res.json({ success: false, platform: 'Ed Discussion', error: err.message });
  }
});

// Fetch courses
app.get('/api/edstem/courses', async (req, res) => {
  try {
    const data = await edstemFetch('/user');
    const courses = data.courses || [];
    res.json({
      success: true,
      platform: 'Ed Discussion',
      category: 'Courses',
      recordCount: courses.length,
      data: courses.map(c => {
        const course = c.course || c;
        const role = (c.role && typeof c.role === 'object' ? c.role.role : c.role) || '';
        return {
          id: course.id,
          code: course.code,
          name: course.name,
          year: course.year,
          session: course.session,
          role: role,
          status: course.status,
        };
      }),
      fields: ['id', 'code', 'name', 'year', 'session', 'role', 'status'],
      sourceUrl: `${EDSTEM_BASE}/user`,
    });
  } catch (err) {
    res.json({ success: false, platform: 'Ed Discussion', error: err.message });
  }
});

// Fetch threads for a course (with accumulative historical cache upsert)
app.get('/api/edstem/courses/:id/threads', async (req, res) => {
  const courseId = req.params.id;
  const limit = req.query.limit || 30;

  try {
    // 1. Fetch fresh batch from EdStem
    const data = await edstemFetch(`/courses/${courseId}/threads?limit=${limit}&sort=new`);
    const freshBatch = (data.threads || []).map(t => ({
      id: t.id,
      number: t.number,
      title: t.title,
      type: t.type,
      category: t.category,
      subcategory: t.subcategory,
      user_name: t.user?.name,
      created_at: t.created_at,
      updated_at: t.updated_at,
      is_answered: t.is_answered,
      vote_count: t.vote_count,
      reply_count: t.reply_count,
    }));

    // 2. Upsert into historical cache transparently
    const mergedThreads = cacheManager.mergeAndSaveEdThreads(courseId, freshBatch);

    res.json({
      success: true,
      platform: 'Ed Discussion',
      category: 'Threads',
      recordCount: mergedThreads.length,
      freshBatchCount: freshBatch.length,
      data: mergedThreads,
      fields: ['id', 'number', 'title', 'type', 'category', 'subcategory', 'user_name', 'created_at', 'updated_at', 'is_answered', 'vote_count', 'reply_count'],
      sourceUrl: `${EDSTEM_BASE}/courses/${courseId}/threads`,
    });
  } catch (err) {
    // Fallback gracefully to local cached threads if offline / API error
    const cached = cacheManager.getEdThreadsCache(courseId);
    if (cached.length > 0) {
      return res.json({
        success: true,
        platform: 'Ed Discussion',
        category: 'Threads (Offline Cache)',
        recordCount: cached.length,
        fromCache: true,
        data: cached,
        notice: `Served from offline cache (${err.message})`,
      });
    }
    res.json({ success: false, platform: 'Ed Discussion', error: err.message });
  }
});

// Fetch a single thread with content (with transparent detail caching)
app.get('/api/edstem/threads/:id', async (req, res) => {
  const threadId = req.params.id;
  try {
    const data = await edstemFetch(`/threads/${threadId}`);
    const thread = data.thread || data;

    // Cache thread detail silently
    cacheManager.saveEdThreadDetailCache(threadId, thread);

    res.json({
      success: true,
      platform: 'Ed Discussion',
      category: 'Thread Detail',
      recordCount: 1,
      fromCache: false,
      data: [thread],
      fields: Object.keys(thread),
      sourceUrl: `${EDSTEM_BASE}/threads/${threadId}`,
    });
  } catch (err) {
    const cached = cacheManager.getEdThreadDetailCache(threadId);
    if (cached && cached.data) {
      return res.json({
        success: true,
        platform: 'Ed Discussion',
        category: 'Thread Detail (Cache)',
        recordCount: 1,
        fromCache: true,
        data: [cached.data],
        cachedAt: cached.cachedAt,
        notice: 'Served from offline cache',
      });
    }
    res.json({ success: false, platform: 'Ed Discussion', error: err.message });
  }
});

// Fetch resource center files for a course
app.get('/api/edstem/courses/:id/resources', async (req, res) => {
  try {
    const data = await edstemFetch(`/courses/${req.params.id}/resources`);
    res.json({
      success: true,
      platform: 'Ed Discussion',
      category: 'Resource Center',
      recordCount: (data.resources || []).length,
      data: data.resources || [],
      sourceUrl: `${EDSTEM_BASE}/courses/${req.params.id}/resources`,
    });
  } catch (err) {
    res.json({ success: false, platform: 'Ed Discussion', error: err.message });
  }
});

// Fetch latest 30 threads across enrolled EdStem courses
app.get('/api/edstem/recent-threads', async (req, res) => {
  const limit = parseInt(req.query.limit) || 30;
  try {
    const userData = await edstemFetch('/user');
    const courses = userData.courses || [];
    const allThreads = [];

    for (const c of courses) {
      const cObj = c.course || c;
      try {
        const tData = await edstemFetch(`/courses/${cObj.id}/threads?limit=30&sort=new`);
        const threads = tData.threads || [];
        for (const t of threads) {
          allThreads.push({
            courseId: cObj.id,
            courseCode: cObj.code || cObj.name,
            courseName: cObj.name,
            id: t.id,
            number: t.number,
            title: t.title,
            type: t.type,
            category: t.category,
            subcategory: t.subcategory,
            document: t.document || '',
            content: t.content || '',
            user_name: t.user?.name || 'Anonymous',
            created_at: t.created_at,
            updated_at: t.updated_at,
            is_answered: t.is_answered,
            vote_count: t.vote_count,
            reply_count: t.reply_count,
            url: `https://us.edstem.org/courses/${cObj.id}/discussion/${t.id}`,
          });
        }
      } catch {}
    }

    // Sort descending by created_at / updated_at
    allThreads.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    const recent = allThreads.slice(0, limit);

    res.json({
      success: true,
      platform: 'Ed Discussion',
      category: 'Recent Threads',
      count: recent.length,
      data: recent,
      sourceUrl: `${EDSTEM_BASE}/courses`,
    });
  } catch (err) {
    res.json({ success: false, platform: 'Ed Discussion', error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GRADESCOPE
// ═══════════════════════════════════════════════════════════════════════════════

let gradescopeCookies = null;

function getGradescopeCookies() {
  if (gradescopeCookies) return gradescopeCookies;
  if (process.env.GRADESCOPE_COOKIE) return process.env.GRADESCOPE_COOKIE;
  if (process.env.GRADESCOPE_SESSION || process.env.GRADESCOPE_SIGNED) {
    const parts = [];
    if (process.env.GRADESCOPE_SIGNED) parts.push(`signed_token=${process.env.GRADESCOPE_SIGNED}`);
    if (process.env.GRADESCOPE_SESSION) parts.push(`_gradescope_session=${process.env.GRADESCOPE_SESSION}`);
    return parts.join('; ');
  }
  return null;
}

async function gradescopeLogin() {
  const email = process.env.GRADESCOPE_EMAIL;
  const password = process.env.GRADESCOPE_PASSWORD;
  if (!email || !password) throw new Error('Gradescope requires either GRADESCOPE_COOKIE / GRADESCOPE_SESSION / GRADESCOPE_SIGNED or GRADESCOPE_EMAIL and GRADESCOPE_PASSWORD in .env');

  // Step 1: Get CSRF token from login page
  const loginPageRes = await fetch('https://www.gradescope.com/login', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    redirect: 'manual',
  });
  const loginPageHtml = await loginPageRes.text();
  const csrfMatch = loginPageHtml.match(/name="authenticity_token"\s+value="([^"]+)"/);
  if (!csrfMatch) throw new Error('Could not find CSRF token on Gradescope login page. Gradescope may require SSO or Cloudflare protection is active.');

  const csrfToken = csrfMatch[1];
  const setCookies = loginPageRes.headers.raw()['set-cookie'] || [];
  const cookieStr = setCookies.map(c => c.split(';')[0]).join('; ');

  // Step 2: POST login
  const loginRes = await fetch('https://www.gradescope.com/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      Cookie: cookieStr,
      Referer: 'https://www.gradescope.com/login',
    },
    body: new URLSearchParams({
      'utf8': '✓',
      'authenticity_token': csrfToken,
      'session[email]': email,
      'session[password]': password,
      'session[remember_me]': '0',
      'commit': 'Log In',
    }).toString(),
    redirect: 'manual',
  });

  // Collect cookies from login response
  const loginCookies = loginRes.headers.raw()['set-cookie'] || [];
  const allCookies = [...setCookies, ...loginCookies].map(c => c.split(';')[0]).join('; ');

  // Check if login succeeded (302 redirect to dashboard)
  if (loginRes.status !== 302 && loginRes.status !== 200) {
    throw new Error(`Gradescope login failed with status ${loginRes.status}. Check email/password. If you use school SSO, you may need to create a Gradescope-native password via "Forgot Password".`);
  }

  const location = loginRes.headers.get('location');
  if (location && location.includes('login')) {
    throw new Error('Gradescope login failed: redirected back to login page. Credentials may be incorrect or SSO-only account.');
  }

  gradescopeCookies = allCookies;
  return allCookies;
}

async function gradescopeFetch(endpoint) {
  let cookies = getGradescopeCookies();
  if (!cookies) {
    cookies = await gradescopeLogin();
  }
  const url = `https://www.gradescope.com${endpoint}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Cookie: cookies,
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) {
    throw new Error(`Gradescope request failed with status ${res.status}`);
  }
  return res.text();
}

// Test connection
app.get('/api/gradescope/test', async (req, res) => {
  try {
    const html = await gradescopeFetch('/');
    // Check if we're logged in by looking for dashboard content
    const loggedIn = html.includes('courseList') || html.includes('Your Courses') || html.includes('Dashboard') || !html.includes('Log In');
    if (!loggedIn) {
      gradescopeCookies = null;
      throw new Error('Session appears invalid — the page looks like the login page, not the dashboard.');
    }
    res.json({
      success: true,
      platform: 'Gradescope',
      category: 'Connection Test',
      recordCount: 0,
      data: [{ status: 'Authenticated', note: 'Session cookies active' }],
      fields: ['status', 'note'],
      sourceUrl: 'https://www.gradescope.com/',
    });
  } catch (err) {
    res.json({ success: false, platform: 'Gradescope', error: err.message });
  }
});

// Fetch courses by parsing the dashboard HTML
app.get('/api/gradescope/courses', async (req, res) => {
  try {
    const html = await gradescopeFetch('/');

    // Parse course list from dashboard HTML
    // Gradescope renders courses in a structured way
    const courses = [];
    const courseRegex = /href="\/courses\/(\d+)"[^>]*>[\s\S]*?class="courseBox--shortname"[^>]*>([^<]*)<[\s\S]*?class="courseBox--name"[^>]*>([^<]*)</g;
    let match;
    while ((match = courseRegex.exec(html)) !== null) {
      courses.push({
        id: match[1],
        shortname: match[2].trim(),
        name: match[3].trim(),
      });
    }

    // Fallback: try to find courses from a simpler pattern
    if (courses.length === 0) {
      const simpleCourseRegex = /href="\/courses\/(\d+)"[^>]*>\s*([^<]+)/g;
      while ((match = simpleCourseRegex.exec(html)) !== null) {
        const name = match[2].trim();
        if (name && !name.includes('{') && name.length > 2) {
          courses.push({ id: match[1], name });
        }
      }
    }

    res.json({
      success: true,
      platform: 'Gradescope',
      category: 'Courses',
      recordCount: courses.length,
      data: courses,
      fields: courses.length > 0 ? Object.keys(courses[0]) : [],
      sourceUrl: 'https://www.gradescope.com/',
      note: courses.length === 0
        ? 'No courses found. The HTML parser may need updating, or there are no courses on this account.'
        : undefined,
    });
  } catch (err) {
    res.json({ success: false, platform: 'Gradescope', error: err.message });
  }
});

function parseGradescopeAssignments(html, courseId) {
  const assignments = [];
  const seen = new Set();

  // Find all table rows
  const rowRegex = /<tr[^>]*role="row"[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    const idMatch = rowHtml.match(/assignments\/(\d+)/) || rowHtml.match(/data-assignment-id="(\d+)"/);
    if (!idMatch) continue;
    const id = idMatch[1];
    if (seen.has(id)) continue;
    seen.add(id);

    let name = '';
    const thMatch = rowHtml.match(/<th[^>]*class="[^"]*table--primaryLink[^"]*"[^>]*>([\s\S]*?)<\/th>/i);
    if (thMatch) {
      name = thMatch[1].replace(/<[^>]+>/g, '').trim();
    } else {
      const aMatch = rowHtml.match(/<a[^>]*>([^<]+)<\/a>/i);
      name = aMatch ? aMatch[1].trim() : `Assignment ${id}`;
    }

    const tds = [];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let tdMatch;
    while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
      tds.push(tdMatch[1].replace(/<[^>]+>/g, '').trim());
    }

    // Status text (e.g., "No Submission", "Submitted", "100.0 / 100.0")
    let status = '';
    const statusTextMatch = rowHtml.match(/class="[^"]*submissionStatus--text[^"]*"[^>]*>([^<]+)<\/div>/i);
    if (statusTextMatch) {
      status = statusTextMatch[1].trim();
    } else if (tds[0]) {
      status = tds[0];
    }

    // Time remaining (e.g., "6 days, 22 hours left", "1 day, 22 hours left")
    const timeRemainingMatch = rowHtml.match(/class="[^"]*submissionTimeChart--timeRemaining[^"]*"[^>]*>([^<]+)<\/span>/i);
    const timeRemaining = timeRemainingMatch ? timeRemainingMatch[1].trim() : '';

    // Due date (e.g., "Oct 21 at 11:59PM") & ISO datetime
    const dueTimeMatch = rowHtml.match(/aria-label="Due at [^"]*"[^>]*datetime="([^"]+)"/i)
      || rowHtml.match(/class="[^"]*submissionTimeChart--dueDate[^"]*"[^>]*datetime="([^"]+)"/i);
    const dueDatetime = dueTimeMatch ? dueTimeMatch[1].trim() : null;
    const dueTimestamp = dueDatetime ? new Date(dueDatetime).getTime() : 0;

    const dueMatch = rowHtml.match(/aria-label="Due at [^"]*"[^>]*>([^<]+)<\/time>/i);
    const dueDate = dueMatch ? dueMatch[1].trim() : (tds[2] || '');

    // Late due date (e.g., "Oct 22 at 11:59PM")
    const lateMatch = rowHtml.match(/aria-label="Late Due Date at [^"]*"[^>]*>([^<]+)<\/time>/i);
    let lateDueDate = lateMatch ? lateMatch[1].trim().replace(/^Late Due Date:\s*/i, '') : null;

    // Release date (e.g., "Oct 13 at  5:00PM")
    const releaseMatch = rowHtml.match(/class="[^"]*submissionTimeChart--releaseDate[^"]*"[^>]*>([^<]+)<\/time>/i);
    const releaseDate = releaseMatch ? releaseMatch[1].trim() : null;

    const subMatch = rowHtml.match(/href="(\/courses\/\d+\/assignments\/\d+\/submissions\/\d+)"/);
    const submissionUrl = subMatch ? `https://www.gradescope.com${subMatch[1]}` : null;

    assignments.push({
      id,
      name,
      status: status || 'Available',
      timeRemaining,
      dueDate,
      dueDatetime,
      dueTimestamp,
      lateDueDate,
      releaseDate,
      score: tds[1] || 'N/A',
      submissionUrl,
      assignmentUrl: `https://www.gradescope.com/courses/${courseId}/assignments/${id}`,
    });
  }

  // Fallback if no table rows matched
  if (assignments.length === 0) {
    const linkRegex = /href="\/courses\/\d+\/assignments\/(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const id = match[1];
      const name = match[2].replace(/<[^>]+>/g, '').trim();
      if (id && name && !seen.has(id) && !name.includes('{') && name.length > 1) {
        seen.add(id);
        assignments.push({
          id,
          name,
          status: 'Available',
          assignmentUrl: `https://www.gradescope.com/courses/${courseId}/assignments/${id}`,
        });
      }
    }
  }

  return assignments;
}

// Fetch assignments for a course
app.get('/api/gradescope/courses/:id/assignments', async (req, res) => {
  try {
    const html = await gradescopeFetch(`/courses/${req.params.id}`);
    const assignments = parseGradescopeAssignments(html, req.params.id);

    res.json({
      success: true,
      platform: 'Gradescope',
      category: 'Assignments',
      courseId: req.params.id,
      recordCount: assignments.length,
      data: assignments,
      fields: assignments.length > 0 ? Object.keys(assignments[0]) : [],
      sourceUrl: `https://www.gradescope.com/courses/${req.params.id}`,
    });
  } catch (err) {
    res.json({ success: false, platform: 'Gradescope', error: err.message });
  }
});

// Fetch all assignments across all courses
app.get('/api/gradescope/all-assignments', async (req, res) => {
  try {
    const html = await gradescopeFetch('/');
    const courses = [];
    const courseRegex = /href="\/courses\/(\d+)"[^>]*>[\s\S]*?class="courseBox--shortname"[^>]*>([^<]*)<[\s\S]*?class="courseBox--name"[^>]*>([^<]*)</g;
    let match;
    while ((match = courseRegex.exec(html)) !== null) {
      courses.push({
        id: match[1],
        code: match[2].trim(),
        name: match[3].trim(),
      });
    }

    const coursesWithAssignments = [];
    for (const c of courses) {
      try {
        const cHtml = await gradescopeFetch(`/courses/${c.id}`);
        const assignments = parseGradescopeAssignments(cHtml, c.id);
        coursesWithAssignments.push({
          courseId: c.id,
          code: c.code,
          name: c.name,
          assignmentCount: assignments.length,
          assignments,
        });
      } catch (err) {
        coursesWithAssignments.push({
          courseId: c.id,
          code: c.code,
          name: c.name,
          error: err.message,
          assignments: [],
        });
      }
    }

    const total = coursesWithAssignments.reduce((sum, c) => sum + (c.assignments?.length || 0), 0);

    res.json({
      success: true,
      platform: 'Gradescope',
      category: 'All Course Assignments',
      courseCount: courses.length,
      totalAssignments: total,
      data: coursesWithAssignments,
      sourceUrl: 'https://www.gradescope.com/',
    });
  } catch (err) {
    res.json({ success: false, platform: 'Gradescope', error: err.message });
  }
});

// Fetch all pending (unsubmitted) assignments across all Gradescope courses
app.get('/api/gradescope/pending', async (req, res) => {
  try {
    const html = await gradescopeFetch('/');
    const courses = [];
    const courseRegex = /href="\/courses\/(\d+)"[^>]*>[\s\S]*?class="courseBox--shortname"[^>]*>([^<]*)<[\s\S]*?class="courseBox--name"[^>]*>([^<]*)</g;
    let match;
    while ((match = courseRegex.exec(html)) !== null) {
      courses.push({
        id: match[1],
        code: match[2].trim(),
        name: match[3].trim(),
      });
    }

    const pending = [];
    for (const c of courses) {
      try {
        const cHtml = await gradescopeFetch(`/courses/${c.id}`);
        const assignments = parseGradescopeAssignments(cHtml, c.id);
        for (const a of assignments) {
          // STRICT RULE: Only keep assignments where status is literally 'No Submission'
          const rawStatus = (a.status || '').trim();
          if (rawStatus.toLowerCase() !== 'no submission') continue;
          if (a.submissionUrl) continue;

          pending.push({
            courseId: c.id,
            courseCode: c.code,
            courseName: c.name,
            id: a.id,
            name: a.name,
            status: 'Not Submitted',
            rawStatus: a.status,
            timeLeft: a.timeRemaining || 'Upcoming',
            dueDate: a.dueDate || 'See Gradescope',
            dueDatetime: a.dueDatetime || null,
            dueTimestamp: a.dueTimestamp || 0,
            lateDueDate: a.lateDueDate || null,
            assignmentUrl: a.assignmentUrl,
          });
        }
      } catch {}
    }

    res.json({
      success: true,
      platform: 'Gradescope',
      category: 'Pending Assignments',
      count: pending.length,
      data: pending,
      sourceUrl: 'https://www.gradescope.com/',
    });
  } catch (err) {
    res.json({ success: false, platform: 'Gradescope', error: err.message });
  }
});

// ─── Cookie-based auth (alternative: paste cookies from browser) ─────────────
app.post('/api/gradescope/set-cookies', (req, res) => {
  const { cookies } = req.body;
  if (!cookies) {
    return res.json({ success: false, error: 'No cookies provided' });
  }
  gradescopeCookies = cookies;

  // Persist to .env file so it survives server restarts
  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      let envContent = fs.readFileSync(envPath, 'utf8');
      if (envContent.includes('GRADESCOPE_COOKIE=')) {
        envContent = envContent.replace(/GRADESCOPE_COOKIE=.*(\r?\n|$)/, `GRADESCOPE_COOKIE="${cookies.replace(/"/g, '\\"')}"\n`);
      } else {
        envContent += `\nGRADESCOPE_COOKIE="${cookies.replace(/"/g, '\\"')}"\n`;
      }
      fs.writeFileSync(envPath, envContent, 'utf8');
    }
  } catch (err) {
    console.error('Could not persist cookie to .env:', err.message);
  }

  res.json({ success: true, message: 'Gradescope cookies set and saved to .env. Try testing the connection now.' });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  UNIFIED AGENT API — "WHAT ARE MY TASKS FOR TODAY?"
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/agent/today', async (req, res) => {
  const agenda = {
    generatedAt: new Date().toISOString(),
    upcomingDeadlines: [],
    recentAnnouncements: [],
  };

  // 1. Fetch Gradescope assignments
  if (getGradescopeCookies() || (process.env.GRADESCOPE_EMAIL && process.env.GRADESCOPE_PASSWORD)) {
    try {
      const html = await gradescopeFetch('/');
      const courses = [];
      const courseRegex = /href="\/courses\/(\d+)"[^>]*>[\s\S]*?class="courseBox--shortname"[^>]*>([^<]*)<[\s\S]*?class="courseBox--name"[^>]*>([^<]*)</g;
      let match;
      while ((match = courseRegex.exec(html)) !== null) {
        courses.push({ id: match[1], code: match[2].trim(), name: match[3].trim() });
      }

      for (const c of courses) {
        try {
          const cHtml = await gradescopeFetch(`/courses/${c.id}`);
          const assignments = parseGradescopeAssignments(cHtml, c.id);
          for (const a of assignments) {
            agenda.upcomingDeadlines.push({
              platform: 'Gradescope',
              courseCode: c.code,
              courseName: c.name,
              assignmentName: a.name,
              status: a.status,
              score: a.score,
              dueDate: a.dueDate,
              url: a.assignmentUrl,
            });
          }
        } catch {}
      }
    } catch (err) {
      agenda.gradescopeError = err.message;
    }
  }

  // 2. Fetch Canvas active assignments
  if (CANVAS_TOKEN) {
    try {
      const courses = await canvasFetch('/courses?enrollment_state=active');
      for (const c of courses) {
        try {
          const assignments = await canvasFetch(`/courses/${c.id}/assignments?per_page=10&order_by=due_at`);
          for (const a of assignments) {
            if (a.due_at) {
              agenda.upcomingDeadlines.push({
                platform: 'Canvas LMS',
                courseCode: c.course_code || c.name,
                courseName: c.name,
                assignmentName: a.name,
                status: a.has_submitted_submissions ? 'Submitted' : 'Pending',
                score: a.points_possible ? `${a.points_possible} pts` : 'N/A',
                dueDate: a.due_at,
                url: a.html_url,
              });
            }
          }
        } catch {}
      }
    } catch (err) {
      agenda.canvasError = err.message;
    }
  }

  // 3. Fetch latest EdStem announcements
  if (EDSTEM_TOKEN) {
    try {
      const uData = await edstemFetch('/user');
      const courses = uData.courses || [];
      for (const c of courses) {
        const cObj = c.course || c;
        try {
          const tData = await edstemFetch(`/courses/${cObj.id}/threads?limit=10&sort=new`);
          const threads = (tData.threads || []).filter(t => t.type === 'announcement' || t.is_pinned);
          for (const t of threads) {
            agenda.recentAnnouncements.push({
              platform: 'Ed Discussion',
              courseCode: cObj.code,
              courseName: cObj.name,
              title: t.title,
              author: t.user?.name || 'Instructor',
              createdAt: t.created_at,
              url: `https://us.edstem.org/courses/${cObj.id}/discussion/${t.id}`,
            });
          }
        } catch {}
      }
    } catch (err) {
      agenda.edstemError = err.message;
    }
  }

  res.json({ success: true, agenda });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  DYNAMIC OUTPUT MANAGEMENT (output/<CourseName>/<Category>/<file>)
// ═══════════════════════════════════════════════════════════════════════════════

// Inspect dynamic output tree
app.get('/api/output/tree', (req, res) => {
  try {
    const tree = outputManager.getOutputTree();
    res.json({ success: true, ...tree });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Save any arbitrary output dynamically to output/<course>/<category>/<filename>
app.post('/api/output/save', (req, res) => {
  try {
    const { course, category, filename, content } = req.body;
    if (!filename || content === undefined) {
      return res.status(400).json({ success: false, error: 'filename and content are required' });
    }
    const result = outputManager.saveOutput({ course, category, filename, content });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Read a specific file from output/
app.get('/api/output/file', (req, res) => {
  try {
    const relPath = req.query.path;
    if (!relPath) return res.status(400).json({ success: false, error: 'path parameter required' });

    const safePath = path.resolve(__dirname, relPath);
    if (!safePath.startsWith(outputManager.OUTPUT_ROOT)) {
      return res.status(403).json({ success: false, error: 'Access denied: Path outside output folder' });
    }
    if (!fs.existsSync(safePath)) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    const content = fs.readFileSync(safePath, 'utf8');
    res.json({ success: true, path: relPath, content });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Export all assignments (Canvas + Gradescope) directly to output/<course>/assignments/
app.post('/api/output/export-all-assignments', async (req, res) => {
  try {
    const exports = [];

    // 1. Gradescope assignments
    if (getGradescopeCookies()) {
      try {
        const html = await gradescopeFetch('/');
        const courses = [];
        const courseRegex = /href="\/courses\/(\d+)"[^>]*>[\s\S]*?class="courseBox--shortname"[^>]*>([^<]*)<[\s\S]*?class="courseBox--name"[^>]*>([^<]*)</g;
        let match;
        while ((match = courseRegex.exec(html)) !== null) {
          courses.push({ id: match[1], code: match[2].trim(), name: match[3].trim() });
        }
        for (const c of courses) {
          try {
            const cHtml = await gradescopeFetch(`/courses/${c.id}`);
            const list = parseGradescopeAssignments(cHtml, c.id);
            const courseName = c.code || c.name;
            const mdLines = [
              `# Assignments & Deadlines: ${courseName}`,
              `**Source:** Gradescope`,
              `**Total Assignments:** ${list.length}`,
              `**Exported At:** ${new Date().toISOString()}`,
              ``,
              `| Title | Status | Score | Due Date |`,
              `| :--- | :--- | :--- | :--- |`,
            ];
            for (const a of list) {
              mdLines.push(`| ${a.name} | ${a.status} | ${a.score || '—'} | ${a.dueDate || '—'} |`);
            }
            const saved = outputManager.saveOutput({
              course: courseName,
              category: 'assignments',
              filename: 'gradescope_assignments.md',
              content: mdLines.join('\n'),
            });
            outputManager.saveOutput({
              course: courseName,
              category: 'assignments',
              filename: 'gradescope_assignments.json',
              content: list,
            });
            exports.push(saved);
          } catch {}
        }
      } catch (err) {
        console.warn('[Output] Gradescope export error:', err.message);
      }
    }

    // 2. Canvas assignments
    if (CANVAS_TOKEN) {
      try {
        const courses = await canvasFetch('/courses?enrollment_state=active');
        for (const c of courses) {
          try {
            const assignments = await canvasFetch(`/courses/${c.id}/assignments?order_by=due_at`);
            const courseName = c.name || c.course_code || `Course_${c.id}`;
            const mdLines = [
              `# Canvas Assignments: ${courseName}`,
              `**Course ID:** ${c.id}`,
              `**Total Assignments:** ${assignments.length}`,
              `**Exported At:** ${new Date().toISOString()}`,
              ``,
              `| Title | Points | Due At | Submission Types |`,
              `| :--- | :--- | :--- | :--- |`,
            ];
            for (const a of assignments) {
              mdLines.push(`| ${a.name} | ${a.points_possible ?? '—'} | ${a.due_at || 'No due date'} | ${(a.submission_types || []).join(', ')} |`);
            }
            const saved = outputManager.saveOutput({
              course: courseName,
              category: 'assignments',
              filename: 'canvas_assignments.md',
              content: mdLines.join('\n'),
            });
            outputManager.saveOutput({
              course: courseName,
              category: 'assignments',
              filename: 'canvas_assignments.json',
              content: assignments,
            });
            exports.push(saved);
          } catch {}
        }
      } catch (err) {
        console.warn('[Output] Canvas export error:', err.message);
      }
    }

    res.json({
      success: true,
      message: `Exported assignments across ${exports.length} course targets to output/`,
      exports,
      tree: outputManager.getOutputTree(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  START SERVER (Secure Loopback Binding)
// ═══════════════════════════════════════════════════════════════════════════════

app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  🎓 Academic Platform Integration Hub (All3)`);
  console.log(`  ────────────────────────────────────────────────`);
  console.log(`  Server bound securely to http://127.0.0.1:${PORT} (localhost loopback only)\n`);
  console.log(`  Platform Configuration:`);
  console.log(`    Canvas:     ${CANVAS_TOKEN ? '✅ Token configured' : '❌ Missing CANVAS_API_TOKEN'}`);
  console.log(`    EdStem:     ${EDSTEM_TOKEN ? '✅ Token configured' : '❌ Missing EDSTEM_API_TOKEN'}`);
  console.log(`    Gradescope: ${getGradescopeCookies() ? '✅ Cookies configured' : '❌ Missing session cookies'}`);
  console.log(`\n  Security: Network loopback active. Only local machine & extension permitted.\n`);
});
