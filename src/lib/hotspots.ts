/**
 * Shared hotspot definitions and helpers
 * Single source of truth used by both TacticalMap and Hotspots sections.
 *
 * CONFIDENCE SCORING — five weighted signal buckets (max 100 pts total):
 *
 * ┌─────────────────────────────┬──────┬────────────────────────────────────────────────────┐
 * │ Bucket                      │ Max  │ Rule                                               │
 * ├─────────────────────────────┼──────┼────────────────────────────────────────────────────┤
 * │ SST break sharpness         │  35  │ PRIMARY signal. Linear: full pts at ΔT ≥ 3°F;      │
 * │                             │      │ 0 pts at ΔT = 0 — sharp thermal fronts concentrate  │
 * │                             │      │ bait and pelagics far better than SST proximity     │
 * │ SST proximity               │  20  │ Linear: full pts when SST within ±1°F of ideal;    │
 * │                             │      │ ramps to 0 at ±6°F from ideal for target species   │
 * │ Chlorophyll concentration   │  20  │ Log-scale: full pts ≥ 0.3 mg/m³ (bloom level);     │
 * │                             │      │ 0 pts at ≤ 0.02 mg/m³ (open ocean desert)          │
 * │ Altimetry / SSH anomaly     │  15  │ Positive SSH anomaly (warm eddy): full pts ≥+10cm; │
 * │                             │      │ negative (cold core) = 0 pts                       │
 * │ History + reports           │  10  │ Static prior: historical catch frequency + any      │
 * │                             │      │ current fishing report intel (0–10 pts)            │
 * └─────────────────────────────┴──────┴────────────────────────────────────────────────────┘
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

export interface HotspotSignals {
  sstBreakScore: number;
  sstScore: number;
  chloroScore: number;
  altimetryScore: number;
  historyReportsScore: number;
}

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

export function speciesFromSST(tempF: number): string[] {
  const list: string[] = [];
  
  // High-value targeted pelagic species thermal gate brackets
  if (tempF >= 60 && tempF <= 70) list.push("Bluefin Tuna");
  if (tempF >= 64 && tempF <= 76) list.push("Bigeye Tuna");
  if (tempF >= 67 && tempF <= 82) list.push("Yellowfin Tuna");
  if (tempF >= 69 && tempF <= 79) list.push("White Marlin");
  if (tempF >= 72 && tempF <= 84) list.push("Wahoo");
  if (tempF >= 74) list.push("Mahi Mahi");
  if (tempF >= 58 && tempF <= 72) list.push("Swordfish");
  
  // Unrestricted return ensures all matched target species render on the card layout
  return list; 
}

export function computeSSTSignals(
  tempF: number,
  breakDelta: number,
  idealF = 72,
): Pick<HotspotSignals, "sstScore" | "sstBreakScore"> {
  const deviation = Math.abs(tempF - idealF);
  const sstScore = Math.max(0, Math.min(20, ((6 - deviation) / 5) * 20));
  const sstBreakScore = Math.max(0, Math.min(35, (breakDelta / 3) * 35));

  return {
    sstScore: Math.round(sstScore),
    sstBreakScore: Math.round(sstBreakScore),
  };
}

export function computeChloroScore(chloroMgM3: number): number {
  if (chloroMgM3 <= 0.02) return 0;
  const lo = Math.log10(0.02);
  const hi = Math.log10(0.3);
  const val = Math.log10(Math.max(0.02, chloroMgM3));
  return Math.round(Math.max(0, Math.min(20, ((val - lo) / (hi - lo)) * 20)));
}

export function computeAltimetryScore(sshAnomalyCm: number): number {
  if (sshAnomalyCm <= 0) return 0;
  return Math.round(Math.min(15, (sshAnomalyCm / 10) * 15));
}

export function computeConfidence(signals: HotspotSignals): number;
export function computeConfidence(tempF: number, breakDelta: number): number;
export function computeConfidence(
  signalsOrTempF: HotspotSignals | number,
  breakDelta?: number,
): number {
  if (typeof signalsOrTempF === "number") {
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
    return Math.round(Math.min(95, Math.max(40, 50 + raw)));
  }

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

export function estimateChloroScore(
  tempF: number,
  breakDelta: number,
  idealBreakDeltaF = 3,
): number {
  let base = 0;
  if (tempF < 64) base = 15;
  else if (tempF < 68) base = 13;
  else if (tempF < 72) base = 10;
  else if (tempF < 76) base = 8;
  else if (tempF < 80) base = 5;
  else base = 2;

  const breakRatio = idealBreakDeltaF > 0 ? breakDelta / idealBreakDeltaF : 0;
  const breakBonus = Math.min(7, breakRatio * 7);

  return Math.round(Math.min(20, base + breakBonus));
}

export function estimateAltimetryScore(
  tempF: number,
  breakDelta: number,
  lat: number,
  idealBreakDeltaF = 3,
): number {
  let latBonus = 0;
  if (lat >= 36 && lat <= 39) latBonus = 4;
  else if (lat >= 35 && lat < 36) latBonus = 3;
  else if (lat > 39 && lat <= 41) latBonus = 2;

  let base = 0;
  if (tempF >= 78) base = 9;
  else if (tempF >= 74) base = 7;
  else if (tempF >= 70) base = 5;
  else if (tempF >= 66) base = 3;
  else base = 1;

  const breakRatio = idealBreakDeltaF > 0 ? breakDelta / idealBreakDeltaF : 0;
  const breakBonus = Math.min(4, breakRatio * 4);

  return Math.round(Math.min(15, base + breakBonus + latBonus));
}

export function buildHotspotSignals(
  tempF: number,
  breakDelta: number,
  def: HotspotDef,
): HotspotSignals {
  const idealBreakDeltaF = def.siteIdealBreakDeltaF ?? 3;

  const { sstScore, sstBreakScore: rawBreakScore } = computeSSTSignals(
    tempF,
    breakDelta,
    def.idealSstF,
  );

  let gsBonus = 0;
  const lat = def.lat;
  if (lat >= 35 && lat < 39) {
    if (breakDelta >= 4) gsBonus = 6;
    else if (breakDelta >= 2) gsBonus = 3;
  } else if (lat >= 39 && lat <= 41) {
    if (breakDelta >= 2) gsBonus = 1;
  }
  const sstBreakScore = Math.min(35, rawBreakScore + gsBonus);

  const chloroScore = estimateChloroScore(tempF, breakDelta, idealBreakDeltaF);
  const altimetryScore = estimateAltimetryScore(tempF, breakDelta, def.lat, idealBreakDeltaF);
  
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
export const OC_INLET = { lat: 38.3289, lng: -75.0913 };
export const OC_RADIUS_NM = 100;

export function distFromOCInlet(lat: number, lng: number): number {
  return haversineNm(OC_INLET.lat, OC_INLET.lng, lat, lng);
}

// ---------------------------------------------------------------------------
// Canonical hotspot definitions
// ---------------------------------------------------------------------------
export interface SearchBbox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface HotspotDef {
  id: string;
  title: string;
  fallbackSstF: number;
  lat: number;
  lng: number;
  ambientLat: number;
  ambientLng: number;
  searchBbox: SearchBbox;
  minConfidence: number;
  historyPrior: number;
  idealSstF: number;
  siteIdealBreakDeltaF?: number;
  signals?: HotspotSignals;
}

export const FALLBACK_SST_CONFIDENCE_PENALTY = 0; 
export let HOTSPOTS_IN_RANGE: HotspotDef[] = []; 

export const HOTSPOT_DEFS: HotspotDef[] = [
  // ── North: NJ / Hudson ──────────────────────────────────────────────────
  {
    id: "4",
    title: "Hudson Canyon Rip",
    fallbackSstF: 72,
    lat: 39.52,
    lng: -72.05,
    ambientLat: 39.52,
    ambientLng: -72.8,
    searchBbox: { minLat: 39.0, maxLat: 40.0, minLng: -73.0, maxLng: -71.5 },
    minConfidence: 58, 
    idealSstF: 70,
    siteIdealBreakDeltaF: 2.5,
    historyPrior: 10,
  },
  // ── OC, MD / Delaware area ──────────────────────────────────────────────
  {
    id: "6",
    title: "Spencer Canyon",
    fallbackSstF: 75,
    lat: 39.05,
    lng: -72.7,
    ambientLat: 38.9,
    ambientLng: -73.45,
    searchBbox: { minLat: 38.7, maxLat: 39.5, minLng: -73.5, maxLng: -71.8 },
    minConfidence: 60,
    idealSstF: 72,
    siteIdealBreakDeltaF: 3.0,
    historyPrior: 10,
  },
  {
    id: "7",
    title: "Atlantis Canyon",
    fallbackSstF: 74,
    lat: 39.38,
    lng: -72.25,
    ambientLat: 39.38,
    ambientLng: -73.0,
    searchBbox: { minLat: 38.9, maxLat: 39.7, minLng: -73.0, maxLng: -71.6 },
    minConfidence: 58,
    idealSstF: 71,
    siteIdealBreakDeltaF: 2.5,
    historyPrior: 9,
  },
  // ── Mid-Atlantic shelf break ─────────────────────────────────────────────
  {
    id: "3",
    title: "Baltimore Canyon",
    fallbackSstF: 76,
    lat: 38.01,
    lng: -74.05,
    ambientLat: 38.01,
    ambientLng: -74.8,
    searchBbox: { minLat: 37.7, maxLat: 38.4, minLng: -74.8, maxLng: -73.2 },
    minConfidence: 60,
    idealSstF: 74,
    siteIdealBreakDeltaF: 3.5,
    historyPrior: 10,
  },
  {
    id: "5",
    title: "Wilmington Canyon Ledge",
    fallbackSstF: 73,
    lat: 38.52,
    lng: -73.42,
    ambientLat: 38.52,
    ambientLng: -74.15,
    searchBbox: { minLat: 38.2, maxLat: 38.9, minLng: -74.2, maxLng: -72.5 },
    minConfidence: 58,
    idealSstF: 72,
    siteIdealBreakDeltaF: 3.0,
    historyPrior: 7,
  },
  {
    id: "1",
    title: "Washington Canyon Break",
    fallbackSstF: 74,
    lat: 37.55,
    lng: -74.35,
    ambientLat: 37.55,
    ambientLng: -75.5,
    searchBbox: { minLat: 37.2, maxLat: 38.0, minLng: -75.5, maxLng: -73.5 },
    minConfidence: 62,
    idealSstF: 73,
    siteIdealBreakDeltaF: 4.5,
    historyPrior: 10,
  },
  // ── CRITICAL RE-MAPPING: ID 2 assigned directly to Poorman's Canyon ──────
  {
    id: "2",
    title: "Poorman's Canyon",
    fallbackSstF: 73.8,
    lat: 37.88, 
    lng: -74.12,
    ambientLat: 37.88,
    ambientLng: -75.10,
    searchBbox: { minLat: 37.6, maxLat: 38.2, minLng: -74.9, maxLng: -73.8 },
    minConfidence: 62,
    idealSstF: 72,
    siteIdealBreakDeltaF: 4.5, 
    historyPrior: 9,
  },
  {
    id: "8",
    title: "Diamond Shoals / Cape Hatteras",
    fallbackSstF: 78,
    lat: 35.15,
    lng: -75.2,
    ambientLat: 35.15,
    ambientLng: -75.95,
    searchBbox: { minLat: 34.8, maxLat: 36.0, minLng: -76.2, maxLng: -74.0 },
    minConfidence: 60,
    idealSstF: 76,
    siteIdealBreakDeltaF: 5.0,
    historyPrior: 10,
  },
];

// ---------------------------------------------------------------------------
// Pre-filter and sort initialization
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
