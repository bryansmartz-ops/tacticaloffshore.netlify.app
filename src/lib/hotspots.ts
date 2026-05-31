/**
 * Shared hotspot definitions and helpers
 * Single source of truth used by both TacticalMap and Hotspots sections.
 *
 * CONFIDENCE SCORING — five weighted signal buckets (max 100 pts total):
 *
 *  ┌─────────────────────────────┬──────┬────────────────────────────────────────────────────┐
 *  │ Bucket                      │ Max  │ Rule                                               │
 *  ├─────────────────────────────┼──────┼────────────────────────────────────────────────────┤
 *  │ SST break sharpness         │  35  │ PRIMARY signal. Linear: full pts at ΔT ≥ 3°F;      │
 *  │                             │      │ 0 pts at ΔT = 0 — sharp thermal fronts concentrate  │
 *  │                             │      │ bait and pelagics far better than SST proximity     │
 *  │ SST proximity               │  20  │ Linear: full pts when SST within ±1°F of ideal;    │
 *  │                             │      │ ramps to 0 at ±6°F from ideal for target species   │
 *  │ Chlorophyll concentration   │  20  │ Log-scale: full pts ≥ 0.3 mg/m³ (bloom level);    │
 *  │                             │      │ 0 pts at ≤ 0.02 mg/m³ (open ocean desert)          │
 *  │ Altimetry / SSH anomaly     │  15  │ Positive SSH anomaly (warm eddy): full pts ≥+10cm; │
 *  │                             │      │ negative (cold core) = 0 pts                       │
 *  │ History + reports           │  10  │ Static prior: historical catch frequency + any      │
 *  │                             │      │ current fishing report intel (0–10 pts)             │
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
   * SST break sharpness score (0–35 pts). ← PRIMARY discriminator.
   * Full 35 pts when hotSST − ambientSST ≥ 3°F (GS-intrusion threshold).
   * Linear from 0 pts (no break) to 35 pts at ΔT = 3°F.
   * A sharp thermal front concentrates bait and pelagics more reliably than
   * absolute SST proximity — raised to 35 to reflect this primacy.
   */
  sstBreakScore: number;

  /**
   * SST proximity score (0–20 pts).
   * Full 20 pts when live SST is within ±1°F of the target species' ideal range centre.
   * Linear decay to 0 pts at ±6°F from the ideal — captures "right temp" vs "off-temp" quality.
   */
  sstScore: number;

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
   * Historical catch frequency + current fishing report intelligence (0–10 pts).
   * Static prior set per hotspot based on multi-year species distribution records
   * and any parsed fishing reports (Hatteras to OC, MD range).
   * Updated manually or via future report-scraping pipeline.
   * Scaled down from 15 → 10 to make live thermal-break signal (sstBreakScore)
   * the dominant factor — history is a tiebreaker, not the headline number.
   *   9–10 pts: known high-percentage grounds (e.g. Diamond Shoals YFT in summer)
   *    5–8 pts:  seasonally productive with moderate historical data
   *    0–4 pts:  limited records or low historical hit rate
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
 *
 * SST proximity window: ±1°F = full 20 pts; decays to 0 at ±6°F.
 * Max reduced 25 → 20 because break sharpness is now the primary signal.
 *
 * Break sharpness: Gulf Stream intrusion events produce breaks of 3–6°F;
 * full 35 pts at ΔT ≥ 3°F — weight raised 25 → 35 to make thermal fronts
 * the dominant confidence discriminator between hotspots.
 */
export function computeSSTSignals(
  tempF: number,
  breakDelta: number,
  idealF = 72,
): Pick<HotspotSignals, "sstScore" | "sstBreakScore"> {
  // SST proximity: full 20 pts within ±1°F of ideal; 0 pts at ±6°F
  const deviation = Math.abs(tempF - idealF);
  const sstScore = Math.max(0, Math.min(20, ((6 - deviation) / 5) * 20));

  // Break sharpness: full 35 pts at ΔT ≥ 3°F (GS intrusion threshold) — PRIMARY signal
  const sstBreakScore = Math.max(0, Math.min(35, (breakDelta / 3) * 35));

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
 * Physics-informed model:
 *   - The Gulf Stream THERMAL EDGE (steep ΔT break) is the primary chloro signal:
 *     nutrient-rich shelf water mixes with warm GS water at the front → phytoplankton bloom.
 *   - Cooler shelf-break SST (60–70°F) with a sharp break = highest chloro.
 *   - Strong break (ΔT ≥ idealBreakDeltaF) is a direct proxy for frontal mixing.
 *   - Warm, quiescent GS interior (SST > 80°F, low break) = oligotrophic desert.
 *
 * @param tempF            Live hotspot SST in °F
 * @param breakDelta       hotSST − ambientSST in °F
 * @param idealBreakDeltaF Site-calibrated ideal break threshold (default 3°F).
 *                         Sourced from HotspotDef.siteIdealBreakDeltaF so each
 *                         canyon is rewarded at its own expected GS-intrusion ΔT.
 *
 * When a real MODIS/VIIRS chlorophyll endpoint is wired, replace this function body.
 */
export function estimateChloroScore(
  tempF: number,
  breakDelta: number,
  idealBreakDeltaF = 3,
): number {
  // Base score from temperature band
  let base = 0;
  if (tempF < 64)
    base = 15; // cool shelf/upwelling — richest nutrients
  else if (tempF < 68) base = 13;
  else if (tempF < 72) base = 10;
  else if (tempF < 76)
    base = 8; // warm shelf edge — still productive near the front
  else if (tempF < 80) base = 5;
  else base = 2; // warm GS interior — oligotrophic

  // Break sharpness is the PRIMARY frontal mixing proxy — up to 7 bonus pts.
  // Scale bonus against the site's own ideal break threshold:
  //   breakDelta / idealBreakDeltaF → ratio capped at 1.0 → maps to 0–7 pts
  // Norfolk (idealBreak=4.5°F) reaches full bonus at 4.5°F ΔT instead of 3°F,
  // ensuring it scores proportionally higher when an actual 4–5°F break is observed.
  const breakRatio = idealBreakDeltaF > 0 ? breakDelta / idealBreakDeltaF : 0;
  const breakBonus = Math.min(7, breakRatio * 7);

  return Math.round(Math.min(20, base + breakBonus));
}

/**
 * Estimate an altimetry / SSH anomaly score (0–15) from available data.
 *
 * Gulf Stream thermal-edge heuristic (physics basis):
 *   - The GS meander can push warm water as far north as 38–40°N near the shelf break
 *     (Norfolk/Washington canyon area). When SST is ELEVATED above the site's
 *     seasonal baseline AND there is a detectable thermal break, this strongly
 *     indicates a warm-core eddy or GS meander pushing into that canyon system.
 *   - Key insight: for mid-latitude sites (36–40°N), a RELATIVE elevation
 *     above ambient (breakDelta) is MORE diagnostic than absolute SST alone,
 *     because it confirms warm GS water intruding onto the shelf.
 *   - Latitude bonus: the GS shelf-break interaction zone runs 35–41°N;
 *     Norfolk (37°N) and Washington (37.5°N) are squarely in this zone and
 *     should score high when warm water pushes north.
 *
 * @param tempF            Live hotspot SST in °F
 * @param breakDelta       hotSST − ambientSST in °F
 * @param lat              Hotspot latitude (degrees N)
 * @param idealBreakDeltaF Site-calibrated ideal break threshold (default 3°F).
 *                         Sourced from HotspotDef.siteIdealBreakDeltaF — each
 *                         canyon earns its break bonus at its own calibrated ΔT
 *                         rather than a fixed global 3°F floor.
 *
 * When a real CMEMS/Copernicus altimetry endpoint is wired, replace this function body.
 */
export function estimateAltimetryScore(
  tempF: number,
  breakDelta: number,
  lat: number,
  idealBreakDeltaF = 3,
): number {
  // Latitude bonus: GS shelf-break interaction zone 35–41°N
  // Peak bonus at 36–39°N (Norfolk → Spencer Canyon corridor)
  let latBonus = 0;
  if (lat >= 36 && lat <= 39)
    latBonus = 4; // prime GS meander corridor
  else if (lat >= 35 && lat < 36)
    latBonus = 3; // Hatteras / Diamond Shoals
  else if (lat > 39 && lat <= 41)
    latBonus = 2; // NJ/DE shelf — still active
  else if (lat > 41) latBonus = 0; // north of GS influence

  // Base score from absolute SST — warm absolute temp suggests GS water present
  let base = 0;
  if (tempF >= 78)
    base = 9; // clearly GS / warm-core ring water
  else if (tempF >= 74) base = 7;
  else if (tempF >= 70)
    base = 5; // marginal — may be shelf water
  else if (tempF >= 66) base = 3;
  else base = 1;

  // Break bonus: THIS IS THE KEY SIGNAL for GS intrusion at mid-latitudes.
  // Scale against each site's calibrated ideal break threshold so Norfolk
  // (idealBreak=4.5°F) reaches full bonus at 4.5°F ΔT rather than 3°F,
  // producing a meaningful spread between genuinely sharp and marginal breaks.
  // ΔT ≥ idealBreakDeltaF = strong GS intrusion signal → up to 4 bonus pts
  const breakRatio = idealBreakDeltaF > 0 ? breakDelta / idealBreakDeltaF : 0;
  const breakBonus = Math.min(4, breakRatio * 4);

  return Math.round(Math.min(15, base + breakBonus + latBonus));
}

// ---------------------------------------------------------------------------
// Full signals builder — assembles all five buckets for a hotspot
// ---------------------------------------------------------------------------

/**
 * Build a complete HotspotSignals object from live SST + the hotspot definition.
 * Uses estimateChloroScore + estimateAltimetryScore as physics-informed stubs
 * until dedicated satellite product proxies are available.
 *
 * GS-INTRUSION MULTIPLIER (Step 3):
 * When warm Gulf Stream water actively pushes into the 35–39°N canyon corridor
 * AND a detectable thermal break exists (breakDelta ≥ 2°F), a bonus is added
 * directly to sstBreakScore (capped at the 35 pt max).
 *
 * Physics basis: The GS shelf-break interaction zone runs 35–41°N but is most
 * impactful in the 35–39°N band (Hatteras → Washington/Norfolk canyon area).
 * When the GS meanders north and injects warm water onto the shelf, the resulting
 * thermal front is steeper and more productive than a typical shelf-edge break.
 * ΔT ≥ 2°F at these latitudes is strong evidence of active GS intrusion — the
 * bonus rewards that signal and differentiates Norfolk/Washington from flatter sites.
 *
 * Bonus tiers (added to raw sstBreakScore before cap):
 *   ΔT ≥ 4°F in 35–39°N corridor → +6 pts  (strong intrusion — steep, productive front)
 *   ΔT ≥ 2°F in 35–39°N corridor → +3 pts  (moderate intrusion — confirmed break)
 *   ΔT ≥ 2°F in 39–41°N corridor → +1 pt   (northern edge — marginal GS influence)
 *   All other cases               → 0 pts   (no multiplier)
 */
export function buildHotspotSignals(
  tempF: number,
  breakDelta: number,
  def: HotspotDef,
): HotspotSignals {
  // Site-calibrated ideal break ΔT — fall back to global 3°F if not set
  const idealBreakDeltaF = def.siteIdealBreakDeltaF ?? 3;

  const { sstScore, sstBreakScore: rawBreakScore } = computeSSTSignals(
    tempF,
    breakDelta,
    def.idealSstF,
  );

  // GS-intrusion multiplier — bonus applied to sstBreakScore, capped at 35 pts max
  let gsBonus = 0;
  const lat = def.lat;
  if (lat >= 35 && lat < 39) {
    // Prime GS meander corridor — Norfolk / Washington / Hatteras zone
    if (breakDelta >= 4) gsBonus = 6;
    else if (breakDelta >= 2) gsBonus = 3;
  } else if (lat >= 39 && lat <= 41) {
    // Northern corridor — Spencer / Atlantis / Hudson — marginal GS influence
    if (breakDelta >= 2) gsBonus = 1;
  }
  const sstBreakScore = Math.min(35, rawBreakScore + gsBonus);

  // Pass site-calibrated ideal break threshold into proxy scorers so each canyon
  // is rewarded at its own expected GS-intrusion ΔT rather than a global 3°F floor.
  const chloroScore = estimateChloroScore(tempF, breakDelta, idealBreakDeltaF);
  const altimetryScore = estimateAltimetryScore(
    tempF,
    breakDelta,
    def.lat,
    idealBreakDeltaF,
  );
  return {
    sstScore,
    sstBreakScore,
    chloroScore,
    altimetryScore,
    historyReportsScore: def.historyPrior,
  };
}

// ---------------------------------------------------------------------------
// OC Inlet origin + 100 NM radius filter
// ---------------------------------------------------------------------------

/**
 * OC Inlet, Ocean City, MD — tournament departure origin.
 * All hotspot distances are measured from this point.
 * WGS-84: 38.3289°N, 75.0913°W
 */
export const OC_INLET = { lat: 38.3289, lng: -75.0913 };

/** Tournament radius limit in nautical miles */
export const OC_RADIUS_NM = 100;

/** Distance from OC Inlet to a hotspot in nautical miles */
export function distFromOCInlet(lat: number, lng: number): number {
  return haversineNm(OC_INLET.lat, OC_INLET.lng, lat, lng);
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
   * Site-calibrated ideal thermal break ΔT in °F (hotSST − ambientSST).
   * Used by estimateChloroScore and estimateAltimetryScore to reward each
   * canyon at its own expected GS-intrusion threshold rather than a global 3°F floor.
   *
   * Calibration guide:
   *   5–6°F: Hatteras (Diamond Shoals) — GS pinch zone, steepest mid-shelf breaks
   *   4–5°F: Norfolk / Washington Canyon — prime GS intrusion corridor
   *   3–4°F: Baltimore / Spencer / Wilmington — productive but softer breaks
   *   2–3°F: Hudson / Atlantis — northern shelf; GS influence less direct
   *
   * Defaults to 3.0°F if not set (preserves previous behaviour for any hotspot
   * that has not been explicitly calibrated).
   */
  siteIdealBreakDeltaF?: number;
  /**
   * Last-computed five-bucket signal breakdown.
   * Populated at runtime by the signal-fetch layer (Step 2).
   * Displayed in UI tooltips and hotspot detail cards.
   */
  signals?: HotspotSignals;
}

/**
 * Penalty applied to confidence when live SST could not be retrieved and the
 * hardcoded fallbackSstF was used instead.
 *
 * NOTE: As of Step 1 of the "No-Fallback" plan, the penalty approach has been
 * REPLACED by full exclusion — hotspots whose ERDDAP fetch fails are now
 * removed from the resolved list entirely rather than being shown with a deducted
 * score.  This constant is kept for backward-compat imports but is no longer
 * applied anywhere in FishingMap.tsx.
 *
 * @deprecated — use isFallbackSst exclusion logic in FishingMap instead.
 */
export const FALLBACK_SST_CONFIDENCE_PENALTY = 0; // was 18 — zeroed so stale callers do no harm

/**
 * Pre-filtered, confidence-sorted subset of HOTSPOT_DEFS.
 * Only includes hotspots within OC_RADIUS_NM (100 NM) of OC Inlet.
 * Sorted descending by fallback confidence so the list and map always
 * surface the best fishable targets first.
 *
 * NOTE: This array is computed once at module load using fallback SSTs.
 * The Hotspots section re-sorts after live SST predictions arrive.
 */
export let HOTSPOTS_IN_RANGE: HotspotDef[] = []; // populated immediately after HOTSPOT_DEFS below

export const HOTSPOT_DEFS: HotspotDef[] = [
  // ── North: NJ / Hudson ──────────────────────────────────────────────────
  {
    id: "4",
    title: "Hudson Canyon Rip",
    fallbackSstF: 72,
    lat: 39.52,
    lng: -72.05,
    ambientLat: 39.52,
    ambientLng: -72.8, // inshore shelf ~0.75° west — cooler shelf water for break reference
    bboxPad: 0.15,
    idealSstF: 70,
    siteIdealBreakDeltaF: 2.5, // northern shelf — GS influence less direct; softer breaks expected
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
    // Shifted slightly south (39.05 → 38.90) to sample true Mid-Atlantic Bight shelf water
    // rather than the warmer GS pool that biases the ambient reading upward at 39.05°N.
    // 38.90°N at -73.45°W sits squarely on the cooler inshore shelf, providing a cleaner
    // ΔT reference for the thermal-break score.
    ambientLat: 38.9,
    ambientLng: -73.45,
    bboxPad: 0.15,
    idealSstF: 72,
    siteIdealBreakDeltaF: 3.0, // northern shelf-break; moderate GS interaction
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
    ambientLng: -73.0, // inshore shelf ~0.75° west — cooler shelf water for break reference
    bboxPad: 0.15,
    idealSstF: 71,
    siteIdealBreakDeltaF: 2.5, // similar latitude to Hudson — softer GS breaks expected
    // NJ/DE border grounds — solid tuna and white marlin producers
    historyPrior: 11,
  },
  // ── Mid-Atlantic shelf break ─────────────────────────────────────────────
  {
    id: "3",
    title: "Baltimore Canyon",
    fallbackSstF: 76,
    // Corrected to actual shelf-break canyon head (~200m isobath crossover).
    // Previous coords (38.22, -73.82) sat over deep open ocean where MUR/ACSPO
    // frequently returns no valid pixel — causing silent fallback to 76°F.
    // 38.01°N / 74.05°W is the canyon head on the productive shelf edge where
    // satellite SST pixels reliably exist.
    lat: 38.01,
    lng: -74.05,
    ambientLat: 38.01,
    ambientLng: -74.8, // inshore shelf ~0.75° west — cooler shelf water for break reference
    // Widened from 0.15 to 0.22 so the query bbox captures more shelf-break
    // pixels before timing out — reduces chance of empty ERDDAP response.
    bboxPad: 0.22,
    idealSstF: 74,
    siteIdealBreakDeltaF: 3.5, // mid-range — warm GS finger common here; moderate-steep breaks
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
    ambientLng: -74.15, // inshore shelf ~0.75° west — cooler shelf water for break reference
    bboxPad: 0.15,
    idealSstF: 72,
    siteIdealBreakDeltaF: 3.0, // mid-shelf; moderate GS interaction
    // Productive ledge; moderate historical data — consistent but not top-tier
    historyPrior: 9,
  },
  {
    id: "1",
    title: "Washington Canyon Break",
    fallbackSstF: 74,
    lat: 37.55,
    lng: -74.35,
    // Corrected from 0.75° west offset (which can land in warm GS water) to a
    // true inshore shelf reference ≈25 NM inshore at the same latitude.
    // 37.55°N / -75.50°W is over Virginia inner-shelf (<50m depth) — consistently
    // cooler shelf water that reliably shows the warm GS intrusion as a positive ΔT.
    ambientLat: 37.55,
    ambientLng: -75.5,
    // Widened from 0.15 to 0.20 — captures the canyon-head pixels where the
    // thermal break is sharpest (100–500m isobath crossing zone).
    bboxPad: 0.2,
    idealSstF: 73,
    // GS-intrusion corridor: 4–5°F breaks are typical when GS meanders north into this canyon.
    // Using 4.5°F as the ideal — chloro and altimetry bonus scales are calibrated to this ΔT.
    siteIdealBreakDeltaF: 4.5,
    // GS pushes warm water north into this canyon corridor — elevated when GS meanders north.
    // historyPrior raised to 12: when warm water reaches here, it concentrates YFT + white marlin.
    historyPrior: 12,
  },
  // ── South: VA / Hatteras ─────────────────────────────────────────────────
  {
    id: "2",
    title: "Norfolk Canyon Edge",
    fallbackSstF: 72,
    lat: 37.05,
    lng: -74.65,
    // Corrected from 0.75° west offset to actual inshore shelf water ≈30 NM inshore.
    // 37.05°N / -75.65°W sits on the Virginia inner-continental shelf (~20–40m depth)
    // where coastal upwelling keeps water 4–8°F cooler than the canyon-head GS intrusion.
    // The old -75.40°W reference sometimes landed in transitional shelf-break water that
    // was already warming — artificially flattening the measured ΔT and suppressing the
    // break sharpness score for what should be one of the region's top GS-break hotspots.
    ambientLat: 37.05,
    ambientLng: -75.65,
    // Widened from 0.15 to 0.20 — ensures the ERDDAP bbox captures the canyon-head
    // pixels at the 100–500m isobath where the warm GS water collides with cold shelf water.
    bboxPad: 0.2,
    idealSstF: 71,
    // GS-intrusion corridor: 4–6°F breaks are common when GS actively pushes north of 37°N.
    // Using 4.5°F as the ideal — ensures chloro and altimetry bonuses fire at realistic ΔTs
    // instead of rewarding marginal 1-2°F fluctuations.
    siteIdealBreakDeltaF: 4.5,
    // When GS is near Norfolk (current scenario), warm water + SST break = prime YFT/mahi.
    // historyPrior raised to 11: GS intrusion events here historically produce strong bites.
    historyPrior: 11,
  },
  {
    id: "8",
    title: "Diamond Shoals / Cape Hatteras",
    fallbackSstF: 78,
    lat: 35.15,
    lng: -75.2,
    ambientLat: 35.15,
    ambientLng: -75.95, // inshore shelf ~0.75° west — cooler shelf water for break reference
    bboxPad: 0.15,
    idealSstF: 76,
    // GS pinch point — steepest breaks in the range; 5–7°F ΔT common when GS is tight to the cape.
    // Using 5.0°F as ideal so the bonus scales reward genuine Hatteras-grade breaks.
    siteIdealBreakDeltaF: 5.0,
    // Gulf Stream pinch point — strongest YFT/mahi/wahoo history in the range; early season
    historyPrior: 15,
  },
];

// ---------------------------------------------------------------------------
// Populate HOTSPOTS_IN_RANGE now that HOTSPOT_DEFS + helpers are all defined.
// Filters to ≤ OC_RADIUS_NM (100 NM) from OC Inlet, sorted by fallback
// confidence descending so both sections always show best targets first.
// ---------------------------------------------------------------------------
HOTSPOTS_IN_RANGE = HOTSPOT_DEFS.filter(
  (h) => distFromOCInlet(h.lat, h.lng) <= OC_RADIUS_NM,
).sort((a, b) => {
  const bdA = parseFloat(Math.max(0, (a.fallbackSstF - 68) * 0.18).toFixed(1));
  const bdB = parseFloat(Math.max(0, (b.fallbackSstF - 68) * 0.18).toFixed(1));
  const sigA = buildHotspotSignals(a.fallbackSstF, bdA, a);
  const sigB = buildHotspotSignals(b.fallbackSstF, bdB, b);
  return computeConfidence(sigB) - computeConfidence(sigA);
});
