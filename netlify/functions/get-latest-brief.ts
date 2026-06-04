// netlify/functions/get-latest-brief.ts
// Netlify v2 Serverless Function — Fetch Latest Cached Briefing Data
// ─────────────────────────────────────────────────────────────────────

import type { Config, Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Standard security headers to allow your frontend app to query the backend securely
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json"
};

export default async function handler(req: Request, context: Context): Promise<Response> {
  // Handle standard browser pre-flight safety checks cleanly
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // 1. Query the single most recent row from your core daily briefs archive
    const { data: brief, error: briefError } = await supabase
      .from("daily_briefs")
      .select("*")
      .order("forecast_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (briefError) {
      throw new Error(`Database read error: ${briefError.message}`);
    }

    // 2. Fetch the fallback ambient tracking variables from the raw scraper cache if table row is thin
    const { data: rawCache } = await supabase
      .from("ocean_data_cache")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // 3. Assemble a unified, safe structural response payload for the map page
    const payload = {
      success: true,
      brief: brief || null,
      meta: {
        live_sst_value: brief?.live_sst_value || rawCache?.sst_data?.avgF || 72.0,
        live_break_delta: brief?.live_break_delta || 0.0,
        primary_lat: brief?.primary_lat || 37.55,
        primary_lng: brief?.primary_lng || -74.35,
        secondary_lat: brief?.secondary_lat || 37.88,
        secondary_lng: brief?.secondary_lng || -74.12,
        updated_at: rawCache?.created_at || new Date().toISOString()
      }
    };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: corsHeaders
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[latest-brief failure]:", message);

    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: corsHeaders }
    );
  }
}

export const config: Config = {
  path: "/get-latest-brief"
};
