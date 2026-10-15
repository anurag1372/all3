/**
 * All3 System Cache Manager
 * 
 * Transparent, self-healing caching layer for:
 * 1. Canvas course files & extracted PDF text (saves re-downloading and re-parsing).
 * 2. Ed Discussion threads (accumulates historical threads, upserting recent changes).
 * 
 * Principles:
 * - Never counterfire: file errors are caught silently, never crashing requests.
 * - Zero maintenance: users never need to interact with or clean the cache.
 * - Always fresh: checks live API, falls back gracefully to cache if offline.
 */

const fs = require('fs');
const path = require('path');

const CACHE_ROOT = path.join(__dirname, 'cache');
const CANVAS_CACHE = path.join(CACHE_ROOT, 'canvas');
const EDSTEM_CACHE = path.join(CACHE_ROOT, 'edstem');

// Ensure root directories exist safely
function ensureDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  } catch (err) {
    console.warn(`[Cache] Warning: Could not create dir ${dirPath}:`, err.message);
  }
}

// Initialize on startup
ensureDir(CANVAS_CACHE);
ensureDir(EDSTEM_CACHE);

// ─────────────────────────────────────────────────────────────────────────────
// Canvas File Cache
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retrieve cached parsed file text if present and size matches
 */
function getCanvasFileCache(courseId, fileId, expectedSize = null) {
  try {
    const filePath = path.join(CANVAS_CACHE, String(courseId), 'files', `${fileId}.json`);
    if (!fs.existsSync(filePath)) return null;

    const raw = fs.readFileSync(filePath, 'utf8');
    const cached = JSON.parse(raw);

    // If expectedSize is provided and doesn't match, cache is stale
    if (expectedSize !== null && cached.size && cached.size !== expectedSize) {
      return null;
    }

    return cached;
  } catch (err) {
    return null;
  }
}

/**
 * Persist parsed Canvas file text to cache
 */
function saveCanvasFileCache(courseId, fileId, fileData) {
  try {
    const dir = path.join(CANVAS_CACHE, String(courseId), 'files');
    ensureDir(dir);
    const targetFile = path.join(dir, `${fileId}.json`);
    const payload = {
      fileId,
      courseId,
      fileName: fileData.fileName,
      size: fileData.size,
      contentType: fileData.contentType,
      text: fileData.text,
      sourceUrl: fileData.sourceUrl,
      updatedAt: fileData.updatedAt || null,
      cachedAt: new Date().toISOString(),
    };
    fs.writeFileSync(targetFile, JSON.stringify(payload, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.warn(`[Cache] Failed to write Canvas cache for ${fileId}:`, err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ed Discussion Threads Cache (Accumulative & Upsert)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retrieve all historically accumulated threads for a course
 */
function getEdThreadsCache(courseId) {
  try {
    const targetFile = path.join(EDSTEM_CACHE, String(courseId), 'threads.json');
    if (!fs.existsSync(targetFile)) return [];
    const raw = fs.readFileSync(targetFile, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.threads) ? parsed.threads : [];
  } catch (err) {
    return [];
  }
}

/**
 * Merge newly fetched threads with historical threads in cache
 * Returns the complete merged list sorted by latest created/updated date.
 */
function mergeAndSaveEdThreads(courseId, freshThreads) {
  try {
    const courseDir = path.join(EDSTEM_CACHE, String(courseId));
    ensureDir(courseDir);
    const targetFile = path.join(courseDir, 'threads.json');

    // Load existing history
    const existing = getEdThreadsCache(courseId);
    const threadMap = new Map();

    // 1. Populate map with existing historical threads
    for (const t of existing) {
      if (t && t.id) threadMap.set(t.id, t);
    }

    // 2. Upsert fresh threads (overwrite existing with updated reply counts, votes, answers)
    for (const t of freshThreads) {
      if (t && t.id) {
        const prev = threadMap.get(t.id) || {};
        threadMap.set(t.id, { ...prev, ...t });
      }
    }

    // 3. Convert back to array & sort descending by creation date
    const merged = Array.from(threadMap.values()).sort((a, b) => {
      const timeA = new Date(a.created_at || a.updated_at || 0).getTime();
      const timeB = new Date(b.created_at || b.updated_at || 0).getTime();
      return timeB - timeA;
    });

    // 4. Save to disk atomically
    const payload = {
      courseId,
      totalCount: merged.length,
      lastSyncAt: new Date().toISOString(),
      threads: merged,
    };
    fs.writeFileSync(targetFile, JSON.stringify(payload, null, 2), 'utf8');

    return merged;
  } catch (err) {
    console.warn(`[Cache] Failed to update EdStem cache for course ${courseId}:`, err.message);
    return freshThreads; // Fallback to fresh threads seamlessly
  }
}

/**
 * Retrieve single thread detail cache
 */
function getEdThreadDetailCache(threadId) {
  try {
    const targetFile = path.join(EDSTEM_CACHE, 'threads', `${threadId}.json`);
    if (!fs.existsSync(targetFile)) return null;
    return JSON.parse(fs.readFileSync(targetFile, 'utf8'));
  } catch (err) {
    return null;
  }
}

/**
 * Save single thread detail cache
 */
function saveEdThreadDetailCache(threadId, threadData) {
  try {
    const dir = path.join(EDSTEM_CACHE, 'threads');
    ensureDir(dir);
    const targetFile = path.join(dir, `${threadId}.json`);
    fs.writeFileSync(targetFile, JSON.stringify({
      threadId,
      cachedAt: new Date().toISOString(),
      data: threadData,
    }, null, 2), 'utf8');
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = {
  CACHE_ROOT,
  getCanvasFileCache,
  saveCanvasFileCache,
  getEdThreadsCache,
  mergeAndSaveEdThreads,
  getEdThreadDetailCache,
  saveEdThreadDetailCache,
};
