// get-daily-brief.ts
// Netlify v2 Serverless Function — Daily Offshore Fishing Stand-up Brief
// ─────────────────────────────────────────────────────────────────────

import type { Config, Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import Anthropic from "@anthropic-ai/sdk";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TransitTimes {
  morning_run_time: string;
  afternoon_run_time: string;
  total_troll_time: string;
  total_day_duration: string;
  morningArrivalLocal: string;
  afternoonDepartLocal: string;
}

interface SstData {
  avgF: string;
  minF: string;
  maxF: string;
  sampleCount: number;
  rawSummary: string;
}

interface ErddapResponse {
  table: {
    rows: Array<[string, number, number, number | null]>;
  };
}

interface LlmFields {
  environmental_summary: string;
  shelf_temp: string;
  canyon_wall_temp: string;
  break_zone_description: string;
  altimetry_currents: string;
  wind_forecast: string;
  sea_state: string;
  barometric_pressure: string;
  operational_warning: string | null;
  trolling_spread: string;
  sonar_strategy: string;
}

interface DailyBriefRecord extends LlmFields {
  forecast_date: string;
  morning_run_time: string;
  afternoon_run_time: string;
  total_troll_time: string;
  total_day_duration: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Global meteorological model — 100% boundary-free coverage out to the deep canyons
const GLOBAL_WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=37.65&longitude=-74.80&hourly=wind_speed_10m,wind_direction_10m,relative_humidity_2m&current=surface_pressure&wind_speed_unit=kn&timezone=America%2FNew_York&forecast_days=1" as const;

const ERDDAP_URL = [
  "https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.json",
  "?analysed_sst",
  "[(last)]",
  "[(37.40):(37.87)]",
  "[(-76.00):(-72.00)]",
].join("") as const;

const PERFORMANCE = {
  outboundNm: 62,
  outboundKts: 24,
  trollNm: 32,
  trollKts: 8,
  returnNm: 56,
  returnKts: 20,
} as const;

const RECIPIENT_EMAIL = "bryan.s.martz@gmail.com" as const;

// ─── Time Calculations ────────────────────────────────────────────────────────

function calculateTransitTimes(): TransitTimes {
  const toHHMM = (decimalHours: number): string => {
    const h = Math.floor(decimalHours);
    const m = Math.round((decimalHours - h) * 60);
    return `${h}h ${m.toString().padStart(2, "0")}m`;
  };

  const toTimeString = (decimalHour: number): string => {
    const h = Math.floor(decimalHour) % 24;
    const m = Math.round((decimalHour % 1) * 60);
    const period = h < 12 ? "AM" : "PM";
    const displayH = h % 12 || 12;
    return `${displayH}:${m.toString().padStart(2, "0")} ${period}`;
  };

  const outboundHrs = PERFORMANCE.outboundNm / PERFORMANCE.outboundKts;
  const trollHrs = PERFORMANCE.trollNm / PERFORMANCE.trollKts;
  const returnHrs = PERFORMANCE.returnNm / PERFORMANCE.returnKts;
  const totalHrs = outboundHrs + trollHrs + returnHrs;

  const departureHour = 5; // 05:00 local departure
  const morningArrivalHr = departureHour + outboundHrs;
  const afternoonDepartHr = morningArrivalHr + trollHrs;

  return {
    morning_run_time: toHHMM(outboundHrs),
    afternoon_run_time: toHHMM(returnHrs),
    total_troll_time: toHHMM(trollHrs),
    total_day_duration: toHHMM(totalHrs),
    morningArrivalLocal: toTimeString(morningArrivalHr),
    afternoonDepartLocal: toTimeString(afternoonDepartHr),
  };
}

// ─── Data Fetchers ────────────────────────────────────────────────────────────

async function fetchGlobalWeather(): Promise<string> {
  const res = await fetch(GLOBAL_WEATHER_URL);

  if (!res.ok) {
    throw new Error(`Global Weather API failed with status ${res.status}`);
  }

  const data = await res.json() as any;
  const hourly = data?.hourly;
  const current = data?.current;

  if (!hourly || !hourly.time) {
    throw new Error("Failed to extract hourly metrics from Global Weather API.");
  }

  const indices = [6, 12, 16];
  const summaryBlocks = indices.map(i => {
    const timeLabel = hourly.time[i] ? new Date(hourly.time[i]).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : `${i}:00`;
    const speed = hourly.wind_speed_10m?.[i] ?? "N/A";
    const dir = hourly.wind_direction_10m?.[i] ?? "N/A";
    const humidity = hourly.relative_humidity_2m?.[i] ?? "N/A";
    return `[Time: ${timeLabel}] Wind: ${speed}kts from ${dir}° | Relative Humidity: ${humidity}%`;
  });

  const pressureText = current?.surface_pressure ? `\n[Current Surface Pressure] ${current.surface_pressure} hPa` : "";
  return summaryBlocks.join("\n") + pressureText;
}

async function fetchERDDAPSst(): Promise<SstData> {
  const res = await fetch(ERDDAP_URL);

  if (!res.ok) {
    throw new Error(`ERDDAP error ${res.status}: ${res.statusText}`);
  }

  const data = (await res.json()) as ErddapResponse;
  const rows = data?.table?.rows ?? [];

  if (!rows.length) {
    throw new Error("ERDDAP returned no SST rows.");
  }

  const sstValues: number[] = rows
    .map((r) => r[3])
    .filter((v): v is number => v !== null && !isNaN(v))
    .map((k) => ((k - 273.15) * 9) / 5 + 32); // K → °F

  if (!sstValues.length) {
    throw new Error("No valid SST values parsed from ERDDAP response.");
  }

  const avg = sstValues.reduce((a, b) => a + b, 0) / sstValues.length;
  const min = Math.min(...sstValues);
  const max = Math.max(...sstValues);

  return {
    avgF: avg.toFixed(1),
    minF: min.toFixed(1),
    maxF: max.toFixed(1),
    sampleCount: sstValues.length,
    rawSummary: `SST range ${min.toFixed(1)}–${max.toFixed(1)}°F, avg ${avg.toFixed(1)}°F across ${sstValues.length} grid points (Lat 37.40–37.87, Lon -76.00 to -72.00)`,
  };
}

// ─── LLM Synthesis ────────────────────────────────────────────────────────────

async function synthesizeWithClaude({
  weatherForecast,
  sstData,
  transitTimes,
}: {
  weatherForecast: string;
  sstData: SstData;
  transitTimes: TransitTimes;
}): Promise<LlmFields> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const systemPrompt = `You are a professional offshore fishing report writer specializing in Mid-Atlantic canyon fishing (Washington Canyon to Poorman's Canyon).
You produce concise, tactical, data-driven fishing briefs for experienced captains.
Your tone is professional but direct — think coast guard briefing meets experienced mate's log.
Always respond with valid JSON only. No markdown fences, no commentary.`;

  const userPrompt = `Generate a daily offshore fishing brief JSON object using ONLY the data below.
Today's date: ${new Date().toISOString().split("T")[0]}

=== METEOROLOGICAL WINDS & LOGISTICS ===
${weatherForecast}

=== SST DATA (Mid-Atlantic Canyons, MUR Analysis) ===
${sstData.rawSummary}

=== VESSEL PERFORMANCE / TRANSIT PLAN ===
- Outbound: ${PERFORMANCE.outboundNm} nm @ ${PERFORMANCE.outboundKts} kts → ${transitTimes.morning_run_time} run time (arrive ~${transitTimes.morningArrivalLocal})
- Troll leg: ${PERFORMANCE.trollNm} nm @ ${PERFORMANCE.trollKts} kts → ${transitTimes.total_troll_time} troll time
- Return: ${PERFORMANCE.returnNm} nm @ ${PERFORMANCE.returnKts} kts → ${transitTimes.afternoon_run_time} return time
- Wheels up ~${transitTimes.afternoonDepartLocal}

Return a JSON object with EXACTLY these keys (all strings unless noted):
{
  "environmental_summary": "2–3 sentence synthesis of overall offshore conditions",
  "shelf_temp": "e.g. '71.2°F'",
  "canyon_wall_temp": "e.g. '74.8°F' — infer warmer wall from SST gradient if present",
  "break_zone_description": "location/quality of the thermal break based on SST spread",
  "altimetry_currents": "describe likely current direction/strength inferred from SST pattern and wind direction data",
  "wind_forecast": "concise wind summary derived from speed and angles provided",
  "sea_state": "inferred wave conditions based on the wind speed vectors, direction history, and location",
  "barometric_pressure": "surface pressure trends if logged in metrics, else 'Not reported'",
  "operational_warning": "any safety or operational concern, or null if none",
  "trolling_spread": "recommended lure/bait spread for current SST and season (late May/early June Mid-Atlantic)",
  "sonar_strategy": "depth range to target, structure to look for, temperature break approach"
}`;

  // Stable production snapshot identifier string
  const message = await client.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1200,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const firstBlock = message.content[0];
  const raw = firstBlock?.type === "text" ? firstBlock.text.trim() : null;

  if (!raw) {
    throw new Error("Claude returned an empty response.");
  }

  try {
    return JSON.parse(raw) as LlmFields;
