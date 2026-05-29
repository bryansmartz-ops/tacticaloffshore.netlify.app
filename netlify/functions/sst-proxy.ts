/**
 * Netlify serverless function — ERDDAP SST Proxy
 *
 * Routes:
 *   GET /.netlify/functions/sst-proxy?lat=38.5&lng=-73.5
 *   GET /.netlify/functions/sst-proxy?minLat=38.2&maxLat=38.8&minLng=-73.9&maxLng=-73.1
 *
 * Query modes:
 *   Point mode  — lat + lng  (internally padded ±0.05° to ensure pixel hits)
 *   BBox mode   — minLat + maxLat + minLng + maxLng
 *
 * Strategy:
 *   PRIMARY  — cwcgom ACSPO L3S NRT 0.02° (quality_level ≥ 4 filter)
 *   FALLBACK — coastwatch MUR NRT 0.01°   (L4 blended, no quality reject)
 *
 * Response JSON (200):
 *   { ok: true,  tempC, tempF, pixelCount, dataset, resolution }
 *   { ok: false, reason: "land" | "timeout" | "error" | "bad_params" }
 */

import type { Handler, HandlerEvent } from "@netlify/functions";

// ---------------------------------------------------------------------------
// Dataset definitions
// ---------------------------------------------------------------------------

interface DatasetDef {
  id: string;
  base: string;
  sstVar: string;
  qualityVar: string | null;
  minQuality: number;
  resolution: "0.02deg" | "0.01deg";
  label: string;
}

const DATASETS: DatasetDef[] = [
  {
    id: "noaacwLEOACSPOSSTL3SnrtCDaily",
    base: "https://cwcgom.aoml.noaa.gov/erddap/griddap/noaacwLEOACSPOSSTL3SnrtCDaily",
    sstVar: "sst",
    qualityVar: "quality_level",
    minQuality: 4,
    resolution: "0.02deg",
    label: "cwcgom-acspo-l3s",
  },
  {
    id: "jplMURSST41ANRT",
    base: "https://coastwatch.noaa.gov/erddap/griddap/jplMURSST41ANRT",
    sstVar: "analysed_sst",
    qualityVar: null,
    minQuality: 0,
    resolution: "0.01deg",
    label: "cw-mur-nrt",
  },
];

// ---------------------------------------------------------------------------
// URL builder
// ---------------------------------------------------------------------------

function buildBBoxUrl(
  dataset: DatasetDef,
  minLat: number,
  maxLat: number,
  minLng: number,
  maxLng: number,
): string {
  const latRange = `[(${minLat.toFixed(4)}):(${maxLat.toFixed(4)})]`;
  const lngRange = `[(${minLng.toFixed(4)}):(${maxLng.toFixed(4)})]`;
  const timeDim = "[(last)]";
  const sstPart = `${dataset.sstVar}${timeDim}${latRange}${lngRange}`;
  const qualPart = dataset.qualityVar
    ? `,${dataset.qualityVar}${timeDim}${latRange}${lngRange}`
    : "";
  return `${dataset.base}.json?${sstPart}${qualPart}`;
}

// ---------------------------------------------------------------------------
// ERDDAP JSON parser + quality filter
// ---------------------------------------------------------------------------

interface ErddapTable {
  columnNames: string[];
  rows: unknown[][];
}

interface ErddapJson {
  table: ErddapTable;
}

function parseSSTGrid(
  json: unknown,
  dataset: DatasetDef,
): { celsius: number; pixelCount: number } | null | "land" {
  const table = (json as ErddapJson)?.table;
  if (!table?.columnNames || !table?.rows) return null;

  const cols = table.columnNames;
  const sstIdx = cols.indexOf(dataset.sstVar);
  const qualIdx =
    dataset.qualityVar !== null ? cols.indexOf(dataset.qualityVar) : -1;

  if (sstIdx === -1) return null;

  let sum = 0;
  let count = 0;

  for (const row of table.rows) {
    if (qualIdx !== -1) {
      const q = row[qualIdx];
      if (typeof q !== "number" || q < dataset.minQuality) continue;
    }
    const v = row[sstIdx];
    if (typeof v !== "number" || !isFinite(v) || Math.abs(v) > 50) continue;
    sum += v;
    count += 1;
  }

  // Zero valid pixels after quality filter → likely land / cloud-obscured
  if (count === 0) return null;
  return { celsius: sum / count, pixelCount: count };
}

// ---------------------------------------------------------------------------
// Single dataset fetch (server-side, no CORS constraints)
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 18_000;

async function fetchDataset(
  dataset: DatasetDef,
  minLat: number,
  maxLat: number,
  minLng: number,
  maxLng: number,
): Promise<{ celsius: number; pixelCount: number } | null | "land"> {
  const url = buildBBoxUrl(dataset, minLat, maxLat, minLng, maxLng);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);

    // 400/404 from ERDDAP usually means the bbox is over land or no data
    if (resp.status === 400 || resp.status === 404) return "land";
    if (!resp.ok) return null;

    const json = (await resp.json()) as unknown;
    return parseSSTGrid(json, dataset);
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.warn(
      `[sst-proxy] ${dataset.label} fetch failed: ${isAbort ? "timeout" : (err as Error).message}`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function json(statusCode: number, body: object) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(body),
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: "",
    };
  }

  const params = event.queryStringParameters ?? {};

  // --- Resolve bbox ----------------------------------------------------------
  let minLat: number, maxLat: number, minLng: number, maxLng: number;

  if (params.lat !== undefined && params.lng !== undefined) {
    // Point mode — pad ±0.05° so we always hit at least a few grid pixels
    const lat = parseFloat(params.lat);
    const lng = parseFloat(params.lng);
    if (!isFinite(lat) || !isFinite(lng)) {
      return json(400, {
        ok: false,
        reason: "bad_params",
        detail: "lat/lng must be numeric",
      });
    }
    const PAD = 0.05;
    minLat = lat - PAD;
    maxLat = lat + PAD;
    minLng = lng - PAD;
    maxLng = lng + PAD;
  } else if (
    params.minLat !== undefined &&
    params.maxLat !== undefined &&
    params.minLng !== undefined &&
    params.maxLng !== undefined
  ) {
    // BBox mode
    minLat = parseFloat(params.minLat);
    maxLat = parseFloat(params.maxLat);
    minLng = parseFloat(params.minLng);
    maxLng = parseFloat(params.maxLng);
    if ([minLat, maxLat, minLng, maxLng].some((v) => !isFinite(v))) {
      return json(400, {
        ok: false,
        reason: "bad_params",
        detail: "bbox params must be numeric",
      });
    }
  } else {
    return json(400, {
      ok: false,
      reason: "bad_params",
      detail: "Provide lat+lng or minLat+maxLat+minLng+maxLng",
    });
  }

  // --- Try datasets in priority order -----------------------------------------
  for (const dataset of DATASETS) {
    const result = await fetchDataset(dataset, minLat, maxLat, minLng, maxLng);

    if (result === "land") {
      return json(200, { ok: false, reason: "land" });
    }

    if (result !== null) {
      const tempC = parseFloat(result.celsius.toFixed(3));
      const tempF = parseFloat(((result.celsius * 9) / 5 + 32).toFixed(2));
      return json(200, {
        ok: true,
        tempC,
        tempF,
        pixelCount: result.pixelCount,
        dataset: dataset.label,
        resolution: dataset.resolution,
      });
    }

    // dataset returned null — try next
  }

  // Both datasets exhausted
  return json(200, { ok: false, reason: "error" });
};

export { handler };
