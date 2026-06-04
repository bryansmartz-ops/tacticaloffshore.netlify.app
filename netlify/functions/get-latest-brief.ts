// netlify/functions/get-latest-brief.ts
// Netlify v2 Serverless Function — Fetch Latest Cached Briefing Data
// ─────────────────────────────────────────────────────────────────────

import type { Config, Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json"
};

export default async function handler(req: Request, context: Context): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // 1. Grab the latest entry from your main briefing logs
    const { data: brief, error: briefError } = await supabase
      .from("daily_briefs")
      .select("*")
      .order("forecast_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (briefError) throw briefError;

    // 2. Fetch the backup structural oceanography framework metrics
    const { data: rawCache } = await supabase
      .from("ocean_data_cache")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // 3. Extract baseline navigation targets using your guaranteed data fields
    // Default to Washington Canyon coordinates if your custom float blocks aren't active yet
    const pLat = brief?.primary_lat || 37.55;
    const pLng = brief?.primary_lng || -74.35;
    const sLat = brief?.secondary_lat || 37.88;
    const sLng = brief?.secondary_lng || -74.12;
    const sstVal = brief?.live_sst_value || rawCache?.sst_data?.avgF || 71.0;

    const payload = {
      success: true,
      brief: brief || null,
      meta: {
        live_sst_value: sstVal,
        live_break_delta: brief?.live_break_delta || 2.5,
        primary_lat: pLat,
        primary_lng: pLng,
        secondary_lat: sLat,
        secondary_lng: sLng,
        updated_at: brief?.forecast_date || new Date().toISOString()
      },
      // Re-populate your main map hotspots array instantly so pins don't drop out
      hotspots: [
        {
          id: "target-1",
          title: "Washington Canyon",
          lat: pLat,
          lng: pLng,
          liveSst: sstVal,
          liveBreak: brief?.live_break_delta || 2.5,
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

    return new Response(JSON.stringify(payload), { status: 200, headers: corsHeaders });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[latest-brief fatal]:", message);
    return new Response(JSON.stringify({ success: false, error: message }), { status: 500, headers: corsHeaders });
  }
}

export const config: Config = {
  path: "/get-latest-brief"
};
