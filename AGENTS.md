# AGENTS.md

## Cursor Cloud specific instructions

### Product

Single **Tactical Offshore** PWA (React + TypeScript + Vite + Tailwind + Leaflet). Deploy target is Netlify (`dist` + `netlify/functions/`). No monorepo, no Docker, no in-repo test runner or ESLint config.

### Install / refresh dependencies

From repo root:

```bash
npm install
```

There is no `package-lock.json` in the repo; installs resolve from `package.json` ranges.

### Run (full stack — recommended)

SST proxy and other Netlify Functions are required for Hotspots, map scanbreak, and live SST on Dashboard/Weather. Use Netlify CLI (via `npx`, no global install needed):

```bash
npx --yes netlify-cli@23 dev --offline
```

- App URL: **http://localhost:8888**
- Functions: `sst-proxy`, `sst-scheduled` (scheduled job not needed for manual UI testing)

`vite.config.ts` proxies `/.netlify/functions` to port 8888 when running `npm run dev` alongside `netlify dev`; running **only** `npm run dev` leaves SST-dependent features broken locally.

Netlify CLI may warn about redirect syntax for `/.netlify/*` in `netlify.toml`; dev still starts and functions load.

### Run (UI only)

```bash
npm run dev
```

Vite default: **http://localhost:5173**. Gate bypass and static UI work; live SST/ERDDAP paths need `netlify dev` or production.

### Build

```bash
npm run build
npm run preview   # optional; same SST limitation as Vite-only dev
```

### Lint / typecheck

- No ESLint script in `package.json`.
- Optional strict check (reports existing project issues): `npx tsc --noEmit` — `tsconfig.json` only includes `src/`, not `netlify/functions/`.

### Gate / E2E without Anima credentials

On the activation screen, use **`DEV`**, **`DEV-ACCESS`**, or **`DEVACCESS`** (see `src/components/GateScreen.tsx`) to bypass Playground activation for local testing.

Admin panel: `/admin`, default password documented in `README.md` (`offshore2024!`).

### External services (not local)

Live data depends on outbound network: NOAA ERDDAP (via `sst-proxy`), NOAA CO-OPS tides, NDBC/NWS, NASA GIBS, map tile CDNs, and optionally Anima Playground for cloud sync. `sst-scheduled` uses Supabase env vars configured in Netlify, not in this repo.

### Long-running dev server

Use a **tmux** session (e.g. `netlify-dev`) for `netlify dev` so the process survives backgrounding.
