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
  if (offsetDays === 0) return "Now";
  return `${offsetDays * 12}h ago`;
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
  const resp = await fetch(`${PROXY_BASE}?${qs}`, { signal });
  if (!resp.ok) {
    throw new Error(`Proxy HTTP ${resp.status}`);
  }
  return (await resp.json()) as ProxyResponse;
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
    return { ok: false, reason: reason === "land" ? "land" : "error" };
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err instanceof Error && err.name === "AbortError";
    return { ok: false, reason: isAbort ? "timeout" : "error" };
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
    return { ok: false, reason: reason === "land" ? "land" : "error" };
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err instanceof Error && err.name === "AbortError";
    return { ok: false, reason: isAbort ? "timeout" : "error" };
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
    if (age < CACHE_TTL_MS) return entry.result;
  }

  const result = await fetchSSTfromERDDAP(lat, lng);

  store.entries[key] = { result, fetchedAt: new Date().toISOString() };
  if (updateBatchTimestamp) store.batchFetchedAt = new Date().toISOString();
  saveStore(store);
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
    if (age < CACHE_TTL_MS) return entry.result;
  }

  const result = await fetchSSTBBox(bbox);

  store.entries[key] = { result, fetchedAt: new Date().toISOString() };
  if (updateBatchTimestamp) store.batchFetchedAt = new Date().toISOString();
  saveStore(store);
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
