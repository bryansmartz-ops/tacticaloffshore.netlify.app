// netlify/functions/get-sst-tile.ts
// High-Fidelity Server-Side Map Tile Proxy & Local Palette Stretch
// ─────────────────────────────────────────────────────────────────────

import type { Config, Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function tileToBBox(x: number, y: number, z: number): string {
  const worldSize = 20037508.342789244;
  const initialResolution = (worldSize * 2) / 256;
  const resolution = initialResolution / Math.pow(2, z);

  const minx = x * 256 * resolution - worldSize;
  const miny = worldSize - (y + 1) * 256 * resolution;
  const maxx = (x + 1) * 256 * resolution - worldSize;
  const maxy = worldSize - y * 256 * resolution;

  return `${minx},${miny},${maxx},${maxy}`;
}

export default async function handler(req: Request, context: Context): Promise<Response> {
  const url = new URL(req.url);
  const x = parseInt(url.searchParams.get("x") || "0");
  const y = parseInt(url.searchParams.get("y") || "0");
  const z = parseInt(url.searchParams.get("z") || "0");
  
  try {
    // 1. Grab latest briefing logs safely
    let { data: brief } = await supabase
      .from("daily_briefs")
      .select("*")
      .order("forecast_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!brief) {
      const { data: altBrief } = await supabase
        .from("daily_briefs")
        .select("*")
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (altBrief) brief = altBrief;
    }

    // 2. Grab raw cache with safe column fallback checks
    let rawCache = null;
    const { data: cacheTry1 } = await supabase
      .from("ocean_data_cache")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    rawCache = cacheTry1;

    if (!rawCache) {
      const { data: cacheTry2 } = await supabase
        .from("ocean_data_cache")
        .select("*")
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      rawCache = cacheTry2;
    }

    // 3. Normalize water temperature calculations
    const activeSst = brief?.live_sst_value || rawCache?.sst_data?.avgF || 71.0;
    const minF = activeSst - 13.0; 
    const maxF = activeSst + 2.0;  

    const minC = ((minF - 32) * 5) / 9;
    const maxC = ((maxF - 32) * 5) / 9;

    const bbox = tileToBBox(x, y, z);

    // 4. Query NOAA CoastWatch WMS
    const noaaWmsUrl = new URL("https://coastwatch.noaa.gov/erddap/wms/noaacwVHNsstLines3Day/request");
    noaaWmsUrl.searchParams.set("service", "WMS");
    noaaWmsUrl.searchParams.set("version", "1.3.0");
    noaaWmsUrl.searchParams.set("request", "GetMap");
    noaaWmsUrl.searchParams.set("layers", "noaacwVHNsstLines3Day:sst");
    noaaWmsUrl.searchParams.set("styles", "raster");
    noaaWmsUrl.searchParams.set("format", "image/png");
    noaaWmsUrl.searchParams.set("transparent", "true");
    noaaWmsUrl.searchParams.set("crs", "EPSG:3857");
    noaaWmsUrl.searchParams.set("width", "256");
    noaaWmsUrl.searchParams.set("height", "256");
    noaaWmsUrl.searchParams.set("bbox", bbox);
    noaaWmsUrl.searchParams.set("colorscalerange", `${minC.toFixed(1)},${maxC.toFixed(1)}`);
    noaaWmsUrl.searchParams.set("palette", "Jet");

    const noaaResponse = await fetch(noaaWmsUrl.toString());
    
    if (!noaaResponse.ok) {
      throw new Error(`NOAA upstream rejection state: ${noaaResponse.status}`);
    }

    const imageBuffer = await noaaResponse.arrayBuffer();

    return new Response(imageBuffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=1800"
      }
    });

  } catch (err) {
    console.error(`[tile-proxy failure] Returning placeholder for tile ${z}/${x}/${y}:`, err);
    const transparentPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
    return new Response(transparentPng, { headers: { "Content-Type": "image/png" } });
  }
}
