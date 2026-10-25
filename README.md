# BoroHop (borohop.org) — Modern NYC Events Finder

A modern, fast, zero-tracking NYC event directory for **Borough Hoppers**, completely recreated and supercharged with automated Meetup sync, sharable URLs, PWA offline subway support, and an enhanced user experience.

---

## 🚀 Key Improvements Added

### 1. Automated Meetup Scraper & Decoupled Data
* **Decoupled Architecture:** Event data is no longer hard-coded across 1,700 lines of HTML. It lives in clean, structured JSON at `data/events.json`.
* **Zero-API-Key Scraper (`scripts/scrape_meetup.py`):**
  * Directly reads Meetup's `__NEXT_DATA__` server cache for the Borough Hoppers group.
  * Automatically pulls new events, high-res photos, dates, venues, descriptions, real-time RSVP counts, and spots left.
  * Intelligently auto-categorizes events (Food, Board Games, Sports, Concerts, Nature, etc.) and infers NYC boroughs and transit lines.
  * Updates existing events in-place while preserving manual overrides.
* **GitHub Actions Workflow (`.github/workflows/sync_meetup.yml`):** Automatically runs twice daily (or on-demand) to keep `events.json` constantly synchronized with Meetup without any manual maintenance.

### 2. Sharability & Personal Utility (100% Zero-Tracking)
* **Shareable Deep Links:** Every filter, search term, category, date mode, and view mode syncs to URL query parameters (e.g. `?q=board+games&mode=upcoming`). Includes a 1-click **🔗 Share** button that copies the clean URL to the clipboard.
* **Starred / Saved Events:** Attendees can click the ⭐ star button on any event card to save it to browser `localStorage`. A quick filter chip (`⭐ Saved (3)`) displays their personal weekend shortlist instantly.
* **Multi-Calendar Support:**
  * **Google Calendar:** Direct 1-click add link.
  * **Apple / Outlook Calendar (.ics):** Generates and downloads standard RFC 5545 `.ics` calendar files on the fly, opening the native iOS/macOS event add sheet in 1 tap.

### 3. Visual Polish & Status Badges
* **Visual Status Badges on Cards:**
  * Urgency indicator: `⚠️ Only 3 spots left` (orange/red pill), `🚫 Full / Waitlist`, or `👥 18 going`.
  * Price: `🟢 Free` or `💲 $20 to $30`.
  * Timing: `🔥 Happening Today`, `⚡ Tomorrow`.
* **Quick Filter Preset Chips:** One-tap quick filters for `⭐ Saved`, `🔥 This Weekend`, `🆓 Free Only`, `🍔 Food & Drinks`, `🎲 Board Games`, and `📍 Near Me`.
* **Mobile-Friendly Bottom Sheets:** Filter popovers slide up smoothly from the bottom on phones rather than covering the center of the screen with a clunky dark box.

### 4. NYC Transit & Location Intelligence
* **Google Maps Directions:** Directions pills now open directly in Google Maps with venue name and address pre-filled (`https://www.google.com/maps/dir/?api=1&destination=...`).
* **"Near Me" Geolocation:** Uses native HTML5 browser geolocation to calculate exact Haversine distances (in miles) and sorts upcoming events closest to the user.

### 5. Offline Subway Browsing & Dark Mode
* **PWA & Offline Subway Mode (`sw.js` + `manifest.json`):** Pre-caches the application shell and `events.json` using a Service Worker so attendees can browse event details, addresses, and subway stations underground without cellular service.
* **Dark Mode Theme:** Automatic detection based on system preference (`prefers-color-scheme: dark`) plus a manual toggle button (☀️ / 🌙) in the header.

### 6. Interactive Map View
* Leaflet map with interactive category emoji pins that center on click and show a rich card preview below with instant Google Maps directions, RSVP links, and calendar exports.

---

## 🛠️ How to Run Locally

### 1. Start the Local Server
```bash
# Using Python (built-in):
python3 -m http.server 8080

# Or using npm:
npm start
```
Then open [http://localhost:8080](http://localhost:8080) in your browser.

### 2. Run the Meetup Scraper Anytime
```bash
python3 scripts/scrape_meetup.py
# Or:
npm run sync
```

---

## 📁 Project Structure

```
borohop/
├── index.html                   # Semantic, accessible UI
├── styles.css                   # Responsive styles, dark mode, subway bullets, bottom sheets
├── app.js                       # Client-side routing, filtering, calendar exports, map
├── manifest.json                # PWA manifest
├── sw.js                        # Offline service worker
├── data/
│   └── events.json              # Structured events database (173+ events)
├── scripts/
│   └── scrape_meetup.py         # Automated Meetup scraping script
├── .github/workflows/
│   └── sync_meetup.yml          # Scheduled GitHub Action for automatic daily sync
└── package.json                 # Convenience commands
```
