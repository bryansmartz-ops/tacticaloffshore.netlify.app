// scripts/update-sst-matrix.cjs
// Hardened NOAA Satellite Ingestion & Supabase Upsert Engine
// ─────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');
const ws = require('ws'); 

// 1. Initialize your rock-solid Supabase credentials
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Critical Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws }
});

// 2. DEFINE YOUR FISHING BOUNDARIES (The Mid-Atlantic Canyon Box)
const LAT_MIN = 36.5;
const LAT_MAX = 40.0;
const LNG_MIN = -75.0;
const LNG_MAX = -71.5;
const GRID_STEP = 0.05;

async function runIngestionPipeline() {
  console.log("🌊 Starting Tactical Offshore SST Ingestion Engine...");
  console.log(`📍 Target Sector Box: Lat [${LAT_MIN} to ${LAT_MAX}] | Lng [${LNG_MIN} to ${LNG_MAX}]`);

  try {
    // 3. TARGET THE NOAA SATELLITE ERDDAP SERVER
    // Using [last] instead of coordinate boundaries simplifies indexing on the NOAA side
    const noaaDatasetId = "jplMursst41mday"; 
    const noaaUrl = `https://coastwatch.pfeg.noaa.gov/erddap/griddap/${noaaDatasetId}.json?sst[last][(${LAT_MIN}):1:(${LAT_MAX})][(${LNG_MIN}):1:(${LNG_MAX})]`;

    console.log("📡 Connecting to NOAA CoastWatch servers...");
    console.log(`🔗 Request URL: ${noaaUrl}`);
    
    // Set a solid 45-second network timeout abort matrix to prevent raw script stalls
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    const response = await fetch(noaaUrl, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "application/json"
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`NOAA Server rejected network request with code: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data || !data.table || !data.table.rows) {
      throw new Error("Invalid or empty data payload format returned from NOAA.");
    }

    const rows = data.table.rows;
    console.log(`📦 Successfully downloaded ${rows.length} raw satellite telemetry data points from NOAA.`);

    const upsertPayload = [];
    const gridMap = new Map();

    // 4. PROCESS THE WATER TEMPERATURE FIELDS & NORMALIZATION MATRIX
    for (const row of rows) {
      const rawLat = parseFloat(row[1]);
      const rawLng = parseFloat(row[2]);
      const sstKelvin = parseFloat(row[3]);

      if (isNaN(sstKelvin) || sstKelvin === null) continue;

      // Convert Kelvin to Fahrenheit
      const sstFahrenheit = ((sstKelvin - 273.15) * 9) / 5 + 32;

      // Snap coordinates to uniform grid step cells
      const snapLat = Math.round(rawLat / GRID_STEP) * GRID_STEP;
      const snapLng = Math.round(rawLng / GRID_STEP) * GRID_STEP;
      const gridKey = `${snapLat.toFixed(4)},${snapLng.toFixed(4)}`;

      if (!gridMap.has(gridKey)) {
        gridMap.set(gridKey, { lat: snapLat, lng: snapLng, temps: [sstFahrenheit] });
      } else {
        gridMap.get(gridKey).temps.push(sstFahrenheit);
      }
    }

    // Compile into final normalized array payload strings
    for (const [key, cell] of gridMap.entries()) {
      const avgFahrenheit = cell.temps.reduce((a, b) => a + b, 0) / cell.temps.length;
      
      upsertPayload.push({
        lat: parseFloat(cell.lat.toFixed(4)),
        lng: parseFloat(cell.lng.toFixed(4)),
        sst_fahrenheit: parseFloat(avgFahrenheit.toFixed(2))
      });
    }

    console.log(`✨ Normalized raw telemetry data down into ${upsertPayload.length} uniform spatial grid cells.`);

    if (upsertPayload.length === 0) {
      console.log("⚠️ Warning: No valid temperature records remaining after normalization filter. Check sector cloud cover.");
      return;
    }

    // 5. BATCH UPSERT STRAIGHT INTO SUPABASE
    const batchSize = 1000;
    let recordsUpserted = 0;

    console.log("⚡ Syncing spatial data matrix arrays to Supabase cache tables...");

    for (let i = 0; i < upsertPayload.length; i += batchSize) {
      const currentBatch = upsertPayload.slice(i, i + batchSize);
      
      const { error } = await supabase
        .from('sst_grid_cache')
        .upsert(currentBatch, { onConflict: 'lat,lng' });

      if (error) {
        throw new Error(`Supabase Matrix Insertion Failure: ${error.message}`);
      }

      recordsUpserted += currentBatch.length;
      console.log(`   Processed [${recordsUpserted}/${upsertPayload.length}] cells...`);
    }

    console.log(`✅ Success! Database matrix is fully populated. ${recordsUpserted} canyon sector coordinates are live.`);

  } catch (error) {
    if (error.name === 'AbortError') {
      console.error("❌ Critical Pipeline Crash: Connection timed out after 45 seconds while waiting for NOAA data compile.");
    } else {
      console.error("❌ Critical Pipeline Crash:");
      console.error(error.message);
    }
    process.exit(1);
  }
}

runIngestionPipeline();
