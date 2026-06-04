// netlify/functions/get-sst-tile.ts
// Serverless Map Tile Proxy & Local Palette Stretch Engine
// ─────────────────────────────────────────────────────────────────────

import type { Config, Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Convert Leaflet Mercator tile coordinates to raw EPSG:3857 Bounding Boxes
function tileToBBox(x: number, y: number, z: number) {
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
    // 1. Fetch our active morning thermal metrics from the database cache
    const { data: brief } = await supabase
      .from("environmental_cache")
      .select("live_sst_value")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Establish tournament-grade local stretch bounds (e.g., 58°F shelf water up to Gulf Stream core)
    const activeSst = brief?.live_sst_value || 72.0;
    const minF = activeSst - 12.0; 
    const maxF = activeSst + 2.0;  

    // Convert Fahrenheit thresholds to Celsius strings for NOAA's ERDDAP layout
    const minC = ((minF - 32) * 5) / 9;
    const maxC = ((maxF - 32) * 5) / 9;

    // 2. Compute the exact coordinate bounding boundary box for this specific map tile
    const bbox = tileToBBox(x, y, z);

    // 3. Construct the official, authenticated NOAA CoastWatch WMS request URL
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
    noaaWmsUrl.searchParams.set("palette", "Jet"); // High-fidelity blue-to-red tournament palette

    // 4. Stream the tile data securely back to the frontend map layer
    const noaaResponse = await fetch(noaaWmsUrl.toString());
    
    if (!noaaResponse.ok) {
      throw new Error(`NOAA upstream rejection state: ${noaaResponse.status}`);
    }

    const imageBuffer = await noaaResponse.arrayBuffer();

    return new Response(imageBuffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=1800" // Cache tiles for 30 minutes to stay blazing fast
      }
    });

  } catch (err) {
    console.error(`[tile-proxy error mapping tile ${z}/${x}/${y}]:`, err);
    // Return a transparent 1x1 placeholder png if a tile fails or hits cloud coverage
    const transparentPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
    return new Response(transparentPng, { headers: { "Content-Type": "image/png" } });
  }
}
