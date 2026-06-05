// netlify/functions/get-sst-matrix.ts
// High-Speed Spatial Data Matrix Stream Function
// ─────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';
import type { Config } from "@netlify/functions";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=300" // Cache locally for 5 minutes to protect DB limits
};

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Modern Netlify serverless handler export pattern
export default async (request: Request) => {
  // Handle standard browser preflight safety checks
  if (request.method === "OPTIONS") {
    return new Response("", { status: 204, headers: corsHeaders });
  }

  console.log("📡 get-sst-matrix function invoked. Requesting Supabase rows...");

  try {
    // Fetch the loaded Mid-Atlantic active fishing matrix coordinates
    const { data, error } = await supabase
      .from('sst_grid_cache')
      .select('lat, lng, sst_fahrenheit')
      .order('lat', { ascending: true });

    if (error) {
      console.error("❌ Supabase fetch operation failed:", error.message);
      throw error;
    }

    console.log(`📦 Successfully pulled ${data?.length || 0} grid rows from the database cache table.`);

    return new Response(
      JSON.stringify({ success: true, matrix: data }),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );

  } catch (err: any) {
    console.error("❌ System-level function crash:", err.message);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { 
        status: 500, 
        headers: corsHeaders 
      }
    );
  }
};
