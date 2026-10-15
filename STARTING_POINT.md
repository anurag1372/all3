# 🧭 System Architecture & Agent Operating Manual (`STARTING_POINT.md`)

> **Repository:** `all3` (Academic Platform Integration Engine)  
> **Primary Audience:** AI Agents (Antigravity, Cursor, Claude Code, Windsurf) and Engineers onboarding to this project.  
> **Core Objective:** Unified, real-time data ingestion, content extraction, and agentic context bridge across **Canvas LMS**, **Ed Discussion**, and **Gradescope**.

---

## 🤖 AI Agent Executive Briefing

If you are an AI assistant navigating this repository on behalf of a student, **read this section first**:

1. **What is this codebase?**  
   A local Node.js/Express loopback server (`127.0.0.1:3000`), a companion Manifest V3 Chrome Extension (`extension/`), and a dark-mode web dashboard (`public/`).
2. **What problem does it solve?**  
   University academic workflows are notoriously fragmented:
   - **Canvas LMS**: Syllabi, course modules, lecture slides (PDFs), lab manuals.
   - **Ed Discussion**: Dynamic Q&A, instructor announcements, TA answers, edge-case clarifications.
   - **Gradescope**: Project specifications, autograder tests, deadlines, and submission records.  
   Students constantly bounce between these three silos. `all3` unifies them into local JSON endpoints and structured markdown files in `output/` so that **you (the AI)** can directly access lecture text, track deadlines, search discussion clarifications, and help the student study.
3. **Where does data live?**
   - **Secrets**: `all3/.env` (Canvas token, EdStem token, Gradescope cookies). Never leak these in chat.
   - **Runtime Cache**: `all3/cache/` (parsed slide texts, historical thread archive). Managed automatically by [cache.js](file:///Users/anuragsingh/Desktop/all3/cache.js).
   - **Deliverables & Summaries**: `all3/output/<CourseName>/` (structured markdown course folders). Managed by [output.js](file:///Users/anuragsingh/Desktop/all3/output.js).
   - **Live API Gateway**: `http://127.0.0.1:3000/api/...` served by [server.js](file:///Users/anuragsingh/Desktop/all3/server.js).

---

## 🗺️ How the AI Agent Should Navigate & Answer Requests

When the user prompts you in the IDE, follow these routing patterns:

| User Intent | Best Action for the AI Agent |
| :--- | :--- |
| **"What assignments are due?"** or **"What do I have pending?"** | Query `GET http://127.0.0.1:3000/api/gradescope/pending` to get strictly unsubmitted tasks with `timeLeft` (e.g. `1 day, 22 hours left`), `dueDate`, and `lateDueDate`. Alternatively, inspect `output/<CourseName>/assignments/`. |
| **"What did the professor say about Quiz / HW?"** | Query `GET http://127.0.0.1:3000/api/edstem/recent-threads?limit=30` or `GET /api/edstem/courses/:id/threads`. Search the full post body (`document` property) and replies for instructor clarifications. |
| **"Explain [concept] from this week's slides"** | Check `output/<CourseName>/` for extracted slide markdown, or trigger `GET http://127.0.0.1:3000/api/canvas/courses/:courseId/files/:fileId/text` to download & parse slide text into memory. |
| **"Summarize / Create a study guide / Export data"** | Write deliverables to `output/<CourseName>/<category>/<filename>.md` directly or call `POST http://127.0.0.1:3000/api/output/save`. |
| **"Check server or sync health"** | Query `GET http://127.0.0.1:3000/api/health` to confirm if Canvas, EdStem, and Gradescope credentials are active. |

---

## 🏛️ System Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   CLIENT LAYER                                         │
│                                                                                        │
│   Web Dashboard (127.0.0.1:3000)          AI Agent / IDE Assistant (Terminal / Prompt) │
│   [Horizontal Navbar + Data Inspector]    [RAG Search, Task Planner, Code Assistant]   │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │ HTTP / JSON API (Loopback only)
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              APPLICATION SERVER (server.js)                            │
│                                                                                        │
│   ┌─────────────────────┐    ┌──────────────────────┐    ┌─────────────────────────┐   │
│   │   Express Router    │    │   Data Normalizer    │    │  PDF & Document Engine  │   │
│   │   & Health Monitors │    │   & Response Formatter│   │  (pdf-parse / binary)   │   │
│   └──────────┬──────────┘    └──────────┬───────────┘    └────────────┬────────────┘   │
└──────────────┼──────────────────────────┼─────────────────────────────┼────────────────┘
               │                          │                             │
               ▼                          ▼                             ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                PLATFORM ADAPTER LAYER                                  │
│                                                                                        │
│   ┌────────────────────────┐  ┌─────────────────────────┐  ┌───────────────────────┐   │
│   │    Canvas Adapter      │  │    EdStem Adapter       │  │  Gradescope Adapter   │   │
│   │  • Bearer Token Auth   │  │  • Bearer Token Auth    │  │  • Multi-Cookie Auth  │   │
│   │  • Module Item Traverser│ │  • Thread Feed Reader   │  │  • CSRF + Session     │   │
│   │  • Signed S3 Downloader│  │  • Resource Center Index│  │  • Table HTML Scraper │   │
│   └──────────┬─────────────┘  └──────────┬──────────────┘  └──────────┬────────────┘   │
└──────────────┼───────────────────────────┼────────────────────────────┼────────────────┘
               │                           │                            │
               ▼                           ▼                            ▼
┌───────────────────────────┐ ┌──────────────────────────┐ ┌─────────────────────────┐
│ Canvas (canvas.eee.uci.edu)│ │ EdStem (us.edstem.org)   │ │ Gradescope.com          │
└───────────────────────────┘ └──────────────────────────┘ └─────────────────────────┘
```

---

## 🔌 Platform Adapters & Protocols

### 1. Canvas LMS Adapter
* **Base URL**: `https://canvas.eee.uci.edu/api/v1` *(configurable for any institution)*
* **Authentication**: Personal Access Token via header `Authorization: Bearer <CANVAS_API_TOKEN>`.
* **Key Mechanisms**:
  * `GET /users/self/profile`: Verifies user identity and timezone.
  * `GET /courses?include[]=term&include[]=total_scores&enrollment_state=active`: Discovers enrolled courses.
  * `GET /courses/:id/assignments?order_by=due_at`: Retrieves assignment specifications, due dates, and grading types.
  * `GET /courses/:id/modules?include[]=items`: Traverses course module tree.
  * `GET /files/:id`: Obtains signed temporary Amazon S3 download URLs for lecture slides and lab PDFs.

### 2. Ed Discussion (EdStem) Adapter
* **Base URL**: `https://us.edstem.org/api`
* **Authentication**: User API token via header `Authorization: Bearer <EDSTEM_API_TOKEN>`.
* **Key Mechanisms**:
  * `GET /user`: Returns user profile and enrolled courses array (`{ course: { id, code, name, ... } }`).
  * `GET /courses/:id/threads?limit=30&sort=new`: Pulls freshest discussion threads with full plaintext post bodies (`document`), reply counts, and endorsement flags.
  * `GET /threads/:id`: Deep-fetches replies and instructor solutions.
  * `GET /courses/:id/resources`: Indexes all Resource Center course files and syllabus PDFs.

### 3. Gradescope Adapter
* **Base URL**: `https://www.gradescope.com`
* **Authentication**: Dual session cookies:
  * `_gradescope_session`: Active Rails session cookie.
  * `signed_token`: Persistent Remember-Me authentication cookie.
* **Key Mechanisms**:
  * Gradescope renders server-side Rails HTML without public REST APIs.
  * `GET /`: Scrapes enrolled course cards (`courseBox--shortname`, `courseBox--name`).
  * `GET /courses/:id`: Parses `<tr role="row">` assignment tables to extract:
    - Assignment title and primary link (`<th class="table--primaryLink">`)
    - Submission status (`<td class="submissionStatus">`)
    - Exact unsubmitted status: isolated when status is strictly `No Submission` and submission link is null
    - Unshortened time remaining extracted directly from `<span class="submissionTimeChart--timeRemaining">` (e.g., `6 days, 22 hours left` or `1 day, 22 hours left`)
    - Due dates and late deadlines (`<time class="submissionTimeChart--dueDate">`)
  * `POST /api/gradescope/set-cookies`: Receives live cookies from the Chrome Extension and auto-saves them to `.env`.

---

## 📑 PDF Ingestion & Text Extraction Pipeline

Rather than storing dead binary links, `all3` includes an automated document processor:

1. **Discovery**: Traverses Canvas modules and EdStem resource folders for `.pdf` assets.
2. **Streaming Download**: Fetches binary buffers directly into memory without cluttering disk.
3. **Parsing (`pdf-parse`)**:
   ```javascript
   const { PDFParse } = require('pdf-parse');
   const parser = new PDFParse(new Uint8Array(buffer));
   await parser.load();
   const text = await parser.getText();
   ```
4. **Transparent Caching**: Extracted plaintext is cached in `cache/canvas/<courseId>/files/<fileId>.json` keyed by file size. Subsequent queries load in ~2ms.
5. **Agent Consumption**: Converts multi-slide lecture presentations into structured text blocks for immediate AI synthesis.

---

## 📂 Repository File Map

```
all3/
├── STARTING_POINT.md      # THIS FILE: Master engineering & AI agent operating manual
├── README.md              # Public onboarding & setup guide for new developers
├── server.js              # Core Express server, API routers, Gradescope HTML scraper
├── cache.js               # Self-healing transparent cache manager (Canvas & EdStem)
├── output.js              # Dynamic course directory & markdown deliverable generator
├── package.json           # Manifest, dependencies, and npm run scripts
├── package-lock.json      # Locked dependency tree
├── .env.example           # Environment template with setup instructions
├── .env                   # (Git-ignored) Local secrets (tokens & session cookies)
├── .gitignore             # Shields node_modules, .env, cache/, output/ from git
│
├── extension/             # Manifest V3 Chrome Extension (Zero-click Gradescope sync)
│   ├── manifest.json      # MV3 permissions, host permissions, icons, background worker
│   ├── background.js      # Background cookie listener & auto-sync worker
│   ├── popup.html         # Modern dark popup UI with 50/50 status & GitHub split
│   ├── popup.js           # Popup trigger logic & connection health status
│   ├── icon.svg           # Master vector 3-layer icon
│   ├── icon16.png         # 16x16 Chrome toolbar icon
│   ├── icon48.png         # 48x48 Extension manager icon
│   └── icon128.png        # 128x128 High-DPI icon
│
├── public/                # Web Dashboard (Served on http://127.0.0.1:3000)
│   ├── index.html         # Horizontal navbar, platform cards, inspector, setup drawer
│   ├── styles.css         # Glassmorphism dark design system with vibrant sky-blue accents
│   ├── app.js             # Platform health poller, table renderer, drawer toggler
│   └── favicon.svg        # Matching 3-layer geometric SVG icon
│
├── cache/                 # (Runtime, Git-ignored) Cached raw JSON & parsed PDF texts
└── output/                # (Runtime, Git-ignored) Dynamic course markdown deliverables
```

---

## 🌐 Complete API Endpoint Reference (`server.js`)

All endpoints are hosted locally at `http://127.0.0.1:3000`:

### System & Health
* `GET /api/health` — Returns status of all three platform connections (`configured: true/false`).

### Canvas LMS
* `GET /api/canvas/test` — Verifies API token and returns student profile.
* `GET /api/canvas/courses` — Returns active courses with course IDs, codes, and terms.
* `GET /api/canvas/courses/:id/assignments` — Returns assignments, points, and deadlines.
* `GET /api/canvas/courses/:id/modules` — Returns course modules with all learning items.
* `GET /api/canvas/courses/:courseId/files/:fileId/text` — Returns extracted plaintext from a PDF lecture slide deck.

### Ed Discussion
* `GET /api/edstem/test` — Verifies token and returns authenticated student profile.
* `GET /api/edstem/courses` — Returns enrolled discussion spaces.
* `GET /api/edstem/recent-threads?limit=30` — Returns the top 30 most recent threads across all courses with complete post bodies (`document`), reply counts, and answer badges.
* `GET /api/edstem/courses/:id/threads` — Returns threads for a specific course, merging into the local historical cache.
* `GET /api/edstem/threads/:id` — Returns full thread content with instructor/TA replies.
* `GET /api/edstem/courses/:id/resources` — Returns indexed Resource Center files and PDFs.

### Gradescope
* `GET /api/gradescope/test` — Tests whether current session cookies authenticate with Gradescope.
* `GET /api/gradescope/courses` — Returns active courses crawled from dashboard HTML.
* `GET /api/gradescope/courses/:id/assignments` — Parses assignment table for a specific course.
* `GET /api/gradescope/pending` — **Crucial for Agent**: Returns strictly unsubmitted assignments (`No Submission`) with parsed timestamps, full `timeLeft` strings (e.g. `6 days, 22 hours left`), due dates, and direct submission links.
* `POST /api/gradescope/set-cookies` — Receives `{ cookies }` from the Chrome extension and persists them to `.env`.

### Output & Deliverables
* `GET /api/output/tree` — Returns the hierarchical folder tree of generated files in `output/`.
* `POST /api/output/save` — Accepts `{ course, category, filename, content }` and saves files safely.
* `GET /api/output/file?path=...` — Streams the content of a saved markdown or text file.
* `POST /api/output/export-all-assignments` — Scrapes all courses and generates structured `assignments.md` matrices in `output/`.

---

## 🔒 Security & Privacy Guarantees for the AI Agent

1. **Strict Loopback Binding (`127.0.0.1`)**: The server listens exclusively on loopback. It never binds to `0.0.0.0`. It cannot be reached across campus Wi-Fi.
2. **Origin & CORS Verification**: Rejects any request not originating from `127.0.0.1`, `localhost`, or the official Chrome Extension.
3. **Token Privacy**: Never print raw access tokens (`CANVAS_API_TOKEN`, `EDSTEM_API_TOKEN`) or cookie strings (`GRADESCOPE_COOKIE`) in user conversation responses.
4. **Git Safety**: Never stage or commit `.env`, `cache/`, or `output/` to git.
5. **Safe File Operations**: When saving files via `output.js`, path traversal attacks (`../`) are strictly blocked.

---

## 🛠️ Developer Commands

```bash
# Start server daemon
npm start

# Development mode with auto-reload
npm run dev

# Run server directly
node server.js
```

---

## 👤 Author
Developed by **Anurag Singh**  
GitHub: [@anurag1372](https://github.com/anurag1372/all3) • Repository: [all3](https://github.com/anurag1372/all3)
