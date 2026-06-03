// netlify/functions/get-latest-brief.ts
// Secure API Endpoint to feed your Anima Visual PWA
// ─────────────────────────────────────────────────────────────────────

import type { Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: Request, context: Context) {
  // Setup standard cross-origin headers so your PWA can securely pull the data
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json"
  };

  // Handle browser pre-flight checks smoothly
  if (req.method === "OPTIONS") {
    return new Response(null, { headers, status: 204 });
  }

  try {
    // Connect using your existing environment variables
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY! // Using service role to ensure clean read access
    );

    // Grab the absolute newest compiled brief row from the table
    const { data, error } = await supabase
      .from("daily_briefs")
      .select("*")
      .order("forecast_date", { ascending: false })
      .limit(1);

    if (error) {
      console.error("[api] Supabase read failure:", error.message);
      return Response.json({ error: error.message }, { headers, status: 500 });
    }

    if (!data || data.length === 0) {
      return Response.json({ error: "No tactical briefs compiled yet." }, { headers, status: 404 });
    }

    // Return the clean JSON packet straight to your PWA dashboard layout
    return Response.json(data[0], { headers, status: 200 });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[api] Fatal endpoint crash:", msg);
    return Response.json({ error: msg }, { headers, status: 500 });
  }
}
