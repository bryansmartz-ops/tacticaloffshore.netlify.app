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
  const x = url.searchParams.get("x") || "0";
  const y = url.searchParams.get("y") || "0";
  const z = url.searchParams.get("z") || "0";

  try {
    // 1. Gather environmental telemetry baseline from the raw data cache table rows
    const { data: rawCache, error: cacheError } = await supabase
      .from("ocean_data_cache")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cacheError) {
      console.error("[tile-proxy] Supabase read error inside proxy worker:", cacheError.message);
    }

    // 2. Safely capture the average temperature value out of your validated JSON schema block columns
    const activeSst = rawCache?.sst_data?.avgF || rawCache?.sst_data?.maxF || 71.0;
    
    // Set an explicit, safe thermal clipping range (14°F spectrum spread window)
    const minF = activeSst - 12.0; 
    const maxF = activeSst + 2.0;  

    const minC = ((minF - 32) * 5) / 9;
    const maxC = ((maxF - 32) * 5) / 9;

    const bbox = tileToBBox(parseInt(x), parseInt(y), parseInt(z));

    // 3. Build the official NOAA CoastWatch East Coast WMS direct data stream array request
    const noaaWmsUrl = new URL("https://coastwatch.noaa.gov/erddap/wms/noaacwVHNsstLines3Day/request");
    noaaWmsUrl.searchParams.set("service", "WMS");
    noaaWmsUrl.searchParams.set("version", "1.3.0");
    noaaWmsUrl.searchParams.set("request", "GetMap");
    
    // Crucial Update: Target the precise layer identification name for the 3-day high-resolution vector lines
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

    console.log(`[tile-proxy] Requesting tile ${z}/${x}/${y} from NOAA with dynamic range: ${minF.toFixed(1)}°F - ${maxF.toFixed(1)}°F`);

    const noaaResponse = await fetch(noaaWmsUrl.toString());
    
    if (!noaaResponse.ok) {
      console.error(`[tile-proxy] NOAA upstream server rejected request for tile ${z}/${x}/${y} with status: ${noaaResponse.status}`);
      throw new Error(`NOAA failure state: ${noaaResponse.status}`);
    }

    const imageBuffer = await noaaResponse.arrayBuffer();

    return new Response(imageBuffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=1800"
      }
    });

  } catch (err) {
    // If anything fails or crashes, flush the fallback transparent tile so the UI stays stable
    const transparentPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
    return new Response(transparentPng, { headers: { "Content-Type": "image/png" } });
  }
}
