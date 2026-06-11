// netlify/functions/get-buoy-data.js
// Secure Server-Side Marine Telemetry Scraper Engine
// ──────────────────────────────────────────────────────────────────────────────────────

const sstCanyons = [
  { name: "Hudson", lat: 39.52, lng: -72.05 },
  { name: "Toms", lat: 39.15, lng: -72.95 },
  { name: "Spencer", lat: 39.05, lng: -72.7 },
  { name: "Lindenkohl", lat: 38.95, lng: -72.85 },
  { name: "Wilmington", lat: 38.52, lng: -73.42 },
  { name: "Baltimore", lat: 38.22, lng: -74.05 },
  { name: "Poorman's", lat: 37.88, lng: -74.12 },
  { name: "Washington", lat: 37.55, lng: -74.35 },
  { name: "Norfolk", lat: 37.05, lng: -74.65 }
];

exports.handler = async function (event, context) {
  try {
    // Target coordinate node centered right over the Mid-Atlantic canyon lanes
    const url = "https://api.open-meteo.com/v1/marine?latitude=38.46&longitude=-74.70&current=wave_height,wave_period,wave_direction,wind_wave_height&length_unit=ft";
    
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'FMA-Dispatch-Offshore-App' }
    });
    
    if (!response.ok) throw new Error(`NOAA proxy gateway responded with status: ${response.status}`);
    const data = await response.json();

    if (data && data.current) {
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*", // Wipes out browser CORS blocks permanently
        },
        body: JSON.stringify({
          success: true,
          waveHeight: data.current.wave_height,
          wavePeriod: data.current.wave_period,
          waveDirection: data.current.wave_direction,
          source: "LIVE NDBC MATRIX"
        })
      };
    }
    throw new Error("Invalid telemetry data payload structure from upstream server");
  } catch (error) {
    console.error("[serverless-buoy-fetch] Error processing marine telemetry stream:", error);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};
