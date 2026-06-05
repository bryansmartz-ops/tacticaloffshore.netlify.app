// netlify/functions/get-sst-tile.ts
// Hardened Fixed-Coordinate Binary PNG Oceanographic Tile Engine
// ─────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=3600"
};

function tileToLngLat(x: number, y: number, z: number) {
  const mapScale = Math.pow(2, z);
  const lng = (x / mapScale) * 360 - 180;
  const sinhVal = Math.sinh(Math.PI * (1 - (2 * y) / mapScale));
  const lat = (180 / Math.PI) * Math.atan(sinhVal);
  return { lat, lng };
}

// Transparent/tinted 1x1 pixel PNG buffers to completely bypass text/SVG rendering bugs
const PNG_RED    = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="; // Gulf Stream Core
const PNG_ORANGE = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DOfwP/AwADegH/7jBUpQAAAABJRU5ErkJggg=="; // Warm Blend
const PNG_YELLOW = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DA8B8ACmUBfvE6bY0AAAAASUVORK5CYII="; // Break Edge
const PNG_GREEN  = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DAwB8ACmUBfvE6bY0AAAAASUVORK5CYII="; // Transition Water
const PNG_BLUE   = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DA8A8ACmUBfvE6bY0AAAAASUVORK5CYII="; // Inside Basin
const PNG_CLEAR  = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="; // Clip Land

export const handler = async (event: any) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  const { x, y, z } = event.queryStringParameters || {};
  if (!x || !y || !z) return { statusCode: 400, headers: corsHeaders, body: "Missing parameters" };

  const tileX = parseInt(x);
  const tileY = parseInt(y);
  const tileZ = parseInt(z);

  try {
    const nw = tileToLngLat(tileX, tileY, tileZ);
    const se = tileToLngLat(tileX + 1, tileY + 1, tileZ);
    
    // Calculate raw center coordinates
    const rawLat = (nw.lat + se.lat) / 2;
    const rawLng = (nw.lng + se.lng) / 2;

    // ─── THE ANCHOR FIX ────────────────────────────────────────────────
    // Round coordinates to a fixed mathematical grid step (0.05 degrees ~= 3 NM).
    // This snaps the calculation to static coordinates on the earth, stopping layout drift when zooming.
    const gridResolution = 0.05;
    const centerLat = Math.round(rawLat / gridResolution) * gridResolution;
    const centerLng = Math.round(rawLng / gridResolution) * gridResolution;

    // ─── GEOGRAPHIC BOUNDARY CLIPPING MATRIX ───────────────────────────
    const IS_OFFSHORE_ZONE = (centerLat >= 36.5 && centerLat <= 40.0) && (centerLng >= -75.0 && centerLng <= -71.5);

    if (!IS_OFFSHORE_ZONE) {
      return {
        statusCode: 200,
        headers: { ...corsHeaders, "Content-Type": "image/png" },
        body: PNG_CLEAR,
        isBase64Encoded: true
      };
    }

    // ─── STABLE SIMULATED GRADIENT MATRIX ──────────────────────────────
    // Uses the fixed grid coordinates so boundaries do not warp on scale changes
    const shelfSlope = (centerLat - 38.3) * 15.0 + (centerLng + 74.2) * 12.0;
    const eddyWaves = Math.sin(centerLat * 45.0) * 1.5 + Math.cos(centerLng * 45.0) * 1.5;
    const combinedVector = shelfSlope + eddyWaves;

    let base64Png = PNG_BLUE;

    if (combinedVector < -1.5) {
      base64Png = PNG_RED;
    } else if (combinedVector < -0.3) {
      base64Png = PNG_ORANGE;
    } else if (combinedVector < 0.3) {
      base64Png = PNG_YELLOW;
    } else if (combinedVector < 1.5) {
      base64Png = PNG_GREEN;
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "image/png" },
      body: base64Png,
      isBase64Encoded: true
    };

  } catch (err: any) {
    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "image/png" },
      body: PNG_CLEAR,
      isBase64Encoded: true
    };
  }
};
