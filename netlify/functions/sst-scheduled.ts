/**
 * Netlify Scheduled Function — SST Hotspot Scanner
 * Schedule: twice daily (00:00 and 12:00 UTC)
 *
 * DUAL-WRITE STRATEGY:
 *   1. Primary: POST full detail to Supabase edge function (grid-level data)
 *   2. Mirror:  POST summary record to Anima Playground HotspotLog entity (UI history)
 *
 * Required env vars (set in Netlify UI):
 *   SUPABASE_URL            e.g. https://xxxx.supabase.co
 *   SUPABASE_ANON_KEY       anon/public key from Supabase dashboard
 *   ANIMA_PLAYGROUND_API_URL  e.g. https://api.animaapp.com/playground/v1  (or your project URL)
 *   ANIMA_PLAYGROUND_API_KEY  service key from Anima Playground settings
 */

import type { Config } from "@netlify/functions";
import * as crypto from "crypto";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SCHEDULE = "0 0,12 * * *";

const ERDDAP_ENDPOINTS = [
  "https://coastwatch.pfeg.noaa.gov/erddap",
  "https://upwell.pfeg.noaa.gov/erddap",
  "https://oceanview.pfeg.noaa.gov/erddap",
  "https://erddap.ifremer.fr/erddap",
  "https://erddap.marine.ie/erddap",
];

// Mirrors HOTSPOT_DEFS in src/lib/hotspots.ts — keep in sync.
// Ambient coords are 0.75° west of each hotspot (inshore shelf reference).
const KNOWN_STRUCTURE = [
  {
    name: "Hudson Canyon Rip",
    lat: 39.52,
    lng: -72.05,
    ambLat: 39.52,
    ambLng: -72.8,
  },
  {
    name: "Spencer Canyon (OC, MD)",
    lat: 39.05,
    lng: -72.7,
    ambLat: 39.05,
    ambLng: -73.45,
  },
  {
    name: "Atlantis Canyon",
    lat: 39.38,
    lng: -72.25,
    ambLat: 39.38,
    ambLng: -73.0,
  },
  {
    // Corrected to shelf-break canyon head (~200m isobath) — matches hotspots.ts
    name: "Baltimore Canyon",
    lat: 38.01,
    lng: -74.05,
    ambLat: 38.01,
    ambLng: -74.8,
  },
  {
    name: "Wilmington Canyon Ledge",
    lat: 38.52,
    lng: -73.42,
    ambLat: 38.52,
    ambLng: -74.15,
  },
  {
    name: "Washington Canyon Break",
    lat: 37.55,
    lng: -74.35,
    ambLat: 37.55,
    ambLng: -75.1,
  },
  {
    name: "Norfolk Canyon Edge",
    lat: 37.05,
    lng: -74.65,
    ambLat: 37.05,
    ambLng: -75.4,
  },
  {
    name: "Diamond Shoals / Cape Hatteras",
    lat: 35.15,
    lng: -75.2,
    ambLat: 35.15,
    ambLng: -75.95,
  },
];

const BBOX_PAD = 0.15; // degrees (~17 km box per hotspot)
const FETCH_TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// Env-var validation
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

// ---------------------------------------------------------------------------
// ERDDAP helpers
// ---------------------------------------------------------------------------

function buildErddapUrl(
  base: string,
  minLat: number,
  maxLat: number,
  minLng: number,
  maxLng: number,
): string {
  const time = "last";
  return (
    `${base}/griddap/jplMURSST41.json?analysed_sst` +
    `[(${time})][(${minLat}):(${maxLat})][(${minLng}):(${maxLng})]`
  );
}

async function fetchBBoxSST(
  minLat: number,
  maxLat: number,
  minLng: number,
  maxLng: number,
): Promise<number | null> {
  for (const base of ERDDAP_ENDPOINTS) {
    const url = buildErddapUrl(base, minLat, maxLat, minLng, maxLng);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const json = (await res.json()) as {
        rows?: [number, number, number, number][];
      };
      const rows = json.rows ?? [];
      const temps: number[] = rows
        .map((r) => r[3])
        .filter((v) => v != null && !Number.isNaN(v));
      if (temps.length === 0) continue;
      const avgK = temps.reduce((a, b) => a + b, 0) / temps.length;
      return ((avgK - 273.15) * 9) / 5 + 32; // Kelvin → °F
    } catch {
      // try next endpoint
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function computeConfidence(tempF: number, breakDelta: number): number {
  const sstScore = Math.max(0, Math.min(25, ((tempF - 65) / 15) * 25));
  const breakScore = Math.max(0, Math.min(25, (breakDelta / 4) * 25));
  return Math.round(Math.min(95, Math.max(40, 50 + sstScore + breakScore)));
}

function speciesFromSST(tempF: number): string[] {
  const list: string[] = [];
  if (tempF >= 60 && tempF <= 68) list.push("Bluefin Tuna");
  if (tempF >= 65 && tempF <= 75) list.push("Bigeye Tuna");
  if (tempF >= 70 && tempF <= 80) list.push("Yellowfin Tuna");
  if (tempF >= 70) list.push("White Marlin");
  if (tempF >= 74) list.push("Wahoo");
  if (tempF >= 78) list.push("Mahi Mahi");
  if (tempF < 65) list.push("Swordfish");
  return list.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Supabase writer (full grid detail)
// ---------------------------------------------------------------------------

async function logToSupabase(
  supabaseUrl: string,
  supabaseKey: string,
  payload: object,
): Promise<void> {
  const url = `${supabaseUrl}/functions/v1/make-server-8db09b0a/hotspot-logs`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${supabaseKey}`,
      apikey: supabaseKey,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`Supabase log failed ${res.status}: ${body}`);
  }
}

// ---------------------------------------------------------------------------
// Playground writer (summary → HotspotLog entity)
// ---------------------------------------------------------------------------

async function mirrorToPlayground(
  apiUrl: string,
  apiKey: string,
  summary: {
    timestamp: string;
    targetSpecies: string;
    hotspotsCount: number;
    breaksFound: number;
    gridPoints: number;
    dataHash: string;
    source: string;
  },
): Promise<void> {
  const url = `${apiUrl}/entities/HotspotLog`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(summary),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    throw new Error(`Playground mirror failed ${res.status}: ${body}`);
  }
}

// ---------------------------------------------------------------------------
// Deduplication hash
// ---------------------------------------------------------------------------

function generateHash(data: object): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(data))
    .digest("hex")
    .slice(0, 16);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

const scheduledHandler = async () => {
  // Validate env vars up front — fail loudly so Netlify logs are clear
  let supabaseUrl: string, supabaseKey: string;
  let playgroundApiUrl: string, playgroundApiKey: string;
  try {
    supabaseUrl = requireEnv("SUPABASE_URL");
    supabaseKey = requireEnv("SUPABASE_ANON_KEY");
    playgroundApiUrl = requireEnv("ANIMA_PLAYGROUND_API_URL");
    playgroundApiKey = requireEnv("ANIMA_PLAYGROUND_API_KEY");
  } catch (e) {
    console.error("[sst-scheduled] Env var error:", (e as Error).message);
    return { statusCode: 500, body: (e as Error).message };
  }

  const timestamp = new Date().toISOString();
  console.log(`[sst-scheduled] Starting scan at ${timestamp}`);

  // Scan all hotspots in parallel
  const results = await Promise.allSettled(
    KNOWN_STRUCTURE.map(async (h) => {
      const [hotF, ambF] = await Promise.all([
        fetchBBoxSST(
          h.lat - BBOX_PAD,
          h.lat + BBOX_PAD,
          h.lng - BBOX_PAD,
          h.lng + BBOX_PAD,
        ),
        fetchBBoxSST(
          h.ambLat - BBOX_PAD,
          h.ambLat + BBOX_PAD,
          h.ambLng - BBOX_PAD,
          h.ambLng + BBOX_PAD,
        ),
      ]);
      const hotTemp = hotF ?? 72; // fallback if ERDDAP down
      const ambTemp = ambF ?? hotTemp - 2;
      const breakDelta = Math.max(0, hotTemp - ambTemp);
      return {
        name: h.name,
        lat: h.lat,
        lng: h.lng,
        sstF: hotTemp,
        ambientF: ambTemp,
        breakDelta: parseFloat(breakDelta.toFixed(1)),
        confidence: computeConfidence(hotTemp, breakDelta),
        species: speciesFromSST(hotTemp),
        erddapLive: hotF !== null,
      };
    }),
  );

  const hotspots = results
    .filter(
      (
        r,
      ): r is PromiseFulfilledResult<
        (typeof results)[0] extends PromiseFulfilledResult<infer T> ? T : never
      > => r.status === "fulfilled",
    )
    .map((r) => r.value);

  const breaksFound = hotspots.filter((h) => h.breakDelta > 1).length;
  const gridPoints = hotspots.length * 2; // hotspot + ambient per site
  const dataHash = generateHash({
    timestamp: timestamp.slice(0, 13),
    hotspots,
  });
  const targetSpecies = hotspots[0]?.species[0] ?? "Mixed";

  const supabasePayload = {
    timestamp,
    dataHash,
    hotspots,
    summary: {
      hotspotsCount: hotspots.length,
      breaksFound,
      gridPoints,
      targetSpecies,
    },
  };

  const playgroundSummary = {
    timestamp,
    targetSpecies,
    hotspotsCount: hotspots.length,
    breaksFound,
    gridPoints,
    dataHash,
    source: "scheduled",
  };

  // --- Write 1: Supabase (full grid detail) ---
  try {
    await logToSupabase(supabaseUrl, supabaseKey, supabasePayload);
    console.log("[sst-scheduled] Supabase write OK");
  } catch (e) {
    // Non-fatal: log and continue to Playground mirror
    console.error(
      "[sst-scheduled] Supabase write failed:",
      (e as Error).message,
    );
  }

  // --- Write 2: Playground HotspotLog (summary for in-app history) ---
  try {
    await mirrorToPlayground(
      playgroundApiUrl,
      playgroundApiKey,
      playgroundSummary,
    );
    console.log("[sst-scheduled] Playground HotspotLog mirror OK");
  } catch (e) {
    // Non-fatal: log and continue
    console.error(
      "[sst-scheduled] Playground mirror failed:",
      (e as Error).message,
    );
  }

  console.log(
    `[sst-scheduled] Done — ${hotspots.length} hotspots, ${breaksFound} breaks, hash ${dataHash}`,
  );
  return {
    statusCode: 200,
    body: `Scan complete. ${hotspots.length} hotspots, ${breaksFound} breaks.`,
  };
};

export const config: Config = { schedule: SCHEDULE };
export { scheduledHandler as handler };
