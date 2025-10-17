# 🤖 HTU Doctors Telegram Bot

A smart, 24/7 Telegram bot for HTU (Al-Hussein Technical University) faculty directory with clickable emails and advanced search capabilities.

## ✨ Features

- 🔍 **Smart Search**: Search by name, department, office, or school
- 📧 **Clickable Emails**: Direct email links for easy contact
- ⏰ **Office Hours**: Complete office hours information
- 🏢 **Department Filtering**: Browse by department
- 📊 **Statistics**: Bot usage and data statistics
- 🎯 **Interactive Results**: Click buttons for detailed information
- 🔄 **24/7 Operation**: Automatic restart and health monitoring
- 💡 **Smart Suggestions**: Helpful tips when no results found

## 🚀 Quick Start

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn

### Installation

1. **Install dependencies:**
```bash
npm install
```

2. **Start the bot:**
```bash
 # Athar Bot — HTU Assistant (Telegram)

A small, focused Telegram bot to search HTU faculty, clubs, and rooms.

This README reflects the current code in this repository. It omits removed/unused features and documents what's implemented today.

## Key features

- Simple, fast text search for:
	- Faculty members by name or department
	- Clubs & teams
	- Office locations (room numbers)
- Beginner-friendly UI: a simplified mode with large buttons and short tips. Toggle with `/beginner` or via the inline button.
- Per-user preferences persisted to disk (minimal data: beginner flag). View and toggle via `/prefs`.
- Admin-only export of preferences: `/export_prefs` (admins configured with `ADMIN_IDS`).
- Lightweight health endpoint: GET /healthz returns status, uptime, memory, and active sessions.
- Atomic JSON writes to avoid corrupt files when saving prefs, history, or stats.

## Quick start

Requirements:
- Node.js (v16+ recommended)
- npm

Install and run locally:

```powershell
npm install
# Development (polling):
npm run dev
# Production:
npm start
```

Environment variables (recommended to set in your environment or platform):

- `BOT_TOKEN` (required) — your Telegram bot token
- `ADMIN_IDS` (optional) — comma-separated Telegram numeric user IDs for admin commands, e.g. "12345,67890"
- `NO_POLL` or `DEBUG_NO_POLL` (optional) — set to `1` to disable polling for dry-run/testing (bot won't contact Telegram)
- `HEALTH_PORT` (optional) — port for the health endpoint (default: 3000)

## Commands (user)

- `/start` — Welcome and quick actions
- `/help` — Short usage tips
- `/beginner` — Toggle beginner-friendly UI
- `/prefs` — View and toggle minimal persisted preferences
- `/departments` — Browse departments
- `/clubs` — Browse clubs
- `/history` — Your recent searches

## Commands (admin)

- `/reload` — Reload data files (admin only)
- `/export_prefs` — Send user prefs file to the admin chat (admin only)

Admin users are configured via the `ADMIN_IDS` environment variable and must be numeric Telegram user IDs.

## Data files

- `doctors.json` — primary data source used for searches (ships in repo)
- `htuClubs.json` — clubs and teams data
- `htuNameSystem.json` — optional name metadata
- `data/` (created at runtime) — contains persisted files:
	- `searchHistory.json`
	- `funStats.json`
	- `userPrefs.json`

Notes: The bot persists only minimal per-user prefs (the beginner flag) to avoid saving large session state.

## Health & monitoring

The bot starts a small HTTP server on `HEALTH_PORT` (default 3000). Visit `http://localhost:3000/healthz` to get a JSON payload with status, uptime, heapUsedMB, and active sessions.

## Testing & linting

Project includes basic dev tooling configuration. To run tests and linters locally:

```powershell
npm install
npm run lint
npm test
```

(You may need to install dev dependencies locally first.)

## Notes & removed features

- The repository no longer includes any external AI integration or CLI deploy helper scripts. Those historical references were removed to keep the bot lightweight and self-contained.
- The bot intentionally uses file-based persistence (JSON) with atomic writes for simplicity. If you require a DB, consider replacing the save/load helpers with a DB-backed implementation.

## Contributing

Small changes are welcome via pull requests. Please run tests and linting before submitting.

---

If you'd like, I can also:
- Add a short CHANGELOG section describing recent removals (Gemini, axios) and additions (prefs, beginner mode, health endpoint).
- Add a small `docker-compose` or PM2 sample for production hosting.

