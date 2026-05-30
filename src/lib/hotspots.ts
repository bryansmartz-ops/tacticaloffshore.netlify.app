/**
 * Shared hotspot definitions and helpers
 * Single source of truth used by both TacticalMap and Hotspots sections.
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
 * Confidence % from live SST °F and breakDelta °F.
 * Base 50 + up to 25 pts for warm SST + up to 25 pts for strong break (ΔT ≥ 4°F).
 * Clamped 40–95.
 */
export function computeConfidence(tempF: number, breakDelta: number): number {
  const sstScore = Math.max(0, Math.min(25, ((tempF - 65) / 15) * 25));
  const breakScore = Math.max(0, Math.min(25, (breakDelta / 4) * 25));
  return Math.round(Math.min(95, Math.max(40, 50 + sstScore + breakScore)));
}

export function confidenceColor(c: number): string {
  if (c >= 80) return "#34d399";
  if (c >= 65) return "#fbbf24";
  return "#f87171";
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
}

export const HOTSPOT_DEFS: HotspotDef[] = [
  {
    id: "1",
    title: "Washington Canyon Break",
    fallbackSstF: 76,
    lat: 37.55,
    lng: -74.35,
    ambientLat: 37.55,
    ambientLng: -73.6,
    bboxPad: 0.15,
  },
  {
    id: "2",
    title: "Norfolk Canyon Edge",
    fallbackSstF: 74,
    lat: 37.05,
    lng: -74.65,
    ambientLat: 37.05,
    ambientLng: -73.9,
    bboxPad: 0.15,
  },
  {
    id: "3",
    title: "Baltimore Canyon Warm Pocket",
    fallbackSstF: 78,
    lat: 38.22,
    lng: -73.82,
    ambientLat: 38.22,
    ambientLng: -73.1,
    bboxPad: 0.15,
  },
  {
    id: "4",
    title: "Hudson Canyon Rip",
    fallbackSstF: 72,
    lat: 39.52,
    lng: -72.05,
    ambientLat: 39.52,
    ambientLng: -71.3,
    bboxPad: 0.15,
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
  },
];
