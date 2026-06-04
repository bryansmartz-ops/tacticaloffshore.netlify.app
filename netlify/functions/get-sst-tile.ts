// netlify/functions/get-sst-tile.ts
// Hardened Node.js Map Tile Proxy & Local Palette Stretch Engine
// ─────────────────────────────────────────────────────────────────────

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

export const handler = async (event: any) => {
  const params = event.queryStringParameters || {};
  const x = parseInt(params.x || "0");
  const y = parseInt(params.y || "0");
  const z = parseInt(params.z || "0");

  try {
    // 1. Fetch baseline telemetry metrics from your raw cache data
    const { data: rawCache } = await supabase
      .from("ocean_data_cache")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // 2. Parse temperatures safely out of your verified JSON schema properties
    const activeSst = rawCache?.sst_data?.avgF || rawCache?.sst_data?.maxF || 71.0;
    const minF = activeSst - 12.0; 
    const maxF = activeSst + 2.0;  

    const minC = ((minF - 32) * 5) / 9;
    const maxC = ((maxF - 32) * 5) / 9;

    const bbox = tileToBBox(x, y, z);

    // 3. Assemble the official NOAA CoastWatch East Coast array request
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
      throw new Error(`NOAA proxy tracking rejection status: ${noaaResponse.status}`);
    }

    const imageBuffer = await noaaResponse.arrayBuffer();

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=1800"
      },
      body: Buffer.from(imageBuffer).toString("base64"),
      isBase64Encoded: true
    };

  } catch (err: any) {
    console.error(`[tile proxy failure on tile ${z}/${x}/${y}]:`, err.message);
    const transparentPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    return {
      statusCode: 200,
      headers: { "Content-Type": "image/png" },
      body: transparentPng,
      isBase64Encoded: true
    };
  }
};
