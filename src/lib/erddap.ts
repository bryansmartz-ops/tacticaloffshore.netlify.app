/**
 * ERDDAP SST helper — v4 (proxy-routed)
 *
 * All live SST fetches now go through the Netlify serverless proxy at
 *   /.netlify/functions/sst-proxy
 * instead of hitting ERDDAP endpoints directly from the browser.
 *
 * Benefits:
 *   - Zero CORS issues in production
 *   - ERDDAP URLs stay server-side
 *   - ACSPO primary / MUR fallback logic lives in one place (the proxy)
 *
 * Public API (unchanged from v3):
 *   fetchSSTBBox(bbox)          → SSTResult
 *   fetchSSTfromERDDAP(lat,lng) → SSTResult  (backwards compat point query)
 *   getSSTCached(lat,lng)       → SSTResult  (cached point)
 *   getSSTBBoxCached(bbox)      → SSTResult  (cached bbox)
 *   prefetchSSTBatch(coords)    → void
 *   getCacheAge()               → number | null
 *   formatSST(result, fallback) → { text, live }
 *   getLastValidSST(key)        → { fahrenheit, celsius, fetchedAt } | null
 *
 * Cache behaviour (v3 → v4 change):
 *   - ok:false results are NEVER written to the cache so the next call always retries live
 *   - A separate localStorage key (sst_last_valid_v1) stores only ok:true results
 *     keyed identically to the main cache — survives page reloads and TTL expiry
 *   gibsSSTDate / gibsSSTTileUrl / gibsSSTLabel  (GIBS tile helpers)
 */

export interface BBoxQuery {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export type SSTResult =
  | {
      ok: true;
      celsius: number;
      fahrenheit: number;
      pixelCount: number;
      dataset: string;
      resolution: "0.02deg" | "0.01deg";
    }
  | { ok: false; reason: "timeout" | "land" | "error" };

const PROXY_BASE = "/.netlify/functions/sst-proxy";

export function gibsSSTDate(lagDays = 3): string {
  const d = new Date();
  d.setDate(d.getDate() - lagDays);
  return d.toISOString().slice(0, 10);
}

export function gibsSSTTileUrl(offsetDays = 0): string {
  const date = gibsSSTDate(3 + offsetDays);
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GHRSST_L4_MUR_Sea_Surface_Temperature/default/${date}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`;
}

export function gibsSSTLabel(offsetDays: number): string {
  if (offsetDays === 0) return "Today";
  if (offsetDays === 1) return "-1 Day";
  if (offsetDays === 2) return "-2 Day";
  return `-${offsetDays} Day`;
}

type ProxyResponse =
  | {
      ok: true;
      tempC: number;
      tempF: number;
      pixelCount: number;
      dataset: string;
      resolution: "0.02deg" | "0.01deg";
    }
  | { ok: false; reason: string };

const FETCH_TIMEOUT_MS = 25_000;

async function callProxy(
  params: Record<string, string>,
  signal: AbortSignal,
): Promise<ProxyResponse> {
  const qs = new URLSearchParams(params).toString();
  const url = `${PROXY_BASE}?${qs}`;
  try {
    const resp = await fetch(url, { signal });
    if (!resp.ok) {
      throw new Error(`Proxy HTTP ${resp.status}`);
    }
    return (await resp.json()) as ProxyResponse;
  } catch (err) {
    throw err;
  }
}

export async function fetchSSTBBox(bbox: BBoxQuery): Promise<SSTResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const proxy = await callProxy(
      {
        minLat: bbox.minLat.toString(),
        maxLat: bbox.maxLat.toString(),
        minLng: bbox.minLng.toString(),
        maxLng: bbox.maxLng.toString(),
      },
      controller.signal,
    );

    clearTimeout(timer);

    if (proxy.ok) {
      return {
        ok: true,
        celsius: proxy.tempC,
        fahrenheit: proxy.tempF,
        pixelCount: proxy.pixelCount,
        dataset: proxy.dataset,
        resolution: proxy.resolution,
      };
    }

    const reason = proxy.reason as "timeout" | "land" | "error";
    console.warn(
      `[erddap] fetchSSTBBox failed — reason: ${reason} | bbox: ${bbox.minLat},${bbox.maxLat},${bbox.minLng},${bbox.maxLng}`,
    );
    return { ok: false, reason: reason === "land" ? "land" : "error" };
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err instanceof Error && err.name === "AbortError";
    const reason = isAbort ? "timeout" : "error";
    console.warn(
      `[erddap] fetchSSTBBox exception — reason: ${reason} | bbox: ${bbox.minLat},${bbox.maxLat},${bbox.minLng},${bbox.maxLng} | err: ${err}`,
    );
    return { ok: false, reason };
  }
}

export async function fetchSSTfromERDDAP(
  lat: number,
  lng: number,
): Promise<SSTResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const proxy = await callProxy(
      { lat: lat.toString(), lng: lng.toString() },
      controller.signal,
    );

    clearTimeout(timer);

    if (proxy.ok) {
      return {
        ok: true,
        celsius: proxy.tempC,
        fahrenheit: proxy.tempF,
        pixelCount: proxy.pixelCount,
        dataset: proxy.dataset,
        resolution: proxy.resolution,
      };
    }

    const reason = proxy.reason as "timeout" | "land" | "error";
    console.warn(
      `[erddap] fetchSSTfromERDDAP failed — reason: ${reason} | lat: ${lat}, lng: ${lng}`,
    );
    return { ok: false, reason: reason === "land" ? "land" : "error" };
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err instanceof Error && err.name === "AbortError";
    const reason = isAbort ? "timeout" : "error";
    console.warn(
      `[erddap] fetchSSTfromERDDAP exception — reason: ${reason} | lat: ${lat}, lng: ${lng} | err: ${err}`,
    );
    return { ok: false, reason };
  }
}

export function formatSST(
  result: SSTResult,
  staticFahrenheit: number,
): { text: string; live: boolean } {
  if (result.ok) {
    return { text: `${result.fahrenheit.toFixed(1)}°F`, live: true };
  }
  return { text: `${staticFahrenheit}°F`, live: false };
}

const CACHE_VERSION = "sst_cache_v2";
const LAST_VALID_VERSION = "sst_last_valid_v1";
const CACHE_TTL_MS = 60 * 60 * 1000;

interface CacheEntry {
  result: SSTResult;
  fetchedAt: string;
}

interface SSTCacheStore {
  batchFetchedAt: string;
  entries: Record<string, CacheEntry>;
}

function bboxCacheKey(bbox: BBoxQuery): string {
  return `${bbox.minLat.toFixed(3)}:${bbox.maxLat.toFixed(3)}:${bbox.minLng.toFixed(3)}:${bbox.maxLng.toFixed(3)}`;
}

function pointCacheKey(lat: number, lng: number): string {
  const snap = (v: number) => (Math.round(v / 0.05) * 0.05).toFixed(3);
  return `pt:${snap(lat)}:${snap(lng)}`;
}

function loadStore(): SSTCacheStore {
  try {
    const raw = localStorage.getItem(CACHE_VERSION);
    if (raw) return JSON.parse(raw) as SSTCacheStore;
  } catch {}
  return { batchFetchedAt: new Date(0).toISOString(), entries: {} };
}

// ─── Last-valid SST persistence ────────────────────────────────────────────

export interface LastValidSST {
  fahrenheit: number;
  celsius: number;
  fetchedAt: string; // ISO string
}

function loadLastValidStore(): Record<string, LastValidSST> {
  try {
    const raw = localStorage.getItem(LAST_VALID_VERSION);
    if (raw) return JSON.parse(raw) as Record<string, LastValidSST>;
  } catch {}
  return {};
}

function saveLastValidStore(store: Record<string, LastValidSST>): void {
  try {
    localStorage.setItem(LAST_VALID_VERSION, JSON.stringify(store));
  } catch {}
}

function persistLastValid(key: string, result: SSTResult & { ok: true }): void {
  const store = loadLastValidStore();
  store[key] = {
    fahrenheit: result.fahrenheit,
    celsius: result.celsius,
    fetchedAt: new Date().toISOString(),
  };
  saveLastValidStore(store);
}

/**
 * Returns the most recent ok:true SST reading for this cache key,
 * regardless of TTL — or null if no successful read has ever been stored.
 */
export function getLastValidSST(key: string): LastValidSST | null {
  const store = loadLastValidStore();
  return store[key] ?? null;
}

/**
 * Convenience: look up last-valid by bbox (same key format as cache).
 */
export function getLastValidSSTBBox(bbox: BBoxQuery): LastValidSST | null {
  return getLastValidSST(bboxCacheKey(bbox));
}

/**
 * Convenience: look up last-valid by lat/lng point (same key format as cache).
 */
export function getLastValidSSTPoint(
  lat: number,
  lng: number,
): LastValidSST | null {
  return getLastValidSST(pointCacheKey(lat, lng));
}

function saveStore(store: SSTCacheStore): void {
  try {
    localStorage.setItem(CACHE_VERSION, JSON.stringify(store));
  } catch {}
}

export function getCacheAge(): number | null {
  const store = loadStore();
  const ts = new Date(store.batchFetchedAt).getTime();
  if (!ts || ts === new Date(0).getTime()) return null;
  return Math.floor((Date.now() - ts) / 60_000);
}

export async function getSSTCached(
  lat: number,
  lng: number,
  updateBatchTimestamp = false,
): Promise<SSTResult> {
  const key = pointCacheKey(lat, lng);
  const store = loadStore();
  const entry = store.entries[key];

  if (entry) {
    const age = Date.now() - new Date(entry.fetchedAt).getTime();
    if (age < CACHE_TTL_MS && entry.result.ok) return entry.result;
  }

  const result = await fetchSSTfromERDDAP(lat, lng);

  if (result.ok) {
    // Only cache successes — failures should always retry live on next call
    store.entries[key] = { result, fetchedAt: new Date().toISOString() };
    if (updateBatchTimestamp) store.batchFetchedAt = new Date().toISOString();
    saveStore(store);
    persistLastValid(key, result);
  } else {
    console.warn(
      `[erddap] getSSTCached: skipping cache write for failed result at key="${key}"`,
    );
  }

  return result;
}

export async function getSSTBBoxCached(
  bbox: BBoxQuery,
  updateBatchTimestamp = false,
): Promise<SSTResult> {
  const key = bboxCacheKey(bbox);
  const store = loadStore();
  const entry = store.entries[key];

  if (entry) {
    const age = Date.now() - new Date(entry.fetchedAt).getTime();
    if (age < CACHE_TTL_MS && entry.result.ok) return entry.result;
  }

  const result = await fetchSSTBBox(bbox);

  if (result.ok) {
    // Only cache successes — failures should always retry live on next call
    store.entries[key] = { result, fetchedAt: new Date().toISOString() };
    if (updateBatchTimestamp) store.batchFetchedAt = new Date().toISOString();
    saveStore(store);
    persistLastValid(key, result);
    return result;
  }

  // ERDDAP failed — try last-valid persisted reading before giving up
  const lastValid = getLastValidSST(key);
  if (lastValid) {
    console.warn(
      `[erddap] getSSTBBoxCached: ERDDAP failed for key="${key}", returning last-valid SST ${lastValid.fahrenheit.toFixed(1)}°F from ${lastValid.fetchedAt}`,
    );
    return {
      ok: true,
      celsius: lastValid.celsius,
      fahrenheit: lastValid.fahrenheit,
      pixelCount: 0,
      dataset: "last-valid",
      resolution: "0.02deg",
    };
  }

  console.warn(
    `[erddap] getSSTBBoxCached: skipping cache write for failed result at key="${key}" — no last-valid available`,
  );
  return result;
}

export async function prefetchSSTBatch(
  coords: Array<{ lat: number; lng: number }>,
): Promise<void> {
  await Promise.allSettled(
    coords.map(({ lat, lng }) => getSSTCached(lat, lng, true)),
  );
  const store = loadStore();
  store.batchFetchedAt = new Date().toISOString();
  saveStore(store);
}
