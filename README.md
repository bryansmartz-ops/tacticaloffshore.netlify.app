# Tactical Offshore

Offshore fishing tactical intelligence PWA — built with React + TypeScript + Vite + Tailwind CSS + Leaflet.

## Features
- **Tactical Map** — GIBS MUR SST overlay, 12/24/36h SST history + animation, bathymetry, LORAN TD readout, hotspot circles
- **Live Tides** — NOAA CO-OPS API, station 8534720 (Ocean City Inlet, NJ), MLLW datum, push-notification reminders
- **Marine Weather** — NDBC Buoy 44025 (40nm SE Manasquan Inlet) — wind, seas, period, pressure, GO/MARGINAL/NO-GO
- **Hotspots** — 5 canyon predictions with live ERDDAP SST, hourly localStorage cache
- **Solunar** — Daily major/minor feeding period table
- **Catch Log** — GPS-stamped catch entries stored in localStorage
- **Admin Panel** — Hidden at `/admin`, password-gated activation code manager

## Tech Stack

| Layer | Library |
|-------|---------|
| UI | React 18 + TypeScript |
| Styling | Tailwind CSS v3 |
| Bundler | Vite 5 |
| Routing | React Router v6 |
| Maps | Leaflet 1.9 |
| SST tiles | NASA GIBS WMTS (MUR L4) |
| SST point | NOAA ERDDAP griddap (jplMURSST41) |
| Tides | NOAA CO-OPS Predictions API |
| Weather | NDBC real-time text feed |
| Charts | Recharts |
| Icons | Lucide React |

## Data Sources
- **SST Visual**: NASA GIBS — `GHRSST_L4_MUR_Sea_Surface_Temperature`
- **SST Point Query**: NOAA CoastWatch ERDDAP — `jplMURSST41`
- **Tides**: NOAA CO-OPS — Station 8534720, Ocean City Inlet NJ
- **Marine Weather**: NDBC Buoy 44025 — 40.251°N 73.164°W

## Development

```bash
npm install
npm run dev
```

## Deploy to Netlify

1. Push this repo to GitHub
2. In Netlify → "Add new site" → "Import an existing project" → pick your repo
3. Build command: `npm run build` · Publish directory: `dist`
4. The `netlify.toml` in this repo handles both automatically
5. Every push to `main` (or your chosen branch) triggers an auto-deploy

## Admin Panel

Navigate to `/admin` in the browser. Default password: `offshore2024!`
Change `ADMIN_PASSWORD` in `src/sections/Admin/index.tsx` before deploying publicly.
