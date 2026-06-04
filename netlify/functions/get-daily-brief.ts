// netlify/functions/get-daily-brief.ts
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
  primary_target_zone: string;    
  secondary_target_zone: string;
  primary_lat: number;
  primary_lng: number;
  secondary_lat: number;
  secondary_lng: number;
  live_sst_value: number;
  live_break_delta: number;
}

interface DailyBriefRecord extends LlmFields {
  forecast_date: string;
  morning_run_time: string;
  afternoon_run_time: string;
  total_troll_time: string;
  total_day_duration: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

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

  const departureHour = 5; 
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

// ─── LLM Synthesis ────────────────────────────────────────────────────────────

async function synthesizeWithClaude({
  weatherForecastText,
  sstSummaryText,
  altimetrySummaryText,
  rtofsSummaryText,
  transitTimes,
}: {
  weatherForecastText: string;
  sstSummaryText: string;
  altimetrySummaryText: string;
  rtofsSummaryText: string;
  transitTimes: TransitTimes;
}): Promise<LlmFields> {
  const systemPrompt = `You are a professional offshore fishing report writer specializing in Mid-Atlantic canyon fishing (Washington Canyon to Poorman's Canyon).
You produce concise, tactical, data-driven fishing briefs for experienced captains.
Your tone is professional but direct. Always respond with valid JSON only. No markdown fences, no commentary.`;

  const userPrompt = `Generate a daily offshore fishing brief JSON object using ONLY the environmental data blocks provided below.
Today's date: ${new Date().toISOString().split("T")[0]}

=== METEOROLOGICAL WINDS & LOGISTICS (FROM CACHE) ===
${weatherForecastText}

=== CACHED SST IMAGERY DATA ===
${sstSummaryText}

=== COPERNICUS RADAR ALTIMETRY (SEA SURFACE HEIGHT ANOMALIES) ===
${altimetrySummaryText}

=== NOAA RTOFS DYNAMIC OCEAN PHYSICS MODEL ===
${rtofsSummaryText}

=== VESSEL PERFORMANCE / TRANSIT PLAN ===
- Outbound: ${PERFORMANCE.outboundNm} nm @ ${PERFORMANCE.outboundKts} kts → ${transitTimes.morning_run_time} run time (arrive ~${transitTimes.morningArrivalLocal})
- Troll leg: ${PERFORMANCE.trollNm} nm @ ${PERFORMANCE.trollKts} kts → ${transitTimes.total_troll_time} troll time
- Return: ${PERFORMANCE.returnNm} nm @ ${PERFORMANCE.returnKts} kts → ${transitTimes.afternoon_run_time} return time

Return a JSON object with EXACTLY these keys (all fields mandatory):
{
  "environmental_summary": "2–3 sentence synthesis of overall offshore conditions combining winds, SST trends, and sub-surface altimetry structures",
  "shelf_temp": "e.g. '71.2°F'",
  "canyon_wall_temp": "e.g. '74.8°F'",
  "break_zone_description": "location/quality of the thermal break based on SST spread and physics models",
  "altimetry_currents": "Cross-reference Copernicus sea surface height anomalies with current winds to describe exact current direction",
  "wind_forecast": "concise wind summary derived from speed and angles provided",
  "sea_state": "inferred wave conditions based on the wind speed vectors",
  "barometric_pressure": "surface pressure trends if logged in metrics, else 'Not reported'",
  "operational_warning": "any safety concern, or null if none",
  "trolling_spread": "recommended lure/bait spread for late May/early June Mid-Atlantic",
  "sonar_strategy": "depth range to target, structure to look for",
  "primary_target_zone": "Provide specific high-confidence coordinates for the primary temperature break. Format with explicit Lat/Long and corresponding estimated Loran-C time delay numbers (e.g., 27100 / 43000 chains).",
  "secondary_target_zone": "Provide alternative high-confidence coordinate numbers. Format with explicit Lat/Long and Loran-C breakdowns.",
  "primary_lat": 37.5500,
  "primary_lng": -74.3500,
  "secondary_lat": 37.6200,
  "secondary_lng": -74.2800,
  "live_sst_value": 74.2,
  "live_break_delta": 3.4
}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
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
    const parsed = JSON.parse(raw);
    parsed.primary_lat = parseFloat(parsed.primary_lat) || 37.55;
    parsed.primary_lng = parseFloat(parsed.primary_lng) || -74.35;
    parsed.secondary_lat = parseFloat(parsed.secondary_lat) || 37.62;
    parsed.secondary_lng = parseFloat(parsed.secondary_lng) || -74.28;
    parsed.live_sst_value = parseFloat(parsed.live_sst_value) || 72.0;
    parsed.live_break_delta = parseFloat(parsed.live_break_delta) || 0.0;
    return parsed as LlmFields;
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
    .upsert(record, { onConflict: "forecast_date" })
    .select()
    .single<{ id: string }>();

  if (error) {
    throw new Error(`Supabase upsert failed: ${error.message}`);
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
      <h1 style="margin:0;font-size:22px;font-weight:700;color:#f0f9ff;letter-spacing:0.5px;">⚓ Tactical Offshore Daily Brief</h1>
      <p style="margin:6px 0 0;color:#bae6fd;font-size:14px;">${record.forecast_date} — Mid-Atlantic Canyons</p>
    </div>
    <div style="padding:24px 32px;">
      <h2 style="color:#38bdf8;font-size:15px;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Environmental Overview</h2>
      <p style="margin:0 0 24px;line-height:1.7;color:#cbd5e1;">${record.environmental_summary}</p>
      
      <h2 style="color:#f59e0b;font-size:15px;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">🎯 High-Confidence Coordinates</h2>
      <table style="width:100%;border-collapse:collapse;background:#0f172a;border-radius:8px;overflow:hidden;margin-bottom:24px;">
        ${row("Primary Waypoint", record.primary_target_zone)}
        ${row("Secondary Waypoint", record.secondary_target_zone)}
      </table>

      <h2 style="color:#38bdf8;font-size:15px;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Water Conditions</h2>
      <table style="width:100%;border-collapse:collapse;background:#0f172a;border-radius:8px;overflow:hidden;margin-bottom:24px;">
        ${row("Shelf Temp", record.shelf_temp)}
        ${row("Canyon Wall Temp", record.canyon_wall_temp)}
        ${row("Thermal Break", record.break_zone_description)}
        ${row("Altimetry / Currents", record.altimetry_currents)}
      </table>
      <h2 style="color:#38bdf8;font-size:15px;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Weather</h2>
      <table style="width:100%;border-collapse:collapse;background:#0f172a;border-radius:8px;overflow:hidden;margin-bottom:24px;">
        ${row("Wind", record.wind_forecast)}
        ${row("Sea State", record.sea_state)}
        ${row("Barometric Pressure", record.barometric_pressure)}
      </table>
      <h2 style="color:#38bdf8;font-size:15px;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Transit Plan</h2>
      <table style="width:100%;border-collapse:collapse;background:#0f172a;border-radius:8px;overflow:hidden;margin-bottom:24px;">
        ${row("Morning Run", record.morning_run_time)}
        ${row("Troll Time", record.total_troll_time)}
        ${row("Afternoon Run", record.afternoon_run_time)}
        ${row("Total Day", record.total_day_duration)}
      </table>
      <h2 style="color:#38bdf8;font-size:15px;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Tactical</h2>
      <table style="width:100%;border-collapse:collapse;background:#0f172a;border-radius:8px;overflow:hidden;margin-bottom:24px;">
        ${row("Trolling Spread", record.trolling_spread)}
        ${row("Sonar Strategy", record.sonar_strategy)}
      </table>
      ${record.operational_warning ? `<div style="background:#7c1d1d;border-left:4px solid #ef4444;padding:14px 18px;border-radius:6px;margin-bottom:24px;"><strong style="color:#fca5a5;">⚠ Operational Warning</strong><p style="margin:6px 0 0;color:#fecaca;">${record.operational_warning}</p></div>` : ""}
    </div>
    <div style="padding:16px 32px;border-top:1px solid #334155;text-align:center;">
      <p style="margin:0;font-size:12px;color:#475569;">Generated by Tactical Offshore · tacticaloffshore.netlify.app</p>
    </div>
  </div>
</body>
</html>`;
}

async function sendEmail(record: DailyBriefRecord): Promise<{ id?: string }> {
  const resend = new Resend(process.env.RESEND_API_KEY);
  return await resend.emails.send({
    from: "Tactical Offshore <onboarding@resend.dev>",
    to: [RECIPIENT_EMAIL],
    subject: `⚓ Daily Brief — ${record.forecast_date}`,
    html: buildEmailHtml(record),
  }) as any;
}

// ─── Netlify v2 Handler ───────────────────────────────────────────────────────

export default async function handler(req: Request, context: Context): Promise<Response> {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const forecastDate = new Date().toISOString().split("T")[0];

  try {
    // 1. MUTEX LOCK CHECK: Kill race-condition double fires immediately
    const { data: lock, error: lockError } = await supabase
      .from("dispatch_logs")
      .insert([{ dispatch_date: forecastDate, status: "PROCESSING" }]);

    if (lockError && lockError.code === "23505") {
      console.log(`[brief-lock] Blocked duplicate engine execution loop for ${forecastDate}. Firing aborted.`);
      return Response.json({ success: true, message: "Duplicate execution neutralized by database lock state." });
    }

    console.log(`[brief] Assembling daily brief from cache row for ${forecastDate}`);

    const { data: cacheArray, error: cacheError } = await supabase
      .from("ocean_data_cache")
      .select("*")
      .limit(1);

    if (cacheError || !cacheArray || cacheArray.length === 0) {
      throw new Error(`Failed to retrieve environmental data cache: ${cacheError?.message || 'Cache table is completely empty'}`);
    }

    const cache = cacheArray[0];

    let weatherText = "Weather Cache Empty.";
    if (cache.weather_data?.hourly) {
      const h = cache.weather_data.hourly;
      const cur = cache.weather_data.current;
      const indices = [6, 12, 16]; 
      weatherText = indices.map(i => {
        return `[Time: ${h.time[i] || i}] Wind: ${h.wind_speed_10m?.[i]}kts from ${h.wind_direction_10m?.[i]}°`;
      }).join("\n");
      if (cur?.surface_pressure) {
        weatherText += `\n[Surface Pressure] ${cur.surface_pressure} hPa`;
      }
    }

    let sstText = "";
    if (cache.sst_data) {
      const sst = cache.sst_data;
      sstText = `SST Range: ${sst.minF} to ${sst.maxF}°F, Avg: ${sst.avgF}°F across ${sst.sampleCount} sensor grids.\nSource: ${sst.source || "Satellite"}`;
      if (cache.sst_is_fallback) {
        sstText += `\nCRITICAL METADATA: Current satellite orbital pass is cloud-blinded. This temperature data represents the Last Known Good cloud-free window captured at local timestamp: ${cache.updated_at}.`;
      }
    } else {
      stText = "No successful satellite passes recorded in cache. Operating on standard early-June historical averages (66-71°F).";
    }

    let altimetryText = "Altimetry stream reporting standby mode. Rely on bottom structure gradients.";
    if (cache.altimetry_data && cache.altimetry_data.sea_surface_height_anomaly_meters) {
      const alt = cache.altimetry_data;
      altimetryText = `Source: ${alt.source}\nSea Surface Height Anomaly: ${alt.sea_surface_height_anomaly_meters}\nInferred Structure: ${alt.structure_type}\nCloud Blockage: ${alt.cloud_blockage || "0%"}\nCaptured At: ${alt.captured_at}`;
    }

    let rtofsText = "RTOFS model array frame standby.";
    if (cache.chlorophyll_data && cache.chlorophyll_data.model_name) {
      const rtofs = cache.chlorophyll_data;
      rtofsText = `Model Node: ${rtofs.model_name}\nStatus: ${rtofs.status}\nDensity Factor: ${rtofs.water_density_factor}\nVector Dynamics: ${rtofs.inferred_movement}\nSynced At: ${rtofs.captured_at}`;
      if (cache.chloro_is_fallback) {
        rtofsText += `\n(Operating on rolled dynamic baseline metrics)`;
      }
    }

    const transitTimes = calculateTransitTimes();

    console.log("[brief] Routing data payloads straight into Claude...");
    const llmFields = await synthesizeWithClaude({
      weatherForecastText: weatherText,
      sstSummaryText: sstText,
      altimetrySummaryText: altimetryText,
      rtofsSummaryText: rtofsText,
      transitTimes
    });

    const record: DailyBriefRecord = {
      forecast_date: forecastDate,
      ...llmFields,
      morning_run_time: transitTimes.morning_run_time,
      afternoon_run_time: transitTimes.afternoon_run_time,
      total_troll_time: transitTimes.total_troll_time,
      total_day_duration: transitTimes.total_day_duration,
    };

    const savedRecord = await writeToSupabase(record);
    const emailResult = await sendEmail(record);

    // 2. SUCCESS CONFIRMATION: Flip state to success so subsequent hooks lock out cleanly
    await supabase
      .from("dispatch_logs")
      .update({ status: "SUCCESS" })
      .eq("dispatch_date", forecastDate);

    return Response.json({
      success: true,
      record_id: savedRecord.id,
      email_id: emailResult?.data?.id ?? null,
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[brief] BRIEF GENERATOR FATAL ERROR:", message);

    // 3. EXCEPTION RESET: Clear the daily constraint lock on real runtime errors so you can retry
    await supabase.from("dispatch_logs").delete().eq("dispatch_date", forecastDate);

    return Response.json({ success: false, error: message }, { status: 500 });
  }
}

export const config: Config = {
  schedule: "0 8 * * *", 
  timeout: 60,
};
