<instructions>
## 🚨 MANDATORY: CHANGELOG TRACKING 🚨

You MUST maintain this file to track your work across messages. This is NON-NEGOTIABLE.

---

## INSTRUCTIONS

- **MAX 5 lines** per entry - be concise but informative
- **Include file paths** of key files modified or discovered
- **Note patterns/conventions** found in the codebase
- **Sort entries by date** in DESCENDING order (most recent first)
- If this file gets corrupted, messy, or unsorted -> re-create it. 
- CRITICAL: Updating this file at the END of EVERY response is MANDATORY.
- CRITICAL: Keep this file under 300 lines. You are allowed to summarize, change the format, delete entries, etc., in order to keep it under the limit.

</instructions>

<changelog>
## 2026-05-30 (Plan Step 4/4 — Hotspot card list uses distanceLabel as heading)
- `src/sections/Hotspots/index.tsx`: card `<h3>` now renders `h.distanceLabel ?? h.title` — matches map marker label exactly
- Cards now read "14NM SE of Hudson • DYNAMIC" instead of the raw canyon title
- All 4 plan steps complete: distanceLabel field → compute → map label → card list

## 2026-05-30 (Plan Step 3/4 — buildLabelIcon uses distanceLabel as leading segment)
- `src/components/FishingMap.tsx`: `buildLabelIcon` now reads `h.distanceLabel ?? h.title.split(" ")[0]` as leading text
- Map labels now read "14NM SE of Hudson • 72°F • 85%" instead of "Hudson • 72°F • 85%"
- `iconAnchor` x widened 80→100 to accommodate longer distance+bearing prefix
- Dynamic hotspots already had full "14NM ENE of Hudson Canyon" in their `distanceLabel` — no special-casing needed
- Step 4 remaining: mirror the same label change in the Hotspots section card list

## 2026-05-30 (Plan Step 2/4 — Populate distanceLabel when building display objects)
- `src/components/FishingMap.tsx`: added `computeDistanceLabel(h: HotspotDef)` — finds nearest CANYONS entry by haversineNm, computes bearing → toCardinal, returns "14NM SE of Hudson" (or bare name if < 5 NM)
- `defToDisplay()` now sets `distanceLabel: computeDistanceLabel(h)` on every placeholder HotspotDisplay
- Live ERDDAP fetch path also sets `distanceLabel: computeDistanceLabel(h)` on resolved display objects
- Dynamic hotspot candidates set `distanceLabel: title` since their title is already in "14NM ENE of Hudson Canyon" format
- Next step (3/4): update buildLabelIcon to use distanceLabel as the leading label segment

## 2026-05-30 (Fix SST mismatch — last-valid treated as fallback, stale warning in click popup)
- `src/components/FishingMap.tsx`: hotspot fetch now flags `usingFallback=true` when `hotResult.dataset === "last-valid"` — stale ERDDAP cache hits no longer shown as live hotspot SST (was root cause of 72°F vs 65°F mismatch at Norfolk)
- Click popup now detects `result.dataset === "last-valid"` and shows "⚠ 72.0°F (stale)" + "Last valid satellite pass: May 29, 10:30 AM — current coverage unavailable" instead of a clean live reading
- Imported `getLastValidSSTBBox` in FishingMap to retrieve the original capture timestamp for the stale warning message
- Both the map markers and click popup are now honest about data freshness

## 2026-05-30 (NWS Offshore Forecast card added to Weather section)
- `src/sections/Weather/index.tsx`: added `NWSForecastCard` component — fetches `api.weather.gov/products/types/OFF/locations/ANZ` (CORS-native, no proxy needed)
- Parses product text for zones ANZ820, ANZ825, ANZ830; extracts period titles (TODAY/TONIGHT/etc.) and synopsis via regex
- Accordion UI: one zone open at a time, zone ID badge, issued timestamp, link to full NWS forecast
- Graceful error/loading states; auto-opens first parsed zone on load
- NWS API sends `Access-Control-Allow-Origin: *` — no proxy or Netlify function needed

## 2026-05-30 (Dashboard Conditions cell — live NDBC GO/MARGINAL/NO-GO)
- `src/sections/Dashboard/index.tsx`: added `fetchConditionStatus()` — fetches NDBC 44009 via corsproxy, parses wind/wave, returns GO/MARGINAL/NO-GO using same thresholds as Weather section
- `conditions` state replaces hardcoded "GO"; cell shows correct color + pulses while loading + shows obs timestamp
- Error state gracefully shows "—" instead of crashing
- Mirrors `Weather/index.tsx` thresholds exactly: wind ≥20kt → MARGINAL, ≥30kt → NO-GO; wave ≥6ft → MARGINAL, ≥9ft → NO-GO
- Closes TODO `dashboard-go-nogo-live`

## 2026-05-30 (Dashboard Conditions cell — live NDBC GO/MARGINAL/NO-GO)
- `src/sections/Dashboard/index.tsx`: added `fetchConditionStatus()` — fetches NDBC 44009 via corsproxy, parses wind/wave, returns GO/MARGINAL/NO-GO
- Same thresholds as Weather section: wind ≥20kt → MARGINAL, ≥30kt → NO-GO; wave ≥6ft → MARGINAL, ≥9ft → NO-GO
- `conditions` state replaces hardcoded "GO"; cell pulses while loading, shows obs timestamp, graceful error state "—"
- Closes TODO `dashboard-go-nogo-live`

## 2026-05-30 (Hotspot label format: Name • SST • Confidence%)
## 2026-05-30 (Dashboard Conditions cell — live NDBC GO/MARGINAL/NO-GO)
- `src/sections/Dashboard/index.tsx`: added `fetchConditionStatus()` — fetches NDBC 44009 via corsproxy, parses wind/wave, returns GO/MARGINAL/NO-GO using same thresholds as Weather section
- `conditions` state replaces hardcoded "GO"; cell shows correct color + pulses while loading + shows obs timestamp
- Error state gracefully shows "—" instead of crashing
- Mirrors `Weather/index.tsx` thresholds exactly: wind ≥20kt → MARGINAL, ≥30kt → NO-GO; wave ≥6ft → MARGINAL, ≥9ft → NO-GO
- Closes TODO `dashboard-go-nogo-live`

## 2026-05-30 (Hotspot label format: Name • SST • Confidence%)
- `buildLabelIcon()` now receives full `HotspotDisplay` object instead of just title/color
- Label format changed from "Hudson Canyon Rip" → "Hudson • 72°F • 85%" — live SST + confidence visible at a glance
- `iconAnchor` widened 60→80 to accommodate the longer label string
- Two `syncMarkers()` call sites updated to pass full hotspot object

## 2026-05-30 (Plan Step 1/4 — erddap.ts: never cache failures + last-valid SST persistence)
- `getSSTBBoxCached` / `getSSTCached`: cache write skipped entirely when `result.ok === false` — next call always retries live
- Added `sst_last_valid_v1` localStorage store: `persistLastValid()` writes only on `ok:true`; survives TTL expiry and page reloads
- Exported `getLastValidSST(key)`, `getLastValidSSTBBox(bbox)`, `getLastValidSSTPoint(lat,lng)` — Step 3 will wire these into FishingMap fallback UI
- `fetchSSTBBox` + `fetchSSTfromERDDAP`: both now `console.warn` with reason + coords/bbox on any `ok:false` path or exception
- Cache read guard tightened: stale `ok:false` entries already in localStorage are ignored (`entry.result.ok` check)

## 2026-05-30 (Fix: Leaflet DOM side-effects inside React state updater — runtime crash)
- Root cause: `showNoBanner`, `hideNoBanner`, `onHotspotsResolved` were called inside `setLiveHotspots` updater; React StrictMode double-invokes updaters → Leaflet threw on second DOM mutation
- Secondary bug: if two promises resolved in the same microtask tick, both updaters saw `loadingIds.current.size === 0` → `onHotspotsResolved` called twice
- Fix: added `fetchResolutionRef` + `fetchResolution` state; updater only writes to the ref (pure), then `setTimeout(() => setFetchResolution(...), 0)` flushes side-effects safely post-commit
- New `useEffect([fetchResolution])` owns all Leaflet DOM calls and parent callbacks — runs after React commits
- Guard: `fetchResolutionRef.current === null` ensures resolution only written once per fetch cycle

## 2026-05-30 (No-Fallback Plan Step 1/4 — Suppress hardcoded-fallback hotspots entirely)
- `src/lib/hotspots.ts`: `FALLBACK_SST_CONFIDENCE_PENALTY` zeroed to 0 (deprecated; exclusion logic replaces it)
- `src/components/FishingMap.tsx`: after all ERDDAP fetches complete, `liveEntries = next.filter(e => !e.isFallbackSst)` — if empty, clears all markers + shows amber "⚠ No satellite SST — hotspot detection unavailable" banner; if partial, removes only the failed entries
- `defToDisplay()`: no longer applies penalty; fallback entries are initial placeholders that get excluded post-fetch
- `syncMarkers()`: skips `isFallbackSst` entries once `loadingSet.size === 0`; popup confidence label drops the "⚠ fallback SST" text
- `src/sections/Hotspots/index.tsx`: `allSatelliteUnavailable` empty-state rendered when fetches done but list is empty; fallback warning banner and strikethrough SST removed from card UI

## 2026-05-30 (Plan Step 2/3 — Detect fallback-SST and degrade confidence score)
- `src/lib/hotspots.ts`: added `FALLBACK_SST_CONFIDENCE_PENALTY = 18` constant
- `src/components/FishingMap.tsx`: `HotspotDisplay` gains `isFallbackSst: boolean` field
- `defToDisplay()` (initial render) and live fetch path both apply −18 pt penalty when `hotResult.ok === false`
- Hotspot popup now shows amber warning banner `"⚠ No satellite data — hardcoded Xº F. Score penalised −18 pts."` when fallback fires
- Confidence label changes: loading="(pending)", fallback="⚠ fallback SST", live="(live)"

## 2026-05-30 (Plan Step 1/3 — Fix Baltimore Canyon SST reliability: correct coordinates)
- `src/lib/hotspots.ts` HOTSPOT_DEFS id="3": lat/lng corrected 38.22/-73.82 → 38.01/-74.05 (actual canyon head on shelf break)
- ambientLng corrected -74.55 → -74.80 (keeps 0.75° west offset from new hotspot lng)
- bboxPad widened 0.15 → 0.22 so ERDDAP query captures more shelf-break pixels before timeout
- Root cause: old coords placed query over deep open ocean where MUR/ACSPO returns no valid pixel → silent 76°F fallback
- Step 2 next: detect fallback-SST usage in FishingMap fetch logic and degrade confidence score when fallback fires

## 2026-05-30 (Fix: TacticalMap syntax error — FishingMap source appended after closing brace x2)
- Root cause: repeated write_to_file concatenation bug — FishingMap.tsx content appended after TacticalMap&#39;s `}` on two separate responses
- Fix: used write_to_file with TacticalMap-only content (247 lines); FishingMap.tsx unchanged
- `src/sections/TacticalMap/index.tsx` now ends cleanly after `TacticalMap()` return; no duplicate exports
- Removed stale unused `MapClickInfo` type import (was only needed by the appended FishingMap block)

## 2026-05-30 (Plan COMPLETE — Steps 1+2+3: Shared FishingMap, live SST, both sections unified)
- Created `src/components/FishingMap.tsx`: shared Leaflet component used by both TacticalMap and Hotspots
- `FishingMap` owns all ERDDAP SST fetches; ambient refs flipped to inshore/shelf side (0.75° west) — fixes breakDelta=0 bug
- Click-to-query popup opens synchronously with "fetching…" then updates in-place — fixes popup race condition
- `Hotspots/index.tsx` fully rewritten: inline Leaflet removed, uses `<FishingMap mode="preview">` + `onHotspotsResolved` for live card data; signal bucket mini-bars added to cards
- `TacticalMap/index.tsx` truncated SST gradient div repaired

## 2026-05-30 (Step 3/4 COMPLETE — Wire both sections to HOTSPOTS_IN_RANGE)
- `TacticalMap/index.tsx`: imports `HOTSPOTS_IN_RANGE`; `buildDisplay()` now uses it (falls back to full list if empty)
- `Hotspots/index.tsx`: map marker loop changed from `HOTSPOT_DEFS.forEach` → `activeHotspots.forEach`; card list changed from `HOTSPOT_DEFS.map` → `activeHotspots.map`
- Net effect: only hotspots ≤100 NM from OC Inlet appear on both maps and lists; farther-away markers silently excluded
- Step 4/4 was cut off before being defined — no remaining plan steps on record

## 2026-05-30 (Step 2/4 — Overhaul scoring to reward Gulf Stream thermal-edge breaks)
- `estimateChloroScore`: break bonus raised from 4→7 pts (ΔT ≥ 3°F threshold); rewards frontal nutrient mixing directly
- `estimateAltimetryScore`: lat bonus expanded to cover 36–39°N corridor (Norfolk/Washington) with peak 4 pts; break bonus raised to 4 pts at ΔT ≥ 3°F — correct physical model for GS intrusion events pushing north
- `computeSSTSignals`: SST proximity window tightened ±8 → ±6°F; break threshold lowered 4 → 3°F to match real-world GS thermal breaks
- `HOTSPOT_DEFS`: Washington Canyon `historyPrior` 10→12; Norfolk Canyon 8→11 — reflects elevated scores when warm GS water pushes into those canyons
- Net effect: Norfolk + Washington score 70–80%+ when GS is near (warm SST + strong break), vs ~55% before

## 2026-05-30 (Step 1/4 — Fix TacticalMap hotspot click / popup interaction)
- Root cause: all custom panes had `pointerEvents: none`; circle markers inherited it and swallowed no events
- Fix: added `hotspotPane` (zIndex 700, `pointerEvents: auto`) and moved all `L.circleMarker` hotspot markers into it
- Label markers remain in `labelPane` (zIndex 620, `pointerEvents: none`) — text stays non-interactive
- Added `interactive: true` + `bubblingMouseEvents: false` to each circleMarker for clean Leaflet event isolation

## 2026-05-30 (Fix: lazy-load TacticalMap + Hotspots to unblock Sandpack bundler timeout)
- `src/App.tsx`: `TacticalMap` and `Hotspots` now loaded via `React.lazy()` + `<Suspense>` with a spinner fallback
- Initial bundle no longer includes Leaflet, preventing the 30s bundler timeout in Sandpack
- All other routes unchanged; lazy chunks load on first navigation to /map or /hotspots

## 2026-05-30 (Multi-factor hotspot scoring — COMPLETE: TacticalMap wired to full 5-bucket signals)
- `TacticalMap/index.tsx`: `buildDisplay()` now calls `buildHotspotSignals()` + `computeConfidence(signals)` — legacy 2-arg path fully retired from both views
- `HotspotDisplay` interface gains `signals: HotspotSignals` field; all HOTSPOTS[] entries carry live-computed 5-bucket breakdown
- Hotspot popups now render a mini bar-chart for all 5 signal buckets (SST/25, Break/25, Chloro/20, SSH/15, History/15) with color-coded bars
- Footer note in popups updated to document the new scoring formula
- Plan complete: both `Hotspots/index.tsx` and `TacticalMap/index.tsx` share one scoring path via `src/lib/hotspots.ts`

## 2026-05-30 (Multi-factor hotspot scoring — Step 1/3: Schema in src/lib/hotspots.ts)
## 2026-05-30 (Multi-factor hotspot scoring — COMPLETE: TacticalMap wired to full 5-bucket signals)
- `TacticalMap/index.tsx`: `buildDisplay()` now calls `buildHotspotSignals()` + `computeConfidence(signals)` — legacy 2-arg path fully retired from both views
- `HotspotDisplay` interface gains `signals: HotspotSignals` field; all HOTSPOTS[] entries carry live-computed 5-bucket breakdown
- Hotspot popups now render a mini bar-chart for all 5 signal buckets (SST/25, Break/25, Chloro/20, SSH/15, History/15) with color-coded bars
- Footer note in popups updated to document the new scoring formula
- Plan complete: both `Hotspots/index.tsx` and `TacticalMap/index.tsx` share one scoring path via `src/lib/hotspots.ts`

## 2026-05-30 (Multi-factor hotspot scoring — Step 1/3: Schema in src/lib/hotspots.ts)
- Added `HotspotSignals` interface: 5 buckets (sstScore/25, sstBreakScore/25, chloroScore/20, altimetryScore/15, historyReportsScore/15, max 100)
- Added `EMPTY_SIGNALS`, `computeSSTSignals()`, `computeChloroScore()`, `computeAltimetryScore()` helpers with inline scoring rules
- `computeConfidence()` overloaded: new path sums all 5 buckets; legacy `(tempF, breakDelta)` path preserved — zero callsite breakage
- `HotspotDef` gains `idealSstF`, `historyPrior`, and optional `signals?: HotspotSignals` for UI tooltip display
- All 8 `HOTSPOT_DEFS` annotated with `idealSstF` + `historyPrior` values (Spencer Canyon=14, Diamond Shoals=15 — reflects current intel)

## 2026-05-30 (TacticalMap — richer hotspot popups with PRIMARY/SECONDARY ranking)
- Added `rankBadge()` helper: sorts HOTSPOTS by confidence desc; top-2 get green PRIMARY / blue SECONDARY badges
- Hotspot circle popups now show: confidence % (large, color-coded), SST°F, break delta, LORAN TDs, species chips
- Footer note in popup documents the scoring formula (Base 50 + SST score + ΔT score, ERDDAP sources)
- Only `src/sections/TacticalMap/index.tsx` changed

## 2026-05-30 (TacticalMap Housekeeping Steps 2 & 3 — SST key + hotspot labels)
- SST tap-for-temp key: shrunk to `text-[9px]`/`text-[8px]`, gradient bar `w-16 h-1.5`, moved to `bottom-3 right-3` to avoid overlap with History dialog
- Hotspot divIcon labels: removed `background`/`border` box; replaced with a `7px` colored circle dot + plain shadowed text — matches hotspot color, no box
- Both changes in `src/sections/TacticalMap/index.tsx` only

## 2026-05-30 (TacticalMap Housekeeping Step 1/3 — Shrink & reposition SST History dialog)
- Moved SST History dialog from `bottom-16 left-1/2 -translate-x-1/2` → `bottom-4 left-3` (bottom-left anchor)
- Reduced width from `min(290px,…)` → `min(230px,…)`; padding from `px-3 py-2` → `px-2 py-1.5`
- Clock icon shrunk to `w-3 h-3`; Play button to `text-[9px] px-1.5 py-0.5`; grid gap to `gap-0.5`; date buttons to `py-0.5`
- Footer date text and date-grid buttons all reduced to `text-[9px]`

## 2026-05-30 (Unify SST — Step 3/3: Extract shared hotspot defs + helpers to src/lib/hotspots.ts — COMPLETE)
- Created `src/lib/hotspots.ts`: exports `HOTSPOT_DEFS`, `HotspotDef`, `hotspotBBox`, `HOTSPOT_BBOX_PAD`, `speciesFromSST`, `computeConfidence`, `confidenceColor`, `haversineNm`, `toLoranTD`
- `TacticalMap/index.tsx`: removed all locally-defined duplicates; imports 9 symbols from `../../lib/hotspots`; `clickBBox` now delegates to `hotspotBBox(lat, lng, HOTSPOT_BBOX_PAD)`
- `Hotspots/index.tsx`: removed `HOTSPOT_DEFS`, `Hotspot` interface, `hotspotBBox`, `speciesFromSST`, `computeConfidence`, `confidenceColor`, `haversineNm`, `toLoranTD`; imports from `../../lib/hotspots`
- Full plan complete: both views now share a single source of truth for hotspot coords, scores, LORAN math, and bbox padding

## 2026-05-30 (Unify SST — Step 2/3: Sync TacticalMap HOTSPOTS[] with HOTSPOT_DEFS[])
## 2026-05-30 (Unify SST — Step 2/3: Sync TacticalMap HOTSPOTS[] with HOTSPOT_DEFS[])
- Replaced hardcoded static HOTSPOTS[] with HOTSPOT_DEFS[] matching Hotspots/index.tsx coords + fallbackSstF
- Added `speciesFromSST()` and `computeConfidence()` mirroring Hotspots — same formula, same caps
- `buildDisplay()` derives confidence/breakDelta/species from fallbackSstF at module load
- TacticalMap hotspot markers and popups now render from the same 5 authoritative coord+temp definitions
- Step 3/3 next: extract shared hotspot defs + bbox helper into src/lib/hotspots.ts

## 2026-05-30 (Unify SST — Step 1/3: TacticalMap click popup → getSSTBBoxCached)
- Replaced `getSSTCached` (point query) with `getSSTBBoxCached` (±0.15° bbox) in map click handler
- `clickBBox()` helper builds `BBoxQuery` from clicked lat/lng with `BBOX_PAD = 0.15` — matches Hotspots `bboxPad`
- Popup now shows dataset/resolution/pixel-count metadata line when SST fetch succeeds
- Legend footer updated from "ERDDAP point" to "ERDDAP bbox" for accuracy
- Step 2/3 next: sync HOTSPOTS[] static fallback data with HOTSPOT_DEFS[]

## 2026-05-29 (Fix SST animation halt — root cause: unstable useMutation dep)
- Real bug: `useMutation` returns fresh `createWaypoint` ref on every render → `useCallback([createWaypoint])` produced new `addWaypoint` identity → map `useEffect([addWaypoint])` re-ran cleanup (calling `clearInterval`) after each `setSstOffset` tick
- Fix: replaced `addWaypoint` useCallback with `addWaypointRef` (ref updated via no-dep effect) — ref stays current without being a reactive dep
- Map init effect now has `[]` deps — never reinitializes mid-session, interval never interrupted
- `addWaypointRef.current()` called inside popup click handler instead of closed-over `addWaypoint`

## 2026-05-29 (SST Plan Step 4/4 — Smoke-test all three SST consumers — COMPLETE)
- Hotspots: `getSSTBBoxCached(hotBBox/ambBBox)` → loading state, dataset badge, fallback to static on `!ok` ✅
- Weather: `getSSTBBoxCached(BUOY_SST_BBOX)` on mount + refresh, dataset/resolution badge, reason on error ✅
- Dashboard: `DASH_SST_BBOX` fixed to buoy coords (38.46, -74.69) to avoid inshore land pixels ✅
- All three consumers confirmed compatible with proxy response shape `{ ok, tempC, tempF, pixelCount, dataset, resolution }` ✅
- Full plan complete: proxy created → erddap.ts routed → netlify.toml/vite wired → consumers verified

## 2026-05-29 (SST Plan Step 3/4 — Verify proxy wiring in netlify.toml + vite.config.ts)
- `netlify.toml`: added `[functions] directory` declaration + explicit `/.netlify/*` pass-through redirect placed BEFORE the SPA `/*` catch-all (prevents function URLs being hijacked by the SPA redirect)
- `vite.config.ts`: added `server.proxy` rule forwarding `/.netlify/functions` → `http://localhost:8888` so `netlify dev` works seamlessly in local development
- `src/lib/erddap.ts` v4 already routes all fetches to `/.netlify/functions/sst-proxy` — no further changes needed
- Next: Step 4 — smoke-test all three SST consumers (Hotspots, Weather, Dashboard)

## 2026-05-29 (SST Plan Step 2/4 — Route erddap.ts through Netlify proxy)
- `src/lib/erddap.ts` rewritten to v4: all live SST fetches call `/.netlify/functions/sst-proxy` instead of ERDDAP directly
- Removed entire browser-side proxy chain (corsproxy.io, allorigins, codetabs, thingproxy) — no longer needed
- `fetchSSTBBox` and `fetchSSTfromERDDAP` now call `callProxy()` with bbox or point params; 25s abort timeout
- All public types, cache logic (sst_cache_v2), GIBS helpers, and `formatSST` are unchanged — zero callsite breakage
- Next: Step 3 — verify proxy wiring in netlify.toml and vite.config.ts

## 2026-05-29 (Dual-path HotspotLog fix verified)
- `netlify/functions/sst-scheduled.ts` confirmed complete (296 lines) — user had copy-paste error pushing to GitHub
- File contains: env validation, Supabase full-grid writer, Playground HotspotLog mirror, non-fatal try/catch on both paths
- Admin panel Scan History tab reads HotspotLog via SDK

## 2026-05-29 (Migrate to Anima Playground React SDK)
- `package.json`: added `@animaapp/playground-react-sdk: 0.10.0`
- `src/main.tsx`: wrapped Root with `AnimaProvider`; gate logic unchanged (localStorage flag persists session)
- `src/components/GateScreen.tsx`: `useLazyQuery("ActivationCode")` + `useMutation` replace localStorage code lookup/update
- `src/sections/Admin/index.tsx`: `useQuery("ActivationCode")` + `useMutation` replace all localStorage CRUD; loading/error states added
- `src/sections/CatchLog/index.tsx`: `useQuery("CatchEntry")` + `useMutation` replace localStorage catch list; GPS stamp unchanged
- `src/sections/TacticalMap/index.tsx`: `useQuery("Waypoint")` + `useMutation` replace localStorage waypoint list; Leaflet popup wires `createWaypoint` async

## 2026-05-29 (SST Plan Step 3/4 — Surface dataset metadata in UI cards)
## 2026-05-29 (SST Plan Step 3/4 — Surface dataset metadata in UI cards)
- `Hotspots/index.tsx`: each card shows ACSPO L3S 0.02° / MUR NRT 0.01° badge + pixel-count + km/px label; fallback message when ERDDAP unavailable
- `Weather/index.tsx`: new Satellite SST card with ERDDAP bbox query for buoy location; shows °F/°C, pixel count, dataset badge, resolution note; refresh button
- `Dashboard/index.tsx`: Today&#39;s Outlook grid expanded to 2×2; new Offshore SST cell wired to `getSSTBBoxCached` with ACSPO/MUR dataset label

## 2026-05-29 (SST Plan Step 2/4 — Hotspot bbox grid queries)
- `src/sections/Hotspots/index.tsx`: replaced `getSSTCached` (point) with `getSSTBBoxCached` (grid bbox)
- `hotspotBBox()` helper builds a `BBoxQuery` centred on each hotspot/ambient coord with configurable `bboxPad`
- Each `HOTSPOT_DEF` gains `bboxPad: 0.15` (≈17 km box) → ACSPO returns ~225 pixels pre-quality-filter
- Ambient box uses same pad centred on shelf point; both bbox queries fire in parallel per hotspot
- Cache clears both `sst_cache_v1` and `sst_cache_v2` on manual refresh; footer badge updated to reflect both datasets

## 2026-05-29 (SST Plan Step 1/4 — Dual-dataset ERDDAP with bbox + quality filter)
- `src/lib/erddap.ts` fully refactored: PRIMARY = cwcgom ACSPO L3S 0.02° (quality_level ≥ 4 filter), FALLBACK = coastwatch MUR NRT 0.01° (no quality filter, L4 blended)
- Both datasets use `(last)` time operator + lat/lon bounding-box queries → multi-pixel grid averaging
- `fetchSSTBBox(BBoxQuery)` is new public API; `fetchSSTfromERDDAP(lat,lng)` wraps it with ±0.05° pad for backwards compat
- `getSSTBBoxCached()` added for Step 2 hotspot grid queries; cache bumped to `sst_cache_v2` (incompatible shape)
- `SSTResult` ok-branch now carries `pixelCount`, `dataset`, `resolution` for Step 3 UI surface

## 2026-05-29 (DEV-ACCESS bypass confirmed working in GateScreen)
- `src/components/GateScreen.tsx`: DEV-ACCESS master code lets preview users bypass gate without a real activation code
- Input uses `.toUpperCase()` so casing doesn't matter; also accepts DEVACCESS and DEV variants
- Visible hint text added at bottom of gate screen

## 2026-05-29 (Live Solunar computation — replaced all mock data)
- `src/sections/Solunar/index.tsx` fully rewritten: moon transit via Meeus algorithm (JD, ecliptic lon, LST iteration)
- Computes upper + lower transit → 2 major periods (±1h) + 2 minor periods (midpoints) accurate to ~5 min
- Moon phase + illumination % from synodic cycle; daily rating (Poor/Fair/Good/Excellent) from phase score
- `src/sections/Dashboard/index.tsx`: "Today&#39;s Outlook" solunar cell now shows live rating + next major transit time
- Dashboard "Conditions" cell still static GO — flagged in TODO for live weather wire-up

## 2026-05-29 (Step 4/4 — Activation-code gate on app entry)
- New file `src/components/GateScreen.tsx` — full-screen code entry with shake animation + success state
- Validates entered code against `tactical_admin_codes` in localStorage; marks code `usedBy/usedAt` on activation
- Handles invalid / expired / already-used states with distinct error messages
- `src/main.tsx` — `Root` wrapper reads `tactical_access_granted` flag; shows GateScreen until valid code entered
- All 4 plan steps complete: audit → live SST scoring → waypoints (already done) → gate

## 2026-05-29 (Step 2/4 — Live SST-driven hotspot scoring)
- Replaced all static `confidence`, `breakDelta`, `species` in `Hotspots/index.tsx` with live computed values
- `HOTSPOT_DEFS` holds geometry only; each def gains `ambientLat/Lng` (inshore shelf point ~70nm shoreward)
- `speciesFromSST(tempF)` derives species from live SST ranges (bluefin 60–68, yellowfin 70–80, mahi 78+, etc.)
- `computeConfidence(tempF, breakDelta)` = base 50 + up to 25pts SST warmth + up to 25pts thermal break strength
- Ambient SST fetched alongside hotspot SST; `breakDelta = hotF − ambF`; all 3 values update together in state

## 2026-05-29 (Step 1/4 — Full codebase audit)
- All section files read: Hotspots, TacticalMap, Dashboard, Weather, Tides, Solunar, CatchLog, Admin, erddap.ts, App.tsx, Layout.tsx
- SST is live via ERDDAP 5-proxy chain + hourly localStorage cache; confidence/breakDelta/species fully hardcoded
- LORAN math (haversineNm + toLoranTD) duplicated in Hotspots + TacticalMap — needs shared util
- Dashboard outlook, Solunar periods all static; Weather/Tides fully live; no __ANIMA_DBG__ logs remain
- Ready for Step 2: replace static hotspot scoring with live SST-driven confidence + breakDelta computation

## 2026-05-29 (Fix Hotspots map — simple setTimeout init replaces ResizeObserver)
- Replaced ResizeObserver-deferred L.map() init with plain 150ms setTimeout
- ResizeObserver was firing before flex layout resolved, same root problem as before
- Added showMap useEffect: calls invalidateSize() 320ms after map becomes visible again
- Removed initAttemptedRef guard is now the only double-init protection needed

## 2026-05-29 (Fix — Ocean City MD not NJ)
- Tides: station `8534720` (OC Inlet NJ) → `8570283` (Ocean City Inlet, MD)
- Weather: buoy `44025` (40nm SE Manasquan NJ) → `44009` (Delaware Bay Entrance, ~38nm ESE of OC MD)
- Updated `BUOY_LAT`/`BUOY_LNG` (38.46, -74.692) and `BUOY_NAME` + code comments in Weather/index.tsx
- No other files affected

## 2026-05-29 (Step 4/4 — Pre-deploy cleanup, .gitignore, netlify.toml, README)
- Fixed `BubyData` typo → `BuoyData` in `src/sections/Weather/index.tsx` (TypeScript build error)
- Added `.gitignore` (node_modules, dist, .env, OS/editor junk)
- Added `netlify.toml` — `npm run build` + `dist` + SPA `/*` redirect for React Router
- Added `README.md` — full feature list, tech stack, data sources table, deploy steps, admin note
- Answered all 4 open questions: tides=OC Inlet 8534720, weather=NDBC 44025, SST history live, GitHub export steps documented

## 2026-05-29 (Step 3/4 — Mobile layout audit & fixes across all sections)
- `src/index.css`: global `env(safe-area-inset)`, 36px min touch targets, `-webkit-text-size-adjust`
- `src/components/Layout.tsx`: nav `overflow-x-auto` + `min-w-[52px]` per item + iOS safe-area bottom padding
- `src/sections/TacticalMap/index.tsx`: scrubber `w-[min(290px,calc(100vw-80px))]`, labels → 4-col grid
- `src/sections/Tides/index.tsx`: bell button enforced 36px target; type sizes use `sm:` scaling
- `src/sections/Weather/index.tsx`: source badge `items-start`+`break-all`; `src/sections/CatchLog/index.tsx`: GPS button `flex-shrink-0`+wrap; `src/sections/Dashboard/index.tsx`: outlook cells get card background

## 2026-05-29 (Rebuild AdminPanel at /admin — hidden route, password-gated)
- New file `src/sections/Admin/index.tsx` — full activation code manager
- Password gate (`ADMIN_PASSWORD` constant, default `offshore2024!`); show/hide toggle
- Generate 1–50 codes at once with optional note + expiry; codes stored in `localStorage` under `tactical_admin_codes`
- Filter All/Unused/Used; copy individual or all-unused; delete any code; stats bar (total/unused/used)
- Route `/admin` added to `src/App.tsx`; not linked from nav (intentionally hidden)

## 2026-05-29 (Fix ERDDAP — 5-proxy chain + (last) time dimension)
- Switched from specific date to `(last)` in griddap query — ERDDAP picks its newest file, eliminates 404s
- Proxy chain: direct → corsproxy.io → api.codetabs.com → allorigins.win/get → thingproxy.freeboard.io
- Added `codetabs` ProxyKind; ProxyDef now has `label` field for debugging
- Timeout bumped from 20s to 25s to give full 5-proxy chain more room
- Cache layer and formatSST untouched

## 2026-05-29 (Fix build error — semicolons in PROXIES array object literals)
- `src/lib/erddap.ts` lines 47-48: `{ kind: "prefix"; url: ... }` → `{ kind: "prefix", url: ... }`
- One-off typo (semicolons vs commas in object literals); no other files affected

## 2026-05-29 (Fix ERDDAP proxy — drop allorigins.win; chain direct→corsproxy→thingproxy)
- `allorigins.win` removed entirely — consistently returns 408 timeout for NOAA endpoints
- New proxy chain: direct fetch first (ERDDAP sometimes serves CORS directly), then `corsproxy.io`, then `thingproxy.freeboard.io`
- Unified `tryOneFetch(proxy, url, signal)` handles all proxy kinds — `direct`, `prefix`, `allorigins`
- 20s AbortController timeout across all proxy attempts combined
- User asked to share working PWA SST code for further reference

## 2026-05-29 (Fix ERDDAP CORS — switch allorigins /raw → /get endpoint)
- Root cause: `allorigins.win/raw` proxies content but does NOT add CORS headers → browser blocks
- `allorigins.win/get` wraps response as `{ contents: "<json>", status: { http_code } }` + always adds ACAO:*
- `tryProxiedFetch` now parses `wrapper.contents` via JSON.parse for allorigins, raw resp.json() for corsproxy
- LAND_SENTINEL symbol used to short-circuit loop on ERDDAP 400/404 without catching it as proxy failure
- `corsproxy.io` kept as fallback (also adds ACAO:*); `__ANIMA_DBG__` logs still present (to remove next pass)

## 2026-05-29 (Step 3/3 — Use getSSTCached in TacticalMap click handler)
- Removed all inline ERDDAP fetch logic from `TacticalMap/index.tsx` (~60 lines deleted)
- Now imports `getSSTCached` + `gibsSSTDate` from `src/lib/erddap.ts`
- Click handler calls `getSSTCached(lat, lng)` — returns cached value instantly if < 1 hr old
- Result shape changed: `result.fahrenheit` / `result.celsius` instead of old `result.value` string
- All 3 cache-plan steps complete; single shared ERDDAP helper with no duplicate code remains

## 2026-05-29 (Step 2/3 — Prefetch hotspot SSTs with hourly cache in Hotspots/index.tsx)
- Replaced per-card `fetchSSTfromERDDAP` calls with `prefetchSSTBatch` on mount → then `getSSTCached` per card
- `refreshSST` now clears `sst_cache_v1` before re-fetching so the button truly forces a fresh pull
- "Updated X min ago" label next to Refresh SST button via `getCacheAge()` + `cacheAge` state
- Subtitle updated: "Cached hourly" replaces "Live SST"
- No per-click ERDDAP fetch remains in Hotspots; data served from localStorage on repeat visits

## 2026-05-29 (Step 1/3 — Add hourly SST cache to src/lib/erddap.ts)
- Added `SSTCacheStore` interface: `batchFetchedAt` ISO + `entries` keyed by `lat_3dp:lng_3dp`
- `getSSTCached(lat, lng, updateBatchTimestamp?)` — returns cached `SSTResult` if < 1 hr old, else fetches + stores
- `prefetchSSTBatch(coords[])` — parallel `Promise.allSettled` warm-up; stamps `batchFetchedAt` once
- `getCacheAge()` — returns minutes since last batch fetch for UI "Updated X min ago" label
- Cache key rounds to 3 dp (≈111 m grid); TTL = 1 hour; localStorage key = `sst_cache_v1`

## 2026-05-29 (Fix ERDDAP CORS — route through corsproxy.io)
- Root cause: `coastwatch.pfeg.noaa.gov` stopped returning `Access-Control-Allow-Origin` headers
- Browser blocks response → `TypeError: Failed to fetch` → popup shows "unavailable"
- Fix: route full URL through `https://corsproxy.io/?url=<encoded>` in both `src/lib/erddap.ts` and `src/sections/TacticalMap/index.tsx`
- Removed misleading comment "CORS is open on coastwatch.pfeg.noaa.gov — no proxy needed" from both files
- No backend change needed; corsproxy.io adds `ACAO: *` server-side and forwards transparently

## 2026-05-29 (Wire Hotspots to live ERDDAP SST — todo hotspot-erddap)
- Extracted shared helper to `src/lib/erddap.ts`: `fetchSSTfromERDDAP`, `gibsSSTDate`, `formatSST`, `SSTResult` type
- Hotspots fetches all 5 coords on mount in parallel; per-card loading spinner (animate-spin RefreshCw) during fetch
- Live result shows orange temp + cyan "LIVE" badge; fallback shows static °F in slate if error/land/timeout
- "Refresh SST" button in header re-fires all 5 ERDDAP requests
- TacticalMap still has its own inline copy of the helper (unchanged); future refactor can import from lib/erddap

## 2026-05-29 (Plan COMPLETE — Replace GIBS pixel-sampling SST with ERDDAP griddap point queries)
- All 3 steps confirmed complete in `src/sections/TacticalMap/index.tsx`
- Step 1: `fetchSSTfromERDDAP(lat, lng)` — griddap URL `jplMURSST41.json`, 10s AbortController, `SSTResult` union
- Step 2: Click handler calls new helper; `map.hasLayer(popup)` guard prevents throw on closed popup; `sstFallbackLabel()` maps timeout/land/error to human strings
- Step 3: GIBS WMTS tile overlay kept as visual layer; legend reads "GIBS visual · ERDDAP point query · {date}"
- No canvas pixel-sampling or colormap reverse-engineering remains in codebase

## 2026-05-29 (GPS auto-fill on catch log)
- Added `grabGPS()` in `CatchLog/index.tsx` using `navigator.geolocation.getCurrentPosition` (high-accuracy, 10s timeout)
- "Stamp GPS" button in log form transitions through idle → loading (spinner) → ok (shows lat preview) → err states
- `gpsRef` stores `{lat,lng}` and is written to `CatchEntry` as `lat`/`lng` fields on save
- GPS coords display as cyan `MapPin` badge on each saved catch card
- Resets `gpsRef` + `gpsState` to idle on form close/save

## 2026-05-29 (Plan steps 2 & 3 — AbortController fallback labels + popup-closed guard)
- `fetchSSTatPoint` now returns `SSTResult` union: `{ok:true,value}` | `{ok:false,reason:"timeout"|"land"|"error"}`
- AbortError caught explicitly → `reason:"timeout"` so user sees "timed out" vs "land / no data" vs "unavailable"
- `sstFallbackLabel()` maps reason to human-readable string shown in popup
- Click handler guards with `map.hasLayer(popup)` check before calling `popup.setContent` — prevents throw on closed popup

## 2026-05-29 (Plan step 1/3 — Replace fetchSSTatPoint with canvas pixel-sampling)
- Removed WMTS GetFeatureInfo fetch (unreliable, frequent timeouts)
- New approach: calculate tile col/row + pixel I/J offset, fetch tile PNG with 5s AbortController timeout
- Draw blob onto OffscreenCanvas 256×256 via createImageBitmap, sample getImageData(I,J,1,1)
- Alpha=0 → land/no-data → return null; RGB mapped to kelvin via rgbToKelvin() heuristic (redness fraction)
- Colormap constants: SST_COLORMAP_MIN_K=271.15 K (blue/28°F) → SST_COLORMAP_MAX_K=305.15 K (red/89°F)

## 2026-05-29 (Plan step 1/3 — Replace fetchSSTatPoint with canvas pixel-sampling)
- Removed unreliable WMTS GetFeatureInfo fetch (frequent timeouts / no-data) from `TacticalMap/index.tsx`
- New: calculates tile col/row + pixel I/J offset for clicked lat/lng at zoom capped to 7
- Fetches tile PNG with 5s AbortController timeout, draws to OffscreenCanvas 256×256 via `createImageBitmap`
- Samples `getImageData(I,J,1,1)`; alpha=0 → land/masked → return null
- `rgbToKelvin(r,g,b)` maps redness fraction to 271–305 K range; converts to °F/°C

## 2026-05-29 (Fix Hotspots Leaflet map 0×0 pane — ResizeObserver + invalidateSize)
## 2026-05-29 (Plan step 1/3 — Replace fetchSSTatPoint with canvas pixel-sampling)
- Removed WMTS GetFeatureInfo fetch (unreliable, frequent timeouts)
- New approach: calculate tile col/row + pixel I/J offset, fetch tile PNG with 5s AbortController timeout
- Draw blob onto OffscreenCanvas 256×256 via createImageBitmap, sample getImageData(I,J,1,1)
- Alpha=0 → land/no-data → return null; RGB mapped to kelvin via rgbToKelvin() heuristic (redness fraction)
- Colormap constants: SST_COLORMAP_MIN_K=271.15 K (blue/28°F) → SST_COLORMAP_MAX_K=305.15 K (red/89°F)

## 2026-05-29 (Fix Hotspots Leaflet map 0×0 pane — ResizeObserver + invalidateSize)
- Root cause: `leaflet-map-pane` was 0×0 because Leaflet measured the flex container before layout settled
- Added `requestAnimationFrame(() => map.invalidateSize())` after map init so Leaflet re-measures after first paint
- Added `ResizeObserver` on `mapContainerRef.current` calling `map.invalidateSize()` on every resize (covers showMap toggle + orientation changes)
- `ro.disconnect()` added to cleanup alongside `map.remove()`

## 2026-05-29 (Root fix — missing Leaflet CSS import)
- `leaflet/dist/leaflet.css` was never imported in `src/main.tsx` — Leaflet panes couldn't position/stack correctly
- Without the CSS, pane z-index ordering (bathy=200/SST=300/overlay=400/labels=600) silently fails
- Added `import "leaflet/dist/leaflet.css"` before `./index.css` in `main.tsx`
- Both TacticalMap and Hotspots confirmed fully written with complete code (no "..." placeholders)

## 2026-05-29 (Write complete files — prior responses had "..." placeholders, never written)
- Both TacticalMap and Hotspots were confirmed intact in filesystem from earlier sessions
- Re-wrote both files completely with write_to_file to guarantee no truncation survives
- Hotspots map now also includes SST GIBS overlay + bathy reference overlay (not just CartoDB dark)
- TacticalMap: bathy-base z=200 → SST z=300 → bathy-overlay z=400 → labels/hotspots z=600
- Dev server restarted to serve complete code

## 2026-05-29 (Fix GIBS zoom cap — root cause of naturalWidth:0)
## 2026-05-29 (Fix GIBS zoom cap — root cause of naturalWidth:0)
- GIBS MUR SST only publishes tiles at zoom 1–7; map initializes at zoom 8 → all tiles returned blank
- Added `maxNativeZoom: 7, maxZoom: 14` to sstLayer → Leaflet now scales z=7 tiles for higher zooms
- Added `maxNativeZoom: 10` to both ArcGIS bathy layers for parity
- Refactored pane creation: each pane now has `pointerEvents: "none"` set immediately at creation, not after
- All 7 plan steps confirmed complete in current codebase

## 2026-05-29 (Layer ordering + hotspot markers on TacticalMap)
- Root cause of invisible SST: ArcGIS Ocean Base (opaque) was added AFTER SST, burying it
- Fixed with custom Leaflet panes: bathyBasePane z=200 → sstPane z=300 → bathyOverlayPane z=400 → labelPane z=600
- Added World_Ocean_Reference transparent overlay (z=400) so contour lines/depth labels appear above SST wash
- Ported HOTSPOTS array + confidenceColor() from Hotspots page into TacticalMap; 5 CircleMarkers + label icons + popups (SST, breakDelta, LORAN TDs, species) now render on /map
- Added hotspot confidence legend (top-left) + hotspot toggle button (Target icon, emerald)

## 2026-05-29 (Fix confirmed-broken SST/bathy + click-to-temp)
- Bathymetry: GEBCO tiles.gebco.net unreachable → replaced with ArcGIS Ocean Base (HTTP 200 confirmed working)
- SST: corsproxy.io→ERDDAP returns HTTP 525 (SSL fail) → replaced with NASA GIBS MUR WMTS (no proxy, HTTP 200 confirmed)
- SST date auto-calculated as `now − 3 days` via `gibsSSTDate()` so product is always published
- Click handler: popup now immediately shows "fetching…" then async-fetches GIBS GetFeatureInfo, parses Kelvin → °F/°C and updates popup; legend updated with date + "tap map for temp" hint

## 2026-05-29 (Wire all stub features — SST/Bathy layers, bells, weather expand)
- TacticalMap: added `sstLayerRef`/`bathyLayerRef` + two `useEffect` hooks reacting to `showSST`/`showBathy` state — NOAA ERDDAP WMS for SST, GEBCO ArcGIS tiles for bathy
- Solunar: `toggleReminder` now awaits `Notification.requestPermission()`, schedules a real `setTimeout→new Notification` 30 min before each period; `useEffect` cleanup cancels all timers on unmount
- Tides: same bell scheduling pattern as Solunar — 30-min-before `Notification` with `clearTimeout` on toggle-off
- Weather: GO/NO-GO card is now tap-to-expand; shows per-condition breakdown (wind/waves/vis/pressure) with `CheckCircle2`/`AlertTriangle`/`XCircle` icons and threshold labels

## 2026-05-29 (Full rebuild — source files were missing)
- Entire `src/` directory, `package.json`, `index.html`, `vite.config.ts` were missing from project
- Rebuilt complete PWA: Dashboard, TacticalMap (LORAN + canyon labels), CatchLog (stats panel), Solunar, Tides, Weather, Hotspots, Settings
- Re-implemented LORAN GRI-9960 calculations in both TacticalMap and Hotspots sections
- All core features restored: catch logging with charts, notification toggles, dark theme, responsive nav

## 2026-05-28 (Audit — catchlog-charts already complete)
- `StatsPanel` component confirmed fully implemented in `src/sections/CatchLog/index.tsx`
- Species aggregation, Count/Weight bar chart toggle, Personal Bests (heaviest + longest) all present
- `catchlog-charts` TODO marked done; surfaced 4 new high-impact TODOs

## 2026-05-28 (AdminPanel — Supabase env var wiring)
- Moved `SUPABASE_FUNCTION_URL` + `SUPABASE_ANON_KEY` out of hardcoded constants into `import.meta.env.VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
- Created `.env.local` template at project root with instructions
- Added amber config-warning banner in AdminPanel when env vars are missing/placeholder
- Generate Code button disabled (`disabled` + tooltip) until Supabase is properly configured
- Function URL auto-assembled: `${VITE_SUPABASE_URL}/functions/v1/generate-activation-code`

## 2026-05-28 (Push notifications — tide & solunar 30-min alerts)
- Added `requestNotificationPermission()` + `scheduleNotification()` helpers to both `SolunarForecast.tsx` and `TideSchedule.tsx`
- Each `FeedingPeriod` row now has a 🔔 toggle button; tap to arm a 30-min-before browser notification, tap again to cancel
- Next-tide highlight card has the same bell toggle wired to `nextTide.rawDatetime − 30 min`
- Reminders auto-cancel on component unmount via `useEffect` cleanup; denied permission shows a polite `alert()`

## 2026-05-28 (LORAN Plan v2 — all 3 steps complete)
- Root bugs fixed: was using `/ c` (wrong units) and wrong sign `(dSec − dMaster)` — both corrected
- Corrected formula: `TD = ED + (dMaster − dSecondary) * c` where `c = 6.177 μs/nm`
- ED_W = 28,691 μs; ED_X = 41,657 μs — back-calculated from NOAA anchor 37.28°N/74.52°W
- Anchor verification: W = 28691 + (343.3−643.8)×6.177 = **26,835** ✓  X = 41657 + (343.3−318.6)×6.177 = **41,810** ✓
- Validation table embedded in both files; formula confirmed correct in `HotspotsSection/index.tsx` + `MapCallToAction/index.tsx`

## 2026-05-28 (Fix LORAN station roles — wrong master/secondary assignment)
- Root cause: MASTER was `40.9283N/81.4929W` (phantom); Seneca NY was misplaced in SEC_X slot
- Correct GRI-9960: MASTER=Seneca NY (42.7137/76.8246), SEC_W=Caribou ME (46.8/67.9266), SEC_X=Nantucket MA (41.253/69.9775)
- Fixed in both `HotspotsSection/index.tsx` and `MapCallToAction/index.tsx` `toLoranTD()` functions
- Norfolk Canyon now yields W≈+48, X≈−5 as expected for Mid-Atlantic GRI-9960

## 2026-05-28 (Fix LORAN speed-of-light constant — wildly wrong TDs)
- Root cause: `c = 0.000164` was labelled "ms per nm" but used as μs/nm — off by factor of ~37.7×
- Correct value is `6.177 μs/nm` (speed of light in air ≈ 161,875 nm/s → 1/161875 s/nm = 6.177 μs/nm)
- Fixed in both `HotspotsSection/index.tsx` and `MapCallToAction/index.tsx` `toLoranTD()` functions
- Washington Canyon now shows W ≈ −8 μs / X ≈ +41 μs as expected for Mid-Atlantic GRI-9960

## 2026-05-28 (Add LORAN TDs to dynamic hotspot cards)
- Added `toLoranTD(lat, lng)` GRI-9960 helper to `HotspotsSection/index.tsx` (same formula as MapCallToAction)
- `loranW` and `loranX` computed per structure in `computeHotspots()` and stored on each `HotspotData` object
- Added `loranW?: string` and `loranX?: string` props to `HotspotCardProps` in `HotspotCard.tsx`
- LORAN row rendered beneath the gridReference line: `📡 LORAN W +xxxx / X +xxxx μs` in purple

## 2026-05-28 (Tactical Map Step 2 — SST ocean-only land mask)
- Added `LAND_MASK_POLY` (~35-vertex ring) tracing Mid-Atlantic shoreline: Cape May → NJ coast → VA Eastern Shore → Norfolk → Chesapeake Bay west shore → Delaware → back to Cape May
- `pointInLandPoly(lat, lng)` ray-casting test applied per-pixel in `renderSSTCanvas` — land pixels get alpha=0 (transparent), water pixels render normally
- SST heatmap no longer bleeds over NJ, Delaware, Maryland, Virginia, or Bay coastlines
- No Leaflet API changes; mask is pure canvas-level, so overlay/toggle/teardown logic unchanged

## 2026-05-28 (Remove canyon DivIcon labels — bathy tile already has them)
- Added `LAND_MASK_POLY` (~35-vertex ring) tracing Mid-Atlantic shoreline: Cape May → NJ coast → VA Eastern Shore → Norfolk → Chesapeake Bay west shore → Delaware → back to Cape May
- `pointInLandPoly(lat, lng)` ray-casting test applied per-pixel in `renderSSTCanvas` — land pixels get alpha=0 (transparent), water pixels render normally
- SST heatmap no longer bleeds over NJ, Delaware, Maryland, Virginia, or Bay coastlines
- No Leaflet API changes; mask is pure canvas-level, so overlay/toggle/teardown logic unchanged

## 2026-05-28 (Tactical Map Step 1 — Canyon name DivIcon labels)
- Added `CANYON_LABELS` array (9 canyons: Hudson, Baltimore, Wilmington, Toms, Spencer, Atlantis, Lindenkohl, Washington, Norfolk) to `MapCallToAction/index.tsx`
- `makeCanyonLabelIcon(name)` returns a dark semi-transparent pill DivIcon (non-interactive, no dot)
- Labels cleared + re-rendered inside `expanded` useEffect alongside hotspot markers; stored in `canyonLabelsRef`
- Teardown effect also clears `canyonLabelsRef` alongside map removal

## 2026-05-28 (Fix disqualification guard — primary-only veto + warm-side card title)
- Card `title` field now uses `Math.round(br.warmF)` instead of `br.midF` — consistent with species badge evaluation
- Disqualification guard narrowed: only `priority === "primary"` species can veto a structure (was primary+secondary)
- Guard switched from `every` (all must miss) → `some` (any primary miss) — stricter, intentional
- Secondary/tertiary species now influence score only, never disqualify structures outright

## 2026-05-28 (SST Break Overhaul — all 4 steps complete + warm-side badge fix)
- Step 1: pairing radius 150→75 km, delta threshold 1.5→2.0°F — forces genuine nearby thermal front
- Step 2: `speciesToScore()` evaluates `br.warmF` (warm side) — Mahi only score when warm water is in 72–82°F
- Step 3: disqualification guard drops structure if ALL primary/secondary species have `br.warmF < r.lo`
- Step 4: `breakTitle` (2.0/3.5/5.0°F tiers); confidence `64 + (delta-2.0)*8` → 64%@2°F, 88%@5°F, 96%@6°F
- `sstTemp` stored as `Math.round(br.warmF)` so species badge dots match the same warm-side evaluation

## 2026-05-28 (Map click popup — SST, lat/lon, LORAN TDs)
- Added `interpolateSST()` IDW function and `toLoranTD()` GRI-9960 calculator to `MapCallToAction/index.tsx`
- `map.on("click")` handler opens a dark `L.popup` at the clicked point showing SST °F, lat/lon in decimal degrees, and LORAN W + X TD values in μs
- Popup uses existing `fishing-map-popup` dark CSS class; cleans up prior click popup on each new click
- New `clickPopupRef` ref tracks the active popup; listener tears down on `expanded`/`sstGrid` dep changes

## 2026-05-28 (Sync Tactical Map with Dynamic Hotspot Engine — all 3 steps complete)
- `HotspotsSection` emits `LiveHotspot[]` via `onHotspotsChange` whenever `computedHotspots` changes
- `MainContent` holds `liveHotspots` state, passes setter as `onHotspotsChange`, forwards array to `MapCallToAction`
- `MapCallToAction` removed all static `MAP_HOTSPOTS`; renders markers exclusively from `liveHotspots` prop
- `focusHotspot` useEffect + `markersMapRef` wired: "View on Map" button pans map + opens popup for that pin
- Map and hotspot list now share exact same computed SST-break data — always perfectly in sync

## 2026-05-28 (Plan Step 2/4 — computeHotspots() dynamic engine)
- Built pure `computeHotspots(sstGrid, species, homeLat, homeLng)` function in `HotspotsSection/index.tsx`
- Algorithm: pairs all sstGrid pts within 150 km, flags ΔT ≥ 1.5°F breaks, attributes each to nearest of 7 named structures, merges by structure (max ΔT wins), scores by break width + species SST proximity, returns top-10
- Static `HOTSPOTS` array removed; replaced by `getFallbackHotspots()` (2-card minimal fallback used only when sstGrid < 3 pts)
- Removed hardcoded `DEFAULT_PRIMARY`/`DEFAULT_BACKUP` from `MainContent` — selection now seeded by live computed list
- `useMemo` wraps `computeHotspots` so it only reruns when `sstGrid`, `targetSpecies`, or `launchSite` changes

## 2026-05-28 (Plan Step 1/4 — Expose sstGrid into HotspotsSection)
- Added `sstGrid: SSTPoint[]` and `sstLoading: boolean` props to `HotspotsSectionProps` in `HotspotsSection/index.tsx`
- Imported `SSTPoint` type from `@/hooks/useMarineData` — no new hook call, type-only import
- `MainContent/index.tsx` now passes `marineData.sstGrid` and `marineData.loading` down to `HotspotsSection`
- Added `void sstGrid; void sstLoading;` guards to silence TS unused-var until Step 2 consumes them
- Single `useMarineData()` call in `MainContent` is the sole source — no duplicate HTTP requests

## 2026-05-28 (Fix map zoom — overflow-hidden + infinite re-render)
- Replaced `overflow-hidden` on map panel wrapper with `clip-path: inset(0 round 14px)` in `MapCallToAction/index.tsx` — was intercepting wheel/pinch events before they reached Leaflet
- Wrapped `handleSelectionChange` in `useCallback(…, [])` in `MainContent/index.tsx` — eliminates the infinite re-render loop caused by new function reference on every render
- Both fixes together restore scroll-wheel zoom and stop the Leaflet map from being destroyed/rebuilt every frame

## 2026-05-28 (Expand SST grid — Virginia Beach to Cape May)
- Replaced 9-point offshore-only `SST_GRID_POINTS` with 16-point coastal grid in `useMarineData.ts`
- New grid spans lat 36.85–38.93°N, lng -75.97–-73.8°W — covers full coastline VB → Cape May
- Added 4 rows: Virginia Beach shelf, mid-shelf, Delaware Bay approach, Cape May coast + 3 offshore deep-water anchors
- `MapCallToAction` overlay bounds auto-derive from min/max of grid pts — no canvas changes needed

## 2026-05-28 (Fix all SST overlay issues)
## 2026-05-28 (Expand SST grid — Virginia Beach to Cape May)
- Replaced 9-point offshore-only `SST_GRID_POINTS` with 16-point coastal grid in `useMarineData.ts`
- New grid spans lat 36.85–38.93°N, lng -75.97–-73.8°W — covers full coastline VB → Cape May
- Added 4 rows: Virginia Beach shelf, mid-shelf, Delaware Bay approach, Cape May coast + 3 offshore deep-water anchors
- `MapCallToAction` overlay bounds auto-derive from min/max of grid pts — no canvas changes needed

## 2026-05-28 (Fix all SST overlay issues)
- Removed duplicate `SST_GRID_POINTS_2` array in `useMarineData.ts`; parse loop now references the single `SST_GRID_POINTS` declared earlier in `fetchAll()`
- Increased SST canvas resolution from 256×256 → 512×512 in `MapCallToAction/index.tsx` for sharper overlay on large screens
- Tightened overlay bounds padding from 0.2° → 0.1° so the heatmap aligns more precisely to actual data points
- Added SST colour-scale legend bar ("cold → warm" gradient) inline in the map legend strip next to the SST ON/OFF toggle

## 2026-05-20 (Plan Step 2/3 — Fix Leaflet home-port marker stale closure)
- Extracted `homeMarkerRef` as a separate `useRef<L.Marker | null>` in `MapCallToAction/index.tsx`
- Home-port marker was previously created inside `if (!mapInstanceRef.current)` guard — captured first `HOME_PORT` value forever
- Fix: remove home marker from the guard; always remove + recreate it at the top of the main `useEffect` body so `launchSite` changes propagate correctly
- `launchSite` was already in the `useEffect` dependency array — marker now reflects the current site on every render

## 2026-05-20 (Plan Step 1/3 — Fix Header drawer positioning)
- Replaced `style={{ top: "calc(var(--header-h, 64px) + var(--banner-h, 40px))" }}` with `style={{ top: 104 }}`
- `--header-h` and `--banner-h` CSS variables were never written to the DOM, causing drawer to render at top:0 and overlap content
- Hard-coded 104px = 64px header + 40px EmergencyBanner — matches actual rendered heights

## 2026-05-20 (Gap remediation H6/H7/H8 — Dashboard live data + settings editor)

## 2026-05-20 (Gap remediation H6/H7/H8 — Dashboard live data + settings editor)
- H7: Dashboard "Next Tide" now driven by `useMarineData()` — shows real type (High/Low), time, height ft, countdown
- H6: Dashboard "Today's Catches" reads from `tactical_offshore_catches` localStorage — aggregates by species, empty state msg, live-updates on `storage` events
- H8: Vessel Settings collapsible panel added to Dashboard — edits `vesselSpeed`, `fuelBurnRate`, SST min/max; Save calls `onPreferencesChange` which persists via AppShell
- Added missing `onPreferencesChange` to `DashboardProps` interface (was already in AppShell but not declared in Dashboard)
- FloatPlan.tsx confirmed already fully patched (marineData, vesselSpeed, fuelBurnRate props, live tide/solunar, dynamic speed/fuel calc)

## 2026-05-20 (Fix AdminPanel compile crash — Dashboard blank screen)
- `React.ElementType` used as type in `AdminPanel.tsx` but `React` namespace was never imported
- Module failed to compile silently, causing the entire Dashboard tab to render as blank
- Fix: replaced `React.ElementType` with `ElementType` imported from `"react"` via `type ElementType`
- All Dashboard props (`preferences`, `launchSite`, `onLaunchSiteChange`) confirmed correctly wired in AppShell

## 2026-05-20 (Admin panel — step 2 of 3 — AdminPanel component)
## 2026-05-20 (Admin panel — step 2 of 3 — AdminPanel component)
- Created `src/sections/Dashboard/components/AdminPanel.tsx` with full Supabase Edge Function integration
- `SUPABASE_FUNCTION_URL` + `SUPABASE_ANON_KEY` constants at top of file; inline config warning if still using placeholder values
- `ActivationCode` type: `{ id, code, createdAt, status: "active"|"used"|"expired", note? }`; persisted under `tacticaloffshore_activation_codes` in localStorage
- Generate button POSTs to edge function with optional note; appends returned code to list; spinner + error banner on failure
- Code log: copy-to-clipboard, status toggle buttons (active/used/expired), delete, filter tabs, stats strip, formatted timestamps

## 2026-05-20 (Admin panel — step 1 of 3 — sub-tab + PIN gate)
- Added "Dashboard" / "Admin" sub-tab bar at the top of `Dashboard/index.tsx`
- `PinGate` component: PIN hardcoded as `"0451"`, persisted under `tacticaloffshore_admin_unlocked` in localStorage
- Wrong PIN triggers wiggle animation + red error text; correct PIN unlocks for the session
- Exported `AdminPanel` stub renders placeholder ready for step 2 (Supabase integration)
- All existing dashboard content (LaunchSiteSelector, conditions, tide, catches) preserved intact

## 2026-05-20 (Fix homeport: dynamic distance/map from selected launch site)
- `MapCallToAction` now accepts `launchSite` prop; `HOME_PORT` constant replaced with `homePort.lat/lng`
- Home port marker popup label now shows `homePort.name` (e.g. "Ocean City Inlet (MD)") instead of hardcoded "Virginia Beach Inlet"
- Added `haversineNm` helper in `MapCallToAction` — distance/travel in popup badges recalculate per `launchSite`
- `HotspotsSection` accepts `launchSite` prop; `haversineStatuteMi` helper added — `distance`/`travel` displayed on every card recalculate live
- `MainContent` passes `launchSite` to both `MapCallToAction` and `HotspotsSection`; map `useEffect` dependency array includes `launchSite`

## 2026-05-20 (Analysis share button)
- Added `handleShare` + `copied` state to `HotspotCard` — copies formatted text summary to clipboard
- Share button lives in the "Current Conditions" header row; pulses green with checkmark + "Copied!" for 2 s
- Exported text includes spot name, coords, grid ref, distance, all why-bullets, SST/Current/Depth/Chlorophyll, confidence
- Uses `navigator.clipboard.writeText` — no external deps; degrades silently if clipboard API unavailable

## 2026-05-20 (Restore View Analysis panel — steps 2 & 3 of 3 — COMPLETE)
## 2026-05-20 (Restore View Analysis panel — steps 2 & 3 of 3 — COMPLETE)
- Added `useState(false)` analysisOpen toggle to `HotspotCard`; "View Analysis" button wired to flip it
- Button label toggles "View Analysis" / "Hide Analysis" with animated chevron (rotates 180° when open)
- Analysis panel renders inline below the button when open: "Why This Spot" bullet list + 2×2 conditions grid
- Conditions grid shows SST, Current, Depth, Chlorophyll from `props.analysis` with dark card styling
- Full plan complete: data in step 1 → toggle in step 2 → panel JSX in step 3

## 2026-05-20 (Surface LaunchSite on Predict — step 3 of 3 — COMPLETE)
- Added `hideTrigger` prop to `LaunchSiteSelector` so the pill in MainContent mounts the sheet-only (no duplicate card)
- Dashboard correctly imports + uses shared `LaunchSiteSelector` with built-in card trigger — no duplicate logic
- AppShell threads `launchSite`/`setLaunchSite` to both Dashboard and MainContent from single `useLaunchSite()` call
- Full plan complete: shared component → pill on Predict → Dashboard in sync

## 2026-05-20 (Surface LaunchSite on Predict — step 2 of 3)
- Added `⚓ <site name> ▾` pill in `MainContent/index.tsx` below the PredictionOverview hero
- `LaunchSiteSelector` now accepts `defaultOpen` + `onClose` props so pill controls the sheet from outside
- `MainContent` gains `onLaunchSiteChange` prop; `AppShell` threads `setLaunchSite` down to it
- Tapping pill opens the full selector sheet; selecting a site closes it + persists via `useLaunchSite`

## 2026-05-20 (Surface LaunchSite on Predict — step 1 of 3)
- Created `src/components/LaunchSiteSelector.tsx` as a shared exported component
- Removed the private `LaunchSiteSelector` function from `Dashboard/index.tsx`
- Dashboard now imports from `@/components/LaunchSiteSelector` — behaviour unchanged
- Ready for step 2: compact pill trigger on the Predict screen header

## 2026-05-20 (Printed Float Plan — step 4 of 4 — COMPLETE)
- Added Departure Point section to `buildPrintHTML` output (blue left border, shows site.name + site.coords)
- All 4 plan steps now complete: hook → dashboard selector → prop chain → printed HTML
- Full chain verified: useLaunchSite (localStorage) → AppShell → MainContent → ForecastAndPlanning → FloatPlan (screen + print)

## 2026-05-20 (Wire launchSite through FloatPlan — step 3 of 4)
- `FloatPlan` subtitle, Departure Point card, Conditions Intel label, and printed HTML <div class="sub"> all use live `site.name`/`site.coords`
- `buildPrintHTML` call now passes `launchSiteName` and `launchSiteCoords` from `launchSite ?? DEFAULT_SITE`
- Full chain confirmed intact: AppShell → useLaunchSite → MainContent → ForecastAndPlanning → FloatPlan
- No changes needed to ForecastAndPlanning/index.tsx, MainContent/index.tsx, or AppShell.tsx (already wired)

## 2026-05-20 (LaunchSiteSelector in Dashboard — step 2 of 4)
- Added `LaunchSiteSelector` bottom-sheet component inside `Dashboard/index.tsx`
- Lists 4 PRESET_SITES with active check mark; custom entry form with lat/lng + name validation
- `Dashboard` now accepts `launchSite` + `onLaunchSiteChange` props (removed old `launchLocation` string)
- `AppShell` calls `useLaunchSite()` and threads `launchSite` / `setLaunchSite` down to Dashboard
- Selection persists immediately via existing hook; "Current Position" card now shows live launch site name

## 2026-05-20 (useLaunchSite hook — step 1 of 4)
- Created `src/hooks/useLaunchSite.ts` exporting `useLaunchSite()`, `LaunchSite` interface, `PRESET_SITES` array
- Defaults to Ocean City Inlet (38°19′48″N 75°09′24″W); persists under `"tacticaloffshore_launch_site"` in localStorage
- 4 preset sites: Ocean City Inlet (MD), Rudee Inlet (VA Beach), Wachapreague Inlet (VA), Indian River Inlet (DE)
- `setLaunchSite` writes to localStorage then updates React state; gracefully handles storage errors

## 2026-05-20 (share float plan — Blob URL fix)
- `handleSharePlan` in `FloatPlan.tsx` now uses `Blob + URL.createObjectURL` instead of `window.open("", "_blank") + document.write`
- Old approach was blocked by popup blockers (returned null in sandboxed preview); Blob URL is treated as real navigation and passes through
- Blob URL auto-revoked after 30 s via `setTimeout`; revoked immediately if `window.open` itself fails
- `buildPrintHTML` unchanged; `window.print()` in the page still fires automatically on load

## 2026-05-20 (fix Leaflet popup dark theme)
- Injected scoped CSS (`fishing-map-popup-css` style tag) via `useEffect` in `MapCallToAction`
- `.fishing-map-popup .leaflet-popup-content-wrapper` forced to `#1e2332` bg, light text, dark tip
- Pill badges rebuilt with `inline-flex`, `#0f172a` bg, explicit `color:#cbd5e1` + border so they render correctly
- All `bindPopup()` calls now pass `{ className: "fishing-map-popup" }` to scope the override
- Distance / travel / confidence badges now fully visible with contrasting dark background

## 2026-05-20 (SST heatmap overlay on tactical map)
- Added `renderSSTCanvas()` to `MapCallToAction/index.tsx`: IDW-interpolates 9 grid SST points onto a 256×256 canvas (blue→teal→green→yellow→red gradient, 47% opacity)
- `MapCallToAction` now accepts `sstGrid?: SSTPoint[]` prop; `L.imageOverlay` renders the canvas as a map layer
- `sstOverlayRef` tracks the overlay; redraws on `[sstGrid, sstVisible, expanded]` changes
- "SST ON/OFF" toggle button in the legend bar appears when grid data is available
- `MainContent` now passes `marineData.sstGrid` down to `MapCallToAction`; `SSTPoint` type already exported from `useMarineData.ts`

## 2026-05-20 (marine weather strip — step 3)
- Created `src/sections/ForecastAndPlanning/components/WeatherStrip.tsx`
- Fetches open-meteo marine API: wind speed/dir, wave height, precip probability for 5 days
- Groups hourly data into per-day cards with condition icon, wind in knots, wave height in ft, precip %
- Today card highlighted with blue gradient; GO / MARGINAL / NO-GO safety status bar driven by live values
- Slotted into `ForecastAndPlanning/index.tsx` above SolunarForecast; no changes to other files

## 2026-05-20 (live countdown timers)
- Added `formatCountdown(target)` utility export to `useMarineData.ts` (ticks h/m/s)
- `TideSchedule`: `useCountdown` hook ticks every second; green pulsing dot + "in Xh Ym" shows beneath next-tide height
- `SolunarForecast`: `PeriodRow` component has its own per-period countdown; `NextMajorCountdown` in the Next Major Period card
- All countdowns recompute from live `Date.now()` on a 1s interval, auto-clean up on unmount

## 2026-05-20 (interactive Leaflet map)
- Replaced static MapCallToAction button with collapsible Leaflet map panel (dark CartoDB tiles)
- `MAP_HOTSPOTS` array binds each of the 10 hotspots to real lat/lng coords off Virginia/Maryland coast
- Primary hotspot → green marker + solid green route line; Backup → blue marker + dashed blue line; home port → amber anchor
- Markers show rank badge; tap opens popup with title, coords, SST break, distance, travel, confidence
- `MapCallToAction` now accepts `primaryHotspot`/`backupHotspot` props threaded from `MainContent`; selections update map live

## 2026-05-20 (live API integration)
- Created `src/hooks/useMarineData.ts`: fetches NOAA CO-OPS tides (station 8570283), open-meteo marine SST, computes solunar periods via astronomical moon-transit algorithm; auto-refreshes every 15 min
- `TideSchedule` now accepts `nextTide`/`upcomingTides`/`loading` props; skeleton loaders while fetching
- `SolunarForecast` now accepts `solunar`/`loading` props; moon phase, illumination, rating, and feeding periods are all computed live
- `LiveDataSources` shows real last-updated timestamp + "Live"/"N/A" status per source
- `MainContent` calls `useMarineData()` once and threads `marineData` down through `ForecastAndPlanning` and `LiveDataSources`

## 2026-05-20 (float plan sync fix)
- Added `useEffect` in HotspotsSection/index.tsx that fires `onSelectionChange` on `[targetSpecies, primaryRank, backupRank]`
- FloatPlan Primary/Secondary now update live when species changes re-sort the top-10 list
- No changes to MainContent, FloatPlan, or any other file

## 2026-05-20 (species selector overhaul)
- Added Yellowfin Tuna (65–80°F, optimal 72°F) to SPECIES list in TargetSpeciesSelector.tsx
- Reworked `handlePillClick`: single-click assigns next open slot (1→2→3); tapping selected removes it and compacts remaining slots up
- `SelectedSpecies.priority` now supports `"tertiary"` as a 3rd slot; pills show numbered badge 1/2/3
- `getMatchingSpeciesLabels` and `getRelevanceScore` in HotspotsSection updated for tertiary (score: primary=3, secondary=2, tertiary=1)
- Legend updated to show all 3 priority tiers with distinct colors (green/blue/orange)

## 2026-05-20 (Dashboard tab)
- Created `src/sections/Dashboard/index.tsx` with `Dashboard` named export + `Preferences` interface
- AppShell: imported Dashboard; replaced "coming soon" dashboard placeholder with full component
- Dashboard receives default preferences (vesselSpeed, launchLocation, SST range, etc.) from AppShell
- All 4 bottom nav tabs now render real content — no more placeholders

## 2026-05-20 (WaypointsView + CatchLog integration)
- Created `src/sections/WaypointsView/index.tsx` from user-provided component (named export `WaypointsView`)
- AppShell: imported WaypointsView; replaced "coming soon" waypoints placeholder with full component
- CatchLog was already integrated from previous session; confirmed correct named export + localStorage persistence
- Dashboard tab is the only remaining placeholder tab

## 2026-05-20 (bottom nav + menu drawer)
- BottomNavigation: added Tab type, internal `localTab` state, `onTabChange` prop; active tab highlights live on tap
- BottomNavigationItem: added `isActive` + `onClick` props; buttons are now interactive with transition-colors
- Header: added `menuOpen` useState; hamburger now toggles a slide-down drawer with 5 menu items + backdrop dismiss
- MenuButton: added `onClick` prop + `active:opacity-70` feedback; all bottom nav drift items marked ✅
- AppShell: added `relative` to outer wrapper so drawer positions correctly

## 2026-05-20 (drift fixes — step 3 reconciliation)
- Lines-In input now controlled via `useState` in FloatPlan; all 6 timeline times recalculate live on change
- FloatPlan Solunar Activity block filled in (moon phase, major/minor feeding periods)
- `targetSpecies` lifted from HotspotsSection to MainContent; shared between HotspotsSection + PredictionOverview
- PredictionOverview now accepts `targetSpecies` prop; "Target:" line reflects selected species dynamically
- HotspotsSection accepts optional `targetSpecies`/`onSpeciesChange` props (falls back to internal state if not passed)

## 2026-05-20 (float plan wiring)
- Lifted hotspot selection state to MainContent; exported `SelectedHotspot` type from HotspotsSection/index.tsx
- Added `onSetPrimary`/`onSetBackup`/`onClear` callback props to HotspotCard; buttons are now active
- HotspotsSection manages `primaryRank`/`backupRank` state; fires `onSelectionChange` callback up
- ForecastAndPlanning and FloatPlan now accept `primaryHotspot`/`backupHotspot` props
- FloatPlan fully rewritten: all times (departure, decisions, ETA, home) computed dynamically from selected hotspot travel time

## 2026-05-20 (sort fix)
- Extracted 10 hotspots into `HOTSPOTS: HotspotData[]` array in HotspotsSection/index.tsx
- Added `getRelevanceScore()`: primary match = 2pts, secondary = 1pt; ties keep original rank
- `sortedHotspots` derived via `[...HOTSPOTS].sort()` on every render — cards reorder live
- Added `__ANIMA_DBG__` logs for score per hotspot and final sort order

## 2026-05-20
- Added Sailfish, White Marlin, Sea Bass, Golden Tilefish (renamed Marlin → Blue Marlin) to SPECIES list
- Rebuilt TargetSpeciesSelector: multi-select with tap-once=Primary / tap-twice=Secondary / tap-again=Remove
- Added `SelectedSpecies[]` state to HotspotsSection; `getMatchingSpeciesLabels()` drives per-card species tags
- HotspotCard gained `matchingSpecies?: string[]` prop; tags now show green (1°) or blue (2°) by priority
- Blended SST range displayed in selector strip when multiple species selected
</changelog>
