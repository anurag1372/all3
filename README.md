# 🎓 All3 — Academic Platform Integration Hub

<div align="center">

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![Chrome Extension](https://img.shields.io/badge/Chrome_Extension-Manifest_v3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/)
[![Privacy](https://img.shields.io/badge/Privacy-100%25_Local_Loopback-8b5cf6?style=for-the-badge)](https://en.wikipedia.org/wiki/Localhost)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

**A unified, self-contained local loopback bridge connecting Canvas LMS, Ed Discussion, and Gradescope into a real-time student dashboard and AI agentic context engine.**

[Quickstart](#-quickstart-guide) •
[Platform Credentials](#-step-by-step-credential-setup) •
[Chrome Extension](#-gradescope-zero-click-chrome-extension) •
[AI & IDE Prompts](#-supercharging-your-ai-coding-assistant) •
[System Architecture](STARTING_POINT.md)

</div>

---

## 💡 Why All3?

University workflows are fragmented across three separate platforms:
* **Canvas LMS**: Official syllabus, course modules, lecture slides (PDFs), lab manuals.
* **Ed Discussion**: Dynamic Q&A, instructor announcements, TA answers, edge-case clarifications.
* **Gradescope**: Project specifications, autograder tests, deadlines, and submission records.

**All3** is **not just a bookmark launcher**. It acts as a local data engine that:
1. **Pulls Raw Content**: Extracts lecture slide PDF text, fetches complete Ed discussion post bodies, and parses exact Gradescope submission statuses.
2. **Zero-Click Gradescope Sync**: Seamless Chrome extension that auto-detects Gradescope session cookies and syncs them to your local server without manual DevTools copying.
3. **Local-First & Strictly Private**: Runs exclusively on `127.0.0.1:3000`. No telemetry, no third-party cloud servers, and credentials stay safely on your machine in `.env`.
4. **Feeds Your AI Assistant**: Provides organized markdown files (`output/`) and REST endpoints so your IDE assistant (Antigravity, Cursor, Claude) can answer questions like *"What's due this week?"* or *"What did the professor say would be on Quiz 2?"*.

---

## ⚡ Quickstart Guide

### 1. Clone & Install Dependencies
```bash
# Clone the repository
git clone https://github.com/anurag1372/all3.git
cd all3

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
```

---

## 🔑 Step-by-Step Credential Setup

Open your newly created `.env` file and configure the three platform credentials:

### 1. Canvas LMS API Token
1. Navigate directly to [canvas.eee.uci.edu/profile/settings ↗](https://canvas.eee.uci.edu/profile/settings) *(or your university's Canvas URL)*.
2. Scroll down to **Approved Integrations**.
3. Click **+ New Access Token**.
4. Set purpose to `All3 Integration` and click **Generate Token**.
5. Copy the generated string into your `.env`:
   ```env
   CANVAS_API_TOKEN=your_canvas_token_here
   ```

### 2. Ed Discussion API Token
1. Navigate directly to [edstem.org/us/settings/api-tokens ↗](https://edstem.org/us/settings/api-tokens).
2. Click **Create Token**.
3. Name it `All3 Discussion Sync` and copy the token into your `.env`:
   ```env
   EDSTEM_API_TOKEN=your_ed_token_here
   ```

### 3. Gradescope Zero-Click Chrome Extension
*No manual cookie copying or DevTools inspection required.*

1. Open Google Chrome and go to `chrome://extensions/`.
2. Toggle on **Developer mode** in the top-right corner.
3. Click **Load unpacked** in the top-left corner.
4. Select the `extension/` folder inside this repository.
5. Visit [gradescope.com](https://www.gradescope.com) once while logged in.
   - The extension auto-detects your session and syncs it to `127.0.0.1:3000`.
   - *Alternative:* Click the extension icon in your toolbar and press **`⚡ Sync Now`**.

---

## 📄 What Final `.env` Looks Like

Once configured, your `.env` file at the root of `all3` should look like this:

```env
# Canvas LMS (Personal Access Token)
CANVAS_API_TOKEN=7~abcdef1234567890abcdef1234567890

# Ed Discussion (API Token from settings)
EDSTEM_API_TOKEN=ed_tok_abcdef1234567890abcdef123456

# Gradescope (Auto-populated by Chrome extension or paste manual)
GRADESCOPE_COOKIE="signed_token=...; _gradescope_session=..."

# Local Server Loopback Port (Optional, defaults to 3000)
PORT=3000
```

---

## ▶️ Running the Server

Start the local server daemon:

```bash
npm start
# or: node server.js
```

Open your browser and navigate to:
```
http://127.0.0.1:3000
```

---

## 🖥️ Interactive Dashboard Features

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  🎓 All3 Platform  v1.0   •  [Canvas]  [Gradescope]  [EdStem]   •   Setup   anurag1372 ↗│
└────────────────────────────────────────────────────────────────────────────────────────┘
```

* **Horizontal Platform Status Chips**: Real-time status for Canvas, Gradescope, and Ed Discussion.
* **`Show all pending →`**: Strictly isolates unsubmitted assignments (`No Submission`) across all your active Gradescope courses with accurate time remaining (e.g. `1 day, 22 hours left`), due dates, and direct submission links.
  - Features dual sorting: **Default Course Order** vs **Sort by Time (Urgent First)**.
* **`last 30 threads →`**: Fetches the 30 most recent Ed Discussion posts across your courses with complete plaintext post bodies, reply counts, author names, and answer badges.
* **Setup Guide Drawer**: Click **Setup Guide** in the navbar to open an interactive slide-over drawer with real-time token health checks and quick links.

---

## 📁 Repository Structure

```
all3/
├── server.js              # Express application & API gateway (Canvas, EdStem, Gradescope)
├── cache.js               # Dual-tier persistent disk cache for parsed course data
├── output.js              # Dynamic course folder & markdown generator
├── STARTING_POINT.md      # Comprehensive deep-dive system architecture guide
├── package.json           # Project dependencies & startup scripts
├── .env.example           # Configuration template
├── extension/             # Zero-Click Chrome extension for Gradescope session sync
│   ├── manifest.json      # Chrome Manifest V3 configuration
│   ├── background.js      # Background cookie listener & auto-sync worker
│   ├── popup.html         # Modern extension popup interface (with 50/50 footer)
│   └── popup.js           # Popup status & manual sync trigger
├── public/                # Local web dashboard assets
│   ├── index.html         # Clean dashboard UI with horizontal navbar & setup drawer
│   ├── styles.css         # High-contrast dark glassmorphism design system
│   ├── app.js             # Client-side platform orchestrator & table renderer
│   └── favicon.svg        # Custom high-res SVG platform icon
├── cache/                 # (Git-ignored) Cached raw JSON & parsed PDF text buffers
└── output/                # (Git-ignored) Auto-generated course markdown summaries
```

---

## 🤖 Supercharging Your AI Coding Assistant

Because All3 exposes local REST endpoints at `http://127.0.0.1:3000/api/...` and maintains structured course summaries in `output/`, you can ask your AI IDE assistant (Antigravity, Cursor, Claude Code) questions directly:

### Deadlines & Time Management
> *"What assignments do I have due in the next 7 days that I haven't submitted yet?"*  
> *"Sort my pending Gradescope tasks by urgency and draft a study plan for this weekend."*

### Ed Discussion & Announcements
> *"Search recent EdStem threads: what did the professor say would be covered on Quiz 2?"*  
> *"Are other students having issues with the billing deployment on Ed Discussion? Summarize the TA's answer."*

### Lecture Slide Search (PDF Cache)
> *"Search my Canvas lecture slides for 'dynamic programming': which week covers it and what are the main theorems?"*  
> *"Summarize the key concepts from this week's slides in MCS 253P."*

---

## 🔒 Security & Privacy Guarantees

* **Strict Local Loopback**: The Express server is bound exclusively to `127.0.0.1`. Other devices on your local Wi-Fi network cannot connect to your instance.
* **Zero External Telemetry**: No tracking, analytics, or remote API proxies. All requests go directly from your machine to the official platform endpoints.
* **Git Safe**: `.env`, `cache/`, and `output/` are pre-configured in `.gitignore` so your personal tokens, session cookies, and student records are never committed to version control.

---

## 👤 Author & Links

Developed by **Anurag Singh**  
GitHub: [@anurag1372](https://github.com/anurag1372/all3) • Project: [all3](https://github.com/anurag1372/all3)
