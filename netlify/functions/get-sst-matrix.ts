// netlify/functions/get-sst-matrix.ts
// High-Speed Spatial Data Matrix Stream Function
// ─────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=300" // Cache locally for 5 minutes to save DB reads
};

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export const handler = async (event: any) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  try {
    // Pull the entire Mid-Atlantic active matrix in a single fast query
    const { data, error } = await supabase
      .from('sst_grid_cache')
      .select('lat, lng, sst_fahrenheit')
      .order('lat', { ascending: true });

    if (error) throw error;

    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, matrix: data })
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
};
