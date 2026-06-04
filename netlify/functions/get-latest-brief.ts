// netlify/functions/get-latest-brief.ts
// Hardened Zero-Dependency Serverless Engine — Unified Data Cache & Buoy Fetch
// ─────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json"
};

const NDBC_BUOY_URL = "https://www.ndbc.noaa.gov/data/realtime2/44009.txt";

export const handler = async (event: any) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let liveBuoyData = { wind: null, wave: null, ts: "Offline" };

  // ─── SECTION 1: DIRECT SERVER-SIDE BUOY FETCH (NO CORS PROXY NEEDED) ───
  try {
    const buoyRes = await fetch(NDBC_BUOY_URL);
    if (buoyRes.ok) {
      const text = await buoyRes.text();
      const lines = text.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
      const parts = lines[0]?.trim().split(/\s+/) ?? [];
      
      const getMetric = (i: number): number | null => {
        const v = parseFloat(parts[i]);
        return isNaN(v) || v === 99 || v === 999 || v === 9999 ? null : v;
      };

      const wspd = getMetric(6);
      const wvht = getMetric(8);
      
      const month = parts[1]?.padStart(2, "0") ?? "--";
      const day = parts[2]?.padStart(2, "0") ?? "--";
      const hour = parts[3]?.padStart(2, "0") ?? "--";
      const min = parts[4]?.padStart(2, "0") ?? "--";

      liveBuoyData = {
        wind: wspd !== null ? Math.round(wspd * 1.94384) : null,
        wave: wvht !== null ? parseFloat((wvht * 3.28084).toFixed(1)) : null,
        ts: `${month}/${day} ${hour}:${min}Z`
      };
    }
  } catch (buoyErr) {
    console.warn("[Server Buoy Fetch Skipped]: Falling back to client computations");
  }

  // ─── SECTION 2: DATABASE DATA EXTRACTION ──────────────────────────────
  try {
    // 1. Fetch latest raw entry from tactical briefs
    const briefUrl = `${supabaseUrl}/rest/v1/daily_briefs?select=*&order=forecast_date.desc&limit=1`;
    const briefResponse = await fetch(briefUrl, {
      headers: { "apikey": supabaseKey!, "Authorization": `Bearer ${supabaseKey}` }
    });
    const briefArray = briefResponse.ok ? await briefResponse.json() : [];
    const brief = briefArray[0] || null;

    // 2. Fetch latest entry from environmental satellite matrices
    const cacheUrl = `${supabaseUrl}/rest/v1/ocean_data_cache?select=*&order=updated_at.desc&limit=1`;
    const cacheResponse = await fetch(cacheUrl, {
      headers: { "apikey": supabaseKey!, "Authorization": `Bearer ${supabaseKey}` }
    });
    const cacheArray = cacheResponse.ok ? await cacheResponse.json() : [];
    const rawCache = cacheArray[0] || null;

    // Safe fallback mapping arrays
    const pLat = brief?.primary_lat || 37.55;
    const pLng = brief?.primary_lng || -74.35;
    const sLat = brief?.secondary_lat || 37.88;
    const sLng = brief?.secondary_lng || -74.12;
    
    const sstVal = brief?.live_sst_value || rawCache?.sst_data?.avgF || rawCache?.sst_data?.maxF || 71.0;
    const breakDelta = brief?.live_break_delta || 2.5;
    const targetDate = brief?.forecast_date || rawCache?.updated_at || new Date().toISOString().split("T")[0];

    const payload = {
      success: true,
      brief: brief,
      buoyFallback: liveBuoyData,
      meta: {
        live_sst_value: sstVal,
        live_break_delta: breakDelta,
        primary_lat: pLat,
        primary_lng: pLng,
        secondary_lat: sLat,
        secondary_lng: sLng,
        updated_at: targetDate
      },
      hotspots: [
        {
          id: "target-1",
          title: "Washington Canyon",
          lat: pLat,
          lng: pLng,
          liveSst: sstVal,
          liveBreak: breakDelta,
          liveConfidence: 92,
          isPrimaryAI: true
        },
        {
          id: "target-2",
          title: "Poorman's Canyon",
          lat: sLat,
          lng: sLng,
          liveSst: Math.max(60, sstVal - 1.2),
          liveBreak: 0.0,
          liveConfidence: 81,
          isSecondaryAI: true
        }
      ]
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(payload)
    };

  } catch (err: any) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
};
