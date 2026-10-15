/**
 * All3 Dynamic Output Manager
 * 
 * Manages the user-facing "output/" directory.
 * - Dynamically creates folders named after courses (e.g., "CS 260P - Algorithms").
 * - Dynamically creates sub-structures (lectures, assignments, discussions, notes).
 * - Saves markdown notes, parsed lecture slides, assignment specs, and discussion digests.
 * - Provides a file-tree reader for the dashboard and agent.
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_ROOT = path.join(__dirname, 'output');

// Known course mappings for clean folder names (fallback to API title or ID)
const KNOWN_COURSES = {
  // Canvas IDs
  '86792': 'CS 260P - Algorithms',
  '86829': 'CS 262P - Text Processing',
  '85388': 'CS 253P - Advanced System Design',
  // EdStem IDs
  '106990': 'CS 260P - Algorithms',
  '107080': 'CS 253P - Advanced System Design',
  '107115': 'CS 271P - Artificial Intelligence',
  // Gradescope IDs
  '1409726': 'CS 260P - Algorithms',
  '1417907': 'CS 262P - Text Processing',
  '1374750': 'CS 253P - Advanced System Design',
  '1415691': 'CS 271P - Artificial Intelligence',
};

// Ensure root output directory exists
function ensureOutputRoot() {
  try {
    if (!fs.existsSync(OUTPUT_ROOT)) {
      fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
    }
  } catch (err) {
    console.warn('[OutputManager] Failed to create output root:', err.message);
  }
}
ensureOutputRoot();

/**
 * Sanitize a course identifier into a clean filesystem folder name
 */
function resolveCourseFolderName(courseIdentifier) {
  if (!courseIdentifier) return 'General';

  const str = String(courseIdentifier).trim();

  // Check known map
  if (KNOWN_COURSES[str]) return KNOWN_COURSES[str];

  // If already formatted like "CS 260P - Algorithms", just sanitize illegal chars
  return str
    .replace(/[<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'General';
}

/**
 * Sanitize filename
 */
function sanitizeFileName(name) {
  return String(name || 'output.txt')
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/\s+/g, '_');
}

/**
 * Save an output file into output/<CourseName>/<category>/<filename>
 */
function saveOutput({ course, category = 'notes', filename, content }) {
  ensureOutputRoot();

  const courseFolder = resolveCourseFolderName(course);
  const cleanCategory = String(category || 'general').replace(/[^a-zA-Z0-9_-]/g, '_');
  const cleanFilename = sanitizeFileName(filename);

  const targetDir = path.join(OUTPUT_ROOT, courseFolder, cleanCategory);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const filePath = path.join(targetDir, cleanFilename);
  const data = typeof content === 'string' ? content : JSON.stringify(content, null, 2);

  fs.writeFileSync(filePath, data, 'utf8');

  return {
    success: true,
    course: courseFolder,
    category: cleanCategory,
    filename: cleanFilename,
    relativePath: path.relative(__dirname, filePath),
    fullPath: filePath,
    bytes: Buffer.byteLength(data, 'utf8'),
    savedAt: new Date().toISOString(),
  };
}

/**
 * Recursively read directory tree of output/
 */
function getOutputTree() {
  ensureOutputRoot();

  function scanDir(dirPath) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const result = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // ignore hidden files
      const full = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        result.push({
          type: 'directory',
          name: entry.name,
          children: scanDir(full),
        });
      } else {
        const stats = fs.statSync(full);
        result.push({
          type: 'file',
          name: entry.name,
          size: stats.size,
          updatedAt: stats.mtime.toISOString(),
          relativePath: path.relative(__dirname, full),
        });
      }
    }
    return result;
  }

  try {
    return {
      root: 'output',
      structure: scanDir(OUTPUT_ROOT),
    };
  } catch (err) {
    return { root: 'output', structure: [], error: err.message };
  }
}

module.exports = {
  OUTPUT_ROOT,
  resolveCourseFolderName,
  saveOutput,
  getOutputTree,
};
