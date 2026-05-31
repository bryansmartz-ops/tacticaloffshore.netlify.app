/**
 * Netlify serverless function — ERDDAP SST Proxy
 *
 * Routes:
 *   GET /.netlify/functions/sst-proxy?lat=38.5&lng=-73.5
 *   GET /.netlify/functions/sst-proxy?minLat=38.2&maxLat=38.8&minLng=-73.9&maxLng=-73.1
 *   GET /.netlify/functions/sst-proxy?mode=scanbreak&minLat=…&maxLat=…&minLng=…&maxLng=…&ambLat=…&ambLng=…
 *
 * Query modes:
 *   Point mode    — lat + lng  (internally padded ±0.05° to ensure pixel hits)
 *   BBox mode     — minLat + maxLat + minLng + maxLng
 *   Scanbreak     — mode=scanbreak + bbox + ambLat + ambLng
 *                   Sweeps the bbox on a 0.25° grid, fetches a small cell at each
 *                   node, computes breakDelta vs the ambient point, and returns
 *                   the cell with the highest (hotSST − ambSST) value.
 *
 *                   Response when a break IS found (ok: true):
 *                     { ok: true, hotLat, hotLng, hotTempF, ambTempF, breakDeltaF,
 *                       pixelCount, dataset, resolution }
 *                   Response when no usable data found (ok: false):
 *                     { ok: false, reason: "no_data" | "bad_params" | "timeout" | "error" }
 *
 * Strategy:
 *   PRIMARY  — pfeg MUR SST 0.01°  (L4 blended)
 *   FALLBACK — pfeg MUR NRT 0.01°  (near-real-time variant)
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
    // JPL MUR SST 0.01° — the original working dataset on the main CoastWatch server
    id: "jplMURSST41",
    base: "https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41",
    sstVar: "analysed_sst",
    qualityVar: null,
    minQuality: 0,
    resolution: "0.01deg",
    label: "pfeg-mur-sst",
  },
  {
    // MUR NRT (near-real-time) variant on same server as fallback
    id: "jplMURSST41ANRT",
    base: "https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41ANRT",
    sstVar: "analysed_sst",
    qualityVar: null,
    minQuality: 0,
    resolution: "0.01deg",
    label: "pfeg-mur-nrt",
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
// Grid-scan break-finder — used by mode=scanbreak
// ---------------------------------------------------------------------------

/**
 * Grid step used by the break-scanner.  0.25° ≈ 15 NM — coarse enough to
 * cover a 1°×1° bbox in ~25 cells without hammering ERDDAP, fine enough
 * to locate the break cell within ±8 NM accuracy.
 */
const SCAN_GRID_DEG = 0.25;

/**
 * Cell half-width used for each grid sample.  0.1° ≈ 6 NM window gives
 * ~100 MUR pixels per cell — enough for a reliable mean.
 */
const SCAN_CELL_PAD = 0.1;

/**
 * Maximum parallel ERDDAP requests fired by the break-scanner.
 * Keep this low — Netlify functions share outbound connection pools.
 */
const SCAN_MAX_PARALLEL = 12;

interface ScanCell {
  lat: number;
  lng: number;
  tempF: number;
  pixelCount: number;
}

/** Build all grid cell centre-points for a search bbox at SCAN_GRID_DEG spacing. */
function buildGridPoints(
  minLat: number,
  maxLat: number,
  minLng: number,
  maxLng: number,
): Array<{ lat: number; lng: number }> {
  const pts: Array<{ lat: number; lng: number }> = [];
  let lat = minLat + SCAN_GRID_DEG / 2;
  while (lat <= maxLat) {
    let lng = minLng + SCAN_GRID_DEG / 2;
    while (lng <= maxLng) {
      pts.push({
        lat: parseFloat(lat.toFixed(4)),
        lng: parseFloat(lng.toFixed(4)),
      });
      lng += SCAN_GRID_DEG;
    }
    lat += SCAN_GRID_DEG;
  }
  return pts;
}

/**
 * Fetch SST for a single small cell (centre ± SCAN_CELL_PAD).
 * Returns null when land / no data.
 */
async function fetchCellSST(
  dataset: DatasetDef,
  lat: number,
  lng: number,
): Promise<ScanCell | null> {
  const result = await fetchDataset(
    dataset,
    lat - SCAN_CELL_PAD,
    lat + SCAN_CELL_PAD,
    lng - SCAN_CELL_PAD,
    lng + SCAN_CELL_PAD,
  );
  if (!result || result === "land") return null;
  const tempF = parseFloat(((result.celsius * 9) / 5 + 32).toFixed(2));
  return { lat, lng, tempF, pixelCount: result.pixelCount };
}

/**
 * Run the full grid-scan break-finding algorithm.
 *
 * Algorithm:
 *   1. Sample ambient SST at (ambLat, ambLng).
 *   2. Build a grid of cell centres across the search bbox.
 *   3. Fetch SST for each cell (batched to SCAN_MAX_PARALLEL).
 *   4. For each successful cell, compute breakDelta = cellTempF − ambTempF.
 *   5. Return the cell with the highest (positive) breakDelta as the "hot side".
 *
 * The caller (FishingMap Step 3) will:
 *   - Reject cells below minConfidence.
 *   - Label the result relative to the nearest named canyon.
 *   - Plot a hotspot marker only if confidence exceeds the def's threshold.
 */
async function runScanBreak(
  minLat: number,
  maxLat: number,
  minLng: number,
  maxLng: number,
  ambLat: number,
  ambLng: number,
): Promise<{
  ok: boolean;
  hotLat?: number;
  hotLng?: number;
  hotTempF?: number;
  ambTempF?: number;
  breakDeltaF?: number;
  pixelCount?: number;
  dataset?: string;
  resolution?: string;
  reason?: string;
}> {
  // ── Step 1: Sample ambient SST ─────────────────────────────────────────
  let ambTempF: number | null = null;
  let usedDataset: DatasetDef | null = null;

  for (const ds of DATASETS) {
    const ambCell = await fetchCellSST(ds, ambLat, ambLng);
    if (ambCell !== null) {
      ambTempF = ambCell.tempF;
      usedDataset = ds;
      break;
    }
  }

  if (ambTempF === null || usedDataset === null) {
    return { ok: false, reason: "no_data" };
  }

  // ── Step 2: Build grid ────────────────────────────────────────────────
  const gridPts = buildGridPoints(minLat, maxLat, minLng, maxLng);

  // Cap grid to SCAN_MAX_PARALLEL cells — trim from the edges to keep
  // centre-of-bbox coverage when the region is unusually large.
  const midIdx = Math.floor(gridPts.length / 2);
  const half = Math.floor(SCAN_MAX_PARALLEL / 2);
  const clampedPts =
    gridPts.length <= SCAN_MAX_PARALLEL
      ? gridPts
      : gridPts.slice(
          Math.max(0, midIdx - half),
          Math.min(gridPts.length, midIdx + half),
        );

  // ── Step 3: Fetch all cells in parallel ───────────────────────────────
  const cellResults = await Promise.allSettled(
    clampedPts.map((pt) => fetchCellSST(usedDataset!, pt.lat, pt.lng)),
  );

  const cells: ScanCell[] = [];
  cellResults.forEach((r) => {
    if (r.status === "fulfilled" && r.value !== null) {
      cells.push(r.value);
    }
  });

  if (cells.length === 0) {
    return { ok: false, reason: "no_data" };
  }

  // ── Step 4 & 5: Find sharpest warm break ─────────────────────────────
  let bestCell: ScanCell | null = null;
  let bestDelta = -Infinity;

  for (const cell of cells) {
    const delta = cell.tempF - ambTempF;
    if (delta > bestDelta) {
      bestDelta = delta;
      bestCell = cell;
    }
  }

  if (bestCell === null || bestDelta <= 0) {
    // No warm break found — ambient is as warm as anything in the bbox
    return { ok: false, reason: "no_data" };
  }

  return {
    ok: true,
    hotLat: bestCell.lat,
    hotLng: bestCell.lng,
    hotTempF: parseFloat(bestCell.tempF.toFixed(2)),
    ambTempF: parseFloat(ambTempF.toFixed(2)),
    breakDeltaF: parseFloat(bestDelta.toFixed(2)),
    pixelCount: bestCell.pixelCount,
    dataset: usedDataset.label,
    resolution: usedDataset.resolution,
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

  // ── SCANBREAK mode ────────────────────────────────────────────────────────
  if (params.mode === "scanbreak") {
    const minLat = parseFloat(params.minLat ?? "");
    const maxLat = parseFloat(params.maxLat ?? "");
    const minLng = parseFloat(params.minLng ?? "");
    const maxLng = parseFloat(params.maxLng ?? "");
    const ambLat = parseFloat(params.ambLat ?? "");
    const ambLng = parseFloat(params.ambLng ?? "");

    if (
      [minLat, maxLat, minLng, maxLng, ambLat, ambLng].some((v) => !isFinite(v))
    ) {
      return json(400, {
        ok: false,
        reason: "bad_params",
        detail:
          "mode=scanbreak requires minLat, maxLat, minLng, maxLng, ambLat, ambLng",
      });
    }

    const result = await runScanBreak(
      minLat,
      maxLat,
      minLng,
      maxLng,
      ambLat,
      ambLng,
    );
    return json(200, result);
  }

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
