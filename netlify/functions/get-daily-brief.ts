// get-daily-brief.ts
// Netlify v2 Serverless Function — Daily Offshore Fishing Stand-up Brief
// ─────────────────────────────────────────────────────────────────────

import type { Config, Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

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

  // Direct network call hit armed with Tier 2 validation and high-fidelity Sonnet 3.5 target snapshots
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Direct Anthropic API call failed: status ${response.status} - ${errorText}`);
  }

  const result = await response.json() as any;
  const raw = result?.content?.[0]?.text?.trim() || null;

  if (!raw) {
    throw new Error("Direct Anthropic call returned an empty content block.");
  }

  try {
    return JSON.parse(raw) as LlmFields;
  } catch {
    throw new Error(`Anthropic response was not valid JSON:\n${raw}`);
  }
}

// ─── Supabase Writer ──────────────────────────────────────────────────────────

async function writeToSupabase(record: DailyBriefRecord): Promise<{ id: string }> {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await supabase
    .from("daily_briefs")
    .insert([record])
    .select()
    .single<{ id: string }>();

  if (error) {
    throw new Error(`Supabase insert failed: ${error.message}`);
  }

  if (!data) {
    throw new Error("Supabase insert returned no data.");
  }

  return data;
}

// ─── Email Renderer ───────────────────────────────────────────────────────────

function buildEmailHtml(record: DailyBriefRecord): string {
  const row = (label: string, value: string | null | undefined): string =>
    value
      ? `<tr>
           <td style="padding:6px 12px;font-weight:600;color:#64748b;white-space:nowrap;">${label}</td>
           <td style="padding:6px 12px;">${value}</td>
         </tr>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Daily Offshore Brief</title></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI',Arial,sans-serif;color:#e2e8f0;">
  <div style="max-width:680px;margin:32px auto;background:#1e293b;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.4);">

    <div style="background:linear-gradient(135deg,#0c4a6e,#0369a1);padding:28px 32px;">
      <h1 style="margin:0;font-size:22px;font-weight:700;color:#f0f9ff;letter-spacing:0.5px;">
        ⚓ Tactical Offshore Daily Brief
      </h1>
      <p style="margin:6px 0 0;color:#bae6fd;font-size:14px;">
        ${record.forecast_date} — Mid-Atlantic Canyons
      </p>
    </div>

    <div style="padding:24px 32px;">
      <h2 style="color:#38bdf8;font-size:15px;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">
        Environmental Overview
      </h2>
      <p style="margin:0 0 24px;line-height:1.7;color:#cbd5e1;">${record.environmental_summary}</p>

      <h2 style="color:#38bdf8;font-size:15px;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">
        Water Conditions
      </h2>
      <table style="width:100%;border-collapse:collapse;background:#0f172a;border-radius:8px;overflow:hidden;margin-bottom:24px;">
        ${row("Shelf Temp", record.shelf_temp)}
        ${row("Canyon Wall Temp", record.canyon_wall_temp)}
        ${row("Thermal Break", record.break_zone_description)}
        ${row("Altimetry / Currents", record.altimetry_currents)}
      </table>

      <h2 style="color:#38bdf8;font-size:15px;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">
        Weather
      </h2>
      <table style="width:100%;border-collapse:collapse;background:#0f172a;border-radius:8px;overflow:hidden;margin-bottom:24px;">
        ${row("Wind", record.wind_forecast)}
        ${row("Sea State", record.sea_state)}
        ${row("Barometric Pressure", record.barometric_pressure)}
      </table>

      <h2 style="color:#38bdf8;font-size:15px;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">
        Transit Plan
      </h2>
      <table style="width:100%;border-collapse:collapse;background:#0f172a;border-radius:8px;overflow:hidden;margin-bottom:24px;">
        ${row("Morning Run", record.morning_run_time)}
        ${row("Troll Time", record.total_troll_time)}
        ${row("Afternoon Run", record.afternoon_run_time)}
        ${row("Total Day", record.total_day_duration)}
      </table>

      <h2 style="color:#38bdf8;font-size:15px;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">
        Tactical
      </h2>
      <table style="width:100%;border-collapse:collapse;background:#0f172a;border-radius:8px;overflow:hidden;margin-bottom:24px;">
        ${row("Trolling Spread", record.trolling_spread)}
        ${row("Sonar Strategy", record.sonar_strategy)}
      </table>

      ${
        record.operational_warning
          ? `<div style="background:#7c1d1d;border-left:4px solid #ef4444;padding:14px 18px;border-radius:6px;margin-bottom:24px;">
               <strong style="color:#fca5a5;">⚠ Operational Warning</strong>
               <p style="margin:6px 0 0;color:#fecaca;">${record.operational_warning}</p>
             </div>`
          : ""
      }
    </div>

    <div style="padding:16px 32px;border-top:1px solid #334155;text-align:center;">
      <p style="margin:0;font-size:12px;color:#475569;">
        Generated by Tactical Offshore · tacticaloffshore.netlify.app
      </p>
    </div>
  </div>
</body>
</html>`;
}

async function sendEmail(record: DailyBriefRecord): Promise<{ id?: string }> {
  const resend = new Resend(process.env.RESEND_API_KEY);
  
  const { data, error } = await resend.emails.send({
    from: "Tactical Offshore <onboarding@resend.dev>",
    to: [RECIPIENT_EMAIL],
    subject: `⚓ Daily Brief — ${record.forecast_date}`,
    html: buildEmailHtml(record),
  });

  if (error) {
    throw new Error(`Resend email failed: ${JSON.stringify(error)}`);
  }
  
  return data || {};
}

// ─── Environment Validation ───────────────────────────────────────────────────

function validateEnv(): void {
  const required = [
    "ANTHROPIC_API_KEY",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "RESEND_API_KEY",
  ] as const;

  const missing = required.filter((k) => !process.env[k]);

  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }
}

// ─── Netlify v2 Handler ───────────────────────────────────────────────────────

export default async function handler(
  _req: Request,
  _context: Context
): Promise<Response> {
  try {
    validateEnv();

    const forecastDate = new Date().toISOString().split("T")[0];
    console.log(`[brief] Starting daily brief for ${forecastDate}`);

    // 1. Fetch data sources from the unrestricted global weather network grid
    console.log("[brief] Fetching Global Weather Vectors and ERDDAP SST...");
    const [weatherForecast, sstData] = await Promise.all([
      fetchGlobalWeather(),
      fetchERDDAPSst(),
    ]);
    console.log("[brief] Data fetch complete.");

    // 2. Calculate transit timelines
    const transitTimes = calculateTransitTimes();
    console.log("[brief] Transit times calculated:", transitTimes);

    // 3. Synthesize with Claude via raw HTTP fetch
    console.log("[brief] Sending direct HTTP POST to Anthropic servers...");
    const llmFields = await synthesizeWithClaude({
      weatherForecast,
      sstData,
      transitTimes,
    });
    console.log("[brief] LLM synthesis complete.");

    // 4. Assemble the full database record
    const record: DailyBriefRecord = {
      forecast_date: forecastDate,
      ...llmFields,
      morning_run_time: transitTimes.morning_run_time,
      afternoon_run_time: transitTimes.afternoon_run_time,
      total_troll_time: transitTimes.total_troll_time,
      total_day_duration: transitTimes.total_day_duration,
    };

    // 5. Write to Supabase
    console.log("[brief] Writing to Supabase...");
    const savedRecord = await writeToSupabase(record);
    console.log(`[brief] Saved record id: ${savedRecord.id}`);

    // 6. Send email
    console.log("[brief] Sending email via Resend...");
    const emailResult = await sendEmail(record);
    console.log(`[brief] Email sent, id: ${emailResult?.id}`);

    return Response.json({
      success: true,
      record_id: savedRecord.id,
      forecast_date: forecastDate,
      email_id: emailResult?.id ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[brief] FATAL ERROR:", message);

    return Response.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

// ─── Netlify Function Config ──────────────────────────────────────────────────

export const config: Config = {
  schedule: "0 8 * * *", // 08:00 UTC = 4:00 AM Eastern Time (EDT)
  timeout: 60,           // Extends runtime window to 60 seconds to absorb slow NOAA data fetches
};
