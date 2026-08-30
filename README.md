# ⚓ Anchor — gentle planning for busy minds

A local-first PWA (installable web app) designed for people with ADHD and PTSD.
Voice brain-dump → gentle auto-planning around your calendar → focused "Now" mode → built-in motivation.

## Files
- `index.html` — the whole UI (styling via Tailwind CDN)
- `app.js` — all logic (voice capture, planner, Google Calendar, routines, body-double, sync)
- `sw.js` — service worker (offline caching + background notifications)

## Run it locally
```bash
cd anchor
python3 -m http.server 8080
# open http://localhost:8080
```

For voice + install-as-app, host it over HTTPS — free options:
- **GitHub Pages**: push these two files to a repo → Settings → Pages
- **Netlify / Vercel**: drag-and-drop the folder

## Google Calendar setup (one-time, ~2 min)
1. Go to console.cloud.google.com → create a free project
2. Enable the **Google Calendar API** and the **Google Drive API** (Drive is used for cloud sync)
3. OAuth consent screen → External → add yourself as a test user
4. Credentials → Create **OAuth Client ID** → type **Web application**
5. Add your hosting origin (e.g. `http://localhost:8080` or your HTTPS domain) to **Authorized JavaScript origins**
6. Paste the Client ID in the app's Calendar tab (stored only on your device)

## Features
- 🎙️ One-tap voice dump (Web Speech API — free, private, on-device transcription)
- 📥 Inbox with gentle 3-tap sorting (duration / energy / when)
- ✨ Auto-planner: fits tasks around calendar events inside your focus hours,
  low-energy tasks first, breaks between everything, daily task cap
- 🎯 Now mode: one task at a time + focus timer
- 🌅 Recurring routines: daily checklists with per-step progress that reset each day
- 🫶 Body-doubling timer: focus/rest cycles with a virtual calm presence & check-ins
- 🔔 Reminders: gentle nudges for planned tasks and routine times (Notification API + service worker; fires while app is open/installed)
- ☁️ Cloud sync: last-write-wins sync via a hidden folder in your own Google Drive (appDataFolder — only this app can see it)
- 💜 Daily affirmations, win streaks, confetti celebrations
- 🌿 5-4-3-2-1 grounding tool for overwhelm moments
- 💾 Local-first storage + JSON export/import (sync-ready later)
- 📅 Google Calendar read (plan around events) + write (push planned tasks)

## Data & privacy
Everything lives in your browser's localStorage. Nothing leaves your device
except direct Google Calendar API calls (only when you connect).
