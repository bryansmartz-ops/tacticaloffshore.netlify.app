/**
 * Shared hotspot definitions and helpers
 * Single source of truth used by both TacticalMap and Hotspots sections.
 *
 * CONFIDENCE SCORING — five weighted signal buckets (max 100 pts total):
 *
 *  ┌─────────────────────────────┬──────┬────────────────────────────────────────────────────┐
 *  │ Bucket                      │ Max  │ Rule                                               │
 *  ├─────────────────────────────┼──────┼────────────────────────────────────────────────────┤
 *  │ SST proximity               │  25  │ Linear: full pts when SST within ±1°F of ideal;    │
 *  │                             │      │ ramps to 0 at ±8°F from ideal for target species   │
 *  │ SST break sharpness         │  25  │ Linear: full pts at ΔT ≥ 4°F; 0 pts at ΔT = 0     │
 *  │ Chlorophyll concentration   │  20  │ Log-scale: full pts ≥ 0.3 mg/m³ (bloom level);    │
 *  │                             │      │ 0 pts at ≤ 0.02 mg/m³ (open ocean desert)          │
 *  │ Altimetry / SSH anomaly     │  15  │ Positive SSH anomaly (warm eddy): full pts ≥+10cm; │
 *  │                             │      │ negative (cold core) = 0 pts                       │
 *  │ History + reports           │  15  │ Static prior: historical catch frequency + any      │
 *  │                             │      │ current fishing report intel (0–15 pts)             │
 *  └─────────────────────────────┴──────┴────────────────────────────────────────────────────┘
 *
 * Composite score is clamped to [40, 95] to avoid false extremes.
 */

import type { BBoxQuery } from "./erddap";

// ---------------------------------------------------------------------------
// LORAN-C constants (Chain 9960 — Northeast US)
// ---------------------------------------------------------------------------
const MASTER = { lat: 42.7137, lng: -76.8246 };
const SEC_W = { lat: 46.8, lng: -67.9266 };
const SEC_X = { lat: 41.253, lng: -69.9775 };
const ED_W = 28691;
const ED_X = 41657;
const C_US_PER_NM = 6.177;

export function haversineNm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 3440.065;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function toLoranTD(lat: number, lng: number): { w: string; x: string } {
  const dM = haversineNm(lat, lng, MASTER.lat, MASTER.lng);
  const dW = haversineNm(lat, lng, SEC_W.lat, SEC_W.lng);
  const dX = haversineNm(lat, lng, SEC_X.lat, SEC_X.lng);
  const tdW = ED_W + (dM - dW) * C_US_PER_NM;
  const tdX = ED_X + (dM - dX) * C_US_PER_NM;
  return {
    w: (tdW >= 0 ? "+" : "") + Math.round(tdW),
    x: (tdX >= 0 ? "+" : "") + Math.round(tdX),
  };
}

// ---------------------------------------------------------------------------
// Multi-factor signal interface
// ---------------------------------------------------------------------------

/**
 * Five-bucket signal breakdown for a single hotspot evaluation.
 * Each field is 0 when the signal has not yet been fetched (optimistic default).
 */
export interface HotspotSignals {
  /**
   * SST proximity score (0–25 pts).
   * Full 25 pts when live SST is within ±1°F of the target species' ideal range centre.
   * Linear decay to 0 pts at ±8°F from the ideal — captures "right temp" vs "off-temp" quality.
   */
  sstScore: number;

  /**
   * SST break sharpness score (0–25 pts).
   * Full 25 pts when hotSST − ambientSST ≥ 4°F.
   * Linear from 0 pts (no break) to 25 pts at ΔT = 4°F.
   * A sharp thermal break concentrates bait and pelagics.
   */
  sstBreakScore: number;

  /**
   * Chlorophyll-a concentration score (0–20 pts).
   * Derived from MODIS/VIIRS satellite imagery (mg/m³).
   * Scoring (log-scaled):
   *   ≥ 0.30 mg/m³ → 20 pts  (coastal bloom / rich feeding conditions)
   *   0.10–0.30     → 10–20 pts (linear interpolation)
   *   0.02–0.10     → 0–10 pts  (oligotrophic / open ocean)
   *   < 0.02        → 0 pts
   * High chlorophyll → bait aggregation → predator concentration.
   */
  chloroScore: number;

  /**
   * Altimetric sea surface height anomaly score (0–15 pts).
   * Derived from CMEMS / Copernicus satellite altimetry (cm SSH anomaly).
   * Positive SSH = warm-core eddy / convergence → favours pelagics.
   * Scoring:
   *   ≥ +10 cm → 15 pts
   *   0 to +10 cm → linear 0–15 pts
   *   < 0 cm (cold-core / divergence) → 0 pts
   */
  altimetryScore: number;

  /**
   * Historical catch frequency + current fishing report intelligence (0–15 pts).
   * Static prior set per hotspot based on multi-year species distribution records
   * and any parsed fishing reports (Hatteras to OC, MD range).
   * Updated manually or via future report-scraping pipeline.
   *   12–15 pts: known high-percentage grounds (e.g. Diamond Shoals YFT in summer)
   *    7–11 pts: seasonally productive with moderate historical data
   *    0–6 pts:  limited records or low historical hit rate
   */
  historyReportsScore: number;
}

/** Zero-filled signals object — used before any live fetch completes */
export const EMPTY_SIGNALS: HotspotSignals = {
  sstScore: 0,
  sstBreakScore: 0,
  chloroScore: 0,
  altimetryScore: 0,
  historyReportsScore: 0,
};

// ---------------------------------------------------------------------------
// SST-based scoring helpers
// ---------------------------------------------------------------------------

/** Derive likely species from SST in °F */
export function speciesFromSST(tempF: number): string[] {
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

/**
 * Compute individual SST signals from live temperatures.
 *
 * @param tempF      Live hotspot SST in °F
 * @param breakDelta hotSST − ambientSST in °F (clamped ≥ 0 before calling)
 * @param idealF     Target species ideal SST centre in °F (default 72°F — mid-range pelagic)
 *
 * Returns `sstScore` and `sstBreakScore` ready to merge into a `HotspotSignals` object.
 */
export function computeSSTSignals(
  tempF: number,
  breakDelta: number,
  idealF = 72,
): Pick<HotspotSignals, "sstScore" | "sstBreakScore"> {
  // SST proximity: full 25 pts within ±1°F of ideal; 0 pts at ±8°F
  const deviation = Math.abs(tempF - idealF);
  const sstScore = Math.max(0, Math.min(25, ((8 - deviation) / 7) * 25));

  // Break sharpness: linear 0→25 over 0→4°F break delta
  const sstBreakScore = Math.max(0, Math.min(25, (breakDelta / 4) * 25));

  return {
    sstScore: Math.round(sstScore),
    sstBreakScore: Math.round(sstBreakScore),
  };
}

/**
 * Score chlorophyll concentration (mg/m³) → 0–20 pts (log-scaled).
 *
 * < 0.02  mg/m³ → 0 pts
 * 0.10    mg/m³ → ~7 pts
 * 0.30    mg/m³ → 20 pts (full)
 * > 0.30  mg/m³ → capped at 20 pts
 */
export function computeChloroScore(chloroMgM3: number): number {
  if (chloroMgM3 <= 0.02) return 0;
  // Map log10(0.02)=−1.699 … log10(0.30)=−0.523 onto 0–20
  const lo = Math.log10(0.02);
  const hi = Math.log10(0.3);
  const val = Math.log10(Math.max(0.02, chloroMgM3));
  return Math.round(Math.max(0, Math.min(20, ((val - lo) / (hi - lo)) * 20)));
}

/**
 * Score SSH anomaly in cm → 0–15 pts.
 * Negative anomalies (cold eddy) score 0.
 * Linear 0→15 over 0→+10 cm positive anomaly.
 */
export function computeAltimetryScore(sshAnomalyCm: number): number {
  if (sshAnomalyCm <= 0) return 0;
  return Math.round(Math.min(15, (sshAnomalyCm / 10) * 15));
}

/**
 * Composite confidence % from a fully-populated HotspotSignals object.
 * Sum of all five buckets (max 100), clamped to [40, 95].
 *
 * Backward-compat: also accepts legacy (tempF, breakDelta) signature so
 * existing callers continue to work until Step 2 migrates them.
 */
export function computeConfidence(signals: HotspotSignals): number;
export function computeConfidence(tempF: number, breakDelta: number): number;
export function computeConfidence(
  signalsOrTempF: HotspotSignals | number,
  breakDelta?: number,
): number {
  if (typeof signalsOrTempF === "number") {
    // Legacy path — build minimal signals from SST only
    const { sstScore, sstBreakScore } = computeSSTSignals(
      signalsOrTempF,
      breakDelta ?? 0,
    );
    const legacySignals: HotspotSignals = {
      sstScore,
      sstBreakScore,
      chloroScore: 0,
      altimetryScore: 0,
      historyReportsScore: 0,
    };
    const raw = legacySignals.sstScore + legacySignals.sstBreakScore;
    // Keep the old range feel (base 50) for the legacy path
    return Math.round(Math.min(95, Math.max(40, 50 + raw)));
  }

  // New path — sum all five buckets
  const s = signalsOrTempF;
  const raw =
    s.sstScore +
    s.sstBreakScore +
    s.chloroScore +
    s.altimetryScore +
    s.historyReportsScore;
  return Math.round(Math.min(95, Math.max(40, raw)));
}

export function confidenceColor(c: number): string {
  if (c >= 80) return "#34d399";
  if (c >= 65) return "#fbbf24";
  return "#f87171";
}

// ---------------------------------------------------------------------------
// Chlorophyll + Altimetry signal fetchers (proxy-backed, with static fallback)
// ---------------------------------------------------------------------------

/**
 * Estimate a chlorophyll score (0–20) from SST proxy data.
 *
 * True chlorophyll requires a separate MODIS/VIIRS satellite product.
 * Until a dedicated chlorophyll proxy endpoint is available, we derive a
 * physics-informed estimate:
 *   - Cold upwelling / shelf-break fronts (SST 60–68°F) → higher chloro
 *   - Warm oligotrophic water (SST > 80°F) → very low chloro
 *   - Mid-range SST with a known break → moderate chloro
 *
 * When a real chlorophyll endpoint is wired, replace this function body.
 */
export function estimateChloroScore(tempF: number, breakDelta: number): number {
  // Shelf-break upwelling proxy: cooler SST + steep break → more nutrients
  // Warm open-ocean → low chloro
  // Logic: base score from temperature band, boosted by break sharpness
  let base = 0;
  if (tempF < 64)
    base = 16; // cool, upwelling-influenced
  else if (tempF < 68) base = 13;
  else if (tempF < 72) base = 10;
  else if (tempF < 76) base = 7;
  else if (tempF < 80) base = 5;
  else base = 3; // warm, low-nutrient open ocean

  // Break sharpness adds up to 4 bonus points (sharp front = nutrient mixing)
  const breakBonus = Math.min(4, (breakDelta / 4) * 4);
  return Math.round(Math.min(20, base + breakBonus));
}

/**
 * Estimate an altimetry / SSH anomaly score (0–15) from available data.
 *
 * True SSH anomaly requires CMEMS/Copernicus altimetry products.
 * Until a dedicated altimetry proxy endpoint is available, we use a
 * Gulf Stream position heuristic:
 *   - Sites with warm SST (> 72°F) at the right depth-gradient position
 *     are likely near or inside a warm-core eddy / Gulf Stream meander.
 *   - Sites with very hot SST (> 78°F) far offshore may be inside a WCR.
 *
 * When a real altimetry endpoint is wired, replace this function body.
 */
export function estimateAltimetryScore(
  tempF: number,
  breakDelta: number,
  lat: number,
): number {
  // Gulf Stream latitude proxy: core is ~35–38°N offshore
  // Sites closer to GS core with warm SST and strong breaks score higher
  const latBonus = lat >= 35 && lat <= 39 ? 3 : lat >= 39 && lat <= 41 ? 1 : 0;

  let base = 0;
  if (tempF >= 78)
    base = 12; // likely inside warm-core ring or GS
  else if (tempF >= 74) base = 9;
  else if (tempF >= 70) base = 6;
  else if (tempF >= 66) base = 3;
  else base = 1;

  // Sharp break means we're right at the eddy edge — biggest signal
  const breakBonus = Math.min(3, (breakDelta / 4) * 3);
  return Math.round(Math.min(15, base + breakBonus + latBonus));
}

// ---------------------------------------------------------------------------
// Full signals builder — assembles all five buckets for a hotspot
// ---------------------------------------------------------------------------

/**
 * Build a complete HotspotSignals object from live SST + the hotspot definition.
 * Uses estimateChloroScore + estimateAltimetryScore as physics-informed stubs
 * until dedicated satellite product proxies are available.
 */
export function buildHotspotSignals(
  tempF: number,
  breakDelta: number,
  def: HotspotDef,
): HotspotSignals {
  const { sstScore, sstBreakScore } = computeSSTSignals(
    tempF,
    breakDelta,
    def.idealSstF,
  );
  const chloroScore = estimateChloroScore(tempF, breakDelta);
  const altimetryScore = estimateAltimetryScore(tempF, breakDelta, def.lat);
  return {
    sstScore,
    sstBreakScore,
    chloroScore,
    altimetryScore,
    historyReportsScore: def.historyPrior,
  };
}

// ---------------------------------------------------------------------------
// Bbox helper
// ---------------------------------------------------------------------------

/** ±0.15° bounding box centred on a lat/lng — matches Hotspots bboxPad=0.15 */
export const HOTSPOT_BBOX_PAD = 0.15;

export function hotspotBBox(
  lat: number,
  lng: number,
  pad = HOTSPOT_BBOX_PAD,
): BBoxQuery {
  return {
    minLat: lat - pad,
    maxLat: lat + pad,
    minLng: lng - pad,
    maxLng: lng + pad,
  };
}

// ---------------------------------------------------------------------------
// Canonical hotspot definitions
// ---------------------------------------------------------------------------

export interface HotspotDef {
  id: string;
  title: string;
  /** Fallback SST °F used when ERDDAP is unavailable */
  fallbackSstF: number;
  lat: number;
  lng: number;
  /** Nearby ambient shelf point for computing breakDelta */
  ambientLat: number;
  ambientLng: number;
  /** BBox half-width in degrees; defaults to HOTSPOT_BBOX_PAD */
  bboxPad?: number;
  /**
   * Static historical/reports prior (0–15 pts) contributing to historyReportsScore.
   * Set at definition time; reflects multi-year catch frequency + current intel.
   */
  historyPrior: number;
  /**
   * Ideal SST °F for the primary target species at this site.
   * Used by computeSSTSignals() proximity calculation.
   */
  idealSstF: number;
  /**
   * Last-computed five-bucket signal breakdown.
   * Populated at runtime by the signal-fetch layer (Step 2).
   * Displayed in UI tooltips and hotspot detail cards.
   */
  signals?: HotspotSignals;
}

export const HOTSPOT_DEFS: HotspotDef[] = [
  // ── North: NJ / Hudson ──────────────────────────────────────────────────
  {
    id: "4",
    title: "Hudson Canyon Rip",
    fallbackSstF: 72,
    lat: 39.52,
    lng: -72.05,
    ambientLat: 39.52,
    ambientLng: -71.3,
    bboxPad: 0.15,
    idealSstF: 70,
    // Strong NJ tuna grounds — consistent bigeye/YFT history; well-documented shelf break
    historyPrior: 12,
  },
  // ── OC, MD / Delaware area ──────────────────────────────────────────────
  {
    id: "6",
    title: "Spencer Canyon (OC, MD)",
    fallbackSstF: 75,
    lat: 39.05,
    lng: -72.7,
    ambientLat: 39.05,
    ambientLng: -71.95,
    bboxPad: 0.15,
    idealSstF: 72,
    // Primary OC, MD tuna grounds — YFT currently active per current reports; high-percentage
    historyPrior: 14,
  },
  {
    id: "7",
    title: "Atlantis Canyon",
    fallbackSstF: 74,
    lat: 39.38,
    lng: -72.25,
    ambientLat: 39.38,
    ambientLng: -71.5,
    bboxPad: 0.15,
    idealSstF: 71,
    // NJ/DE border grounds — solid tuna and white marlin producers
    historyPrior: 11,
  },
  // ── Mid-Atlantic shelf break ─────────────────────────────────────────────
  {
    id: "3",
    title: "Baltimore Canyon",
    fallbackSstF: 76,
    lat: 38.22,
    lng: -73.82,
    ambientLat: 38.22,
    ambientLng: -73.1,
    bboxPad: 0.15,
    idealSstF: 74,
    // Top MD/VA tournament ground — reliably warm Gulf Stream finger; YFT/marlin
    historyPrior: 13,
  },
  {
    id: "5",
    title: "Wilmington Canyon Ledge",
    fallbackSstF: 73,
    lat: 38.52,
    lng: -73.42,
    ambientLat: 38.52,
    ambientLng: -72.7,
    bboxPad: 0.15,
    idealSstF: 72,
    // Productive ledge; moderate historical data — consistent but not top-tier
    historyPrior: 9,
  },
  {
    id: "1",
    title: "Washington Canyon Break",
    fallbackSstF: 74,
    lat: 37.55,
    lng: -74.35,
    ambientLat: 37.55,
    ambientLng: -73.6,
    bboxPad: 0.15,
    idealSstF: 73,
    // Classic shelf-break rip; tuna/marlin when warm water pushes in
    historyPrior: 10,
  },
  // ── South: VA / Hatteras ─────────────────────────────────────────────────
  {
    id: "2",
    title: "Norfolk Canyon Edge",
    fallbackSstF: 72,
    lat: 37.05,
    lng: -74.65,
    ambientLat: 37.05,
    ambientLng: -73.9,
    bboxPad: 0.15,
    idealSstF: 71,
    // Moderate VA grounds; good spring bluefin history; limited summer YFT reports
    historyPrior: 8,
  },
  {
    id: "8",
    title: "Diamond Shoals / Cape Hatteras",
    fallbackSstF: 78,
    lat: 35.15,
    lng: -75.2,
    ambientLat: 35.15,
    ambientLng: -74.45,
    bboxPad: 0.15,
    idealSstF: 76,
    // Gulf Stream pinch point — strongest YFT/mahi/wahoo history in the range; early season
    historyPrior: 15,
  },
];
