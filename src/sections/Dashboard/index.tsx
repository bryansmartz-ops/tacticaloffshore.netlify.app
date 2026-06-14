import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient"; 
import {
  Map,
  Fish,
  Sun,
  Waves,
  Cloud,
  Target,
  ChevronRight,
  Thermometer,
  Anchor,
  AlertTriangle,
} from "lucide-react";

export interface SSTResult {
  ok: boolean;
  fahrenheit: number;
  celsius: number;
  resolution: "0.02deg" | "0.01deg" | "unknown";
  timestamp: string;
}

type ConditionStatus = "GO" | "MARGINAL" | "NO-GO" | "loading" | "error";

const LAT = 38.3365;
const LNG = -75.0849;

// ─── Chronological Solunar Calculators ─────────────────────────────────────────
function jd(date: Date): number {
  const Y = date.getUTCFullYear();
  const M = date.getUTCMonth() + 1;
  const D = date.getTargetDate ? date.getTargetDate() : date.getDate();
  const A = Math.floor((14 - M) / 12);
  const y = Y + 4800 - A;
  const m = M + 12 * A - 3;
  return D + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

function moonPhaseScore(date: Date): number {
  const KNOWN_NEW_MOON_JD = 2451550.259;
  const SYNODIC = 29.53058867;
  const daysSince = jd(date) - KNOWN_NEW_MOON_JD;
  const phase = ((daysSince % SYNODIC) + SYNODIC) % SYNODIC;
  const distFromPeak = Math.min(Math.abs(phase), Math.abs(phase - 14.77), Math.abs(phase - 29.53));
  return Math.max(0, 100 - distFromPeak * 10);
}

function moonLongitude(j: number): number {
  const T = (j - 2451545.0) / 36525;
  const L0 = 218.3164477 + 481267.88123421 * T;
  const M = 357.5291092 + 35999.0502909 * T;
  const Mm = 134.9633964 + 477198.8675055 * T;
  const F = 93.272095 + 483202.0175233 * T;
  const D = 297.8501921 + 445267.1114034 * T;
  const lon = L0 + 6.288774 * Math.sin((Mm * Math.PI) / 180) + 1.274027 * Math.sin(((2 * D - Mm) * Math.PI) / 180) + 0.658314 * Math.sin(((2 * D) * Math.PI) / 180);
  return ((lon % 360) + 360) % 360;
}

function localSiderealTime(j: number, lngDeg: number): number {
  return (((280.46061837 + 360.98564736629 * (j - 2451545.0) + lngDeg) % 360) + 360) % 360;
}

function moonTransitUTC(date: Date): number {
  const noon = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0));
  let j0 = jd(noon);
  for (let iter = 0; iter < 2; iter++) {
    const ha = ((localSiderealTime(j0, LNG) - moonLongitude(j0) + 180) % 360) - 180;
    j0 -= ha / 360;
  }
  return ((j0 - Math.floor(j0
