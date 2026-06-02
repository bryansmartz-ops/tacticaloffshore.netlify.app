// sync-ocean-cache.ts
// Scheduled Netlify Worker: Syncs environmental frames on an 8-hour rotation loop
// ─────────────────────────────────────────────────────────────────────

import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const SUPABASE = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Utility to ensure a slow government endpoint can never block our function execution
async function fetchWithTimeout(url: string, options = {}, timeout = 12000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

export default async function handler(req: Request) {
  console.log("[sync] Starting 8-hour environmental data scrape...");
  const updatePayload: any = { updated_at: new Date().toISOString() };

  // 1. Weather Data (Open-Meteo Global Model)
  try {
    const res = await fetchWithTimeout("https://api.open-meteo.com/v1/forecast?latitude=37.65&longitude=-74.80&hourly=wind_speed_10m,wind_direction_10m&current=surface_pressure&wind_speed_unit=kn&timezone=America%2FNew_York&forecast_days=1");
    if (res.ok) {
      updatePayload.weather_data = await res.json();
      console.log("[sync] Weather vectors successfully mapped.");
    }
  } catch (e) {
    console.warn("[sync] Weather server unreachable. Retaining LKG framework.", e);
  }

  // 2. SST Grid Parsing (JPL MUR Sat Pass with Kelvin Filtering)
  let sstFailed = false;
  try {
    const sstUrl = "https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.json?analysed_sst[(last)][(37.40):(37.87)][(-76.00):(-72.00)]";
    const res = await fetchWithTimeout(sstUrl, {}, 15000); // 15-second tracking window
    
    if (res.ok) {
      const data = await res.json() as any;
      const rows = data?.table?.rows ?? [];
      const validPoints = rows
        .map((r: any) => r[3])
        .filter((v: number | null) => v !== null && !isNaN(v) && v > 275); // Filter out cloud arrays (< 35°F)

      if (validPoints.length > 0) {
        const fVals = validPoints.map((k: number) => ((k - 273.15) * 9) / 5 + 32);
        updatePayload.sst_data = {
          avgF: (fVals.reduce((a, b) => a + b, 0) / fVals.length).toFixed(1),
          minF: Math.min(...fVals).toFixed(1),
          maxF: Math.max(...fVals).toFixed(1),
          sampleCount: fVals.length,
          source: "JPL MUR Satellite Pass"
        };
        updatePayload.sst_is_fallback = false;
        console.log("[sync] Live Satellite SST frames processed cleanly.");
      } else {
        sstFailed = true;
      }
    } else {
      sstFailed = true;
    }
  } catch (e) {
    console.warn("[sync] Satellite SST tracking timeout. Signaling database preservation fallback.", e);
    sstFailed = true;
  }

  // 3. Commit the Data Frame to your permanent state container
  const { error } = await SUPABASE
    .from("ocean_data_cache")
    .update(updatePayload)
    .eq("id", "mid_atlantic_canyons");

  if (error) {
    console.error("[sync] Fatal Database Cache state failure:", error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }

  console.log("[sync] Execution loop completed successfully.");
  return Response.json({ success: true, changes: Object.keys(updatePayload) });
}

export const config: Config = {
  schedule: "0 */8 * * *", // Fires completely automatically every 8 hours
};
