// scripts/update-sst-matrix.js
// Automated NOAA Satellite Matrix Ingestion & Supabase Upsert Engine
// ─────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');

// 1. Initialize your rock-solid Supabase credentials
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Critical Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// 2. DEFINE YOUR FISHING BOUNDARIES (The Mid-Atlantic Canyon Box)
// Lat 36.5 (NC/VA Line) to 40.0 (NY Bight)
// Lng -75.0 (The Beach) to -71.5 (Way past the 1000-fathom curves)
const LAT_MIN = 36.5;
const LAT_MAX = 40.0;
const LNG_MIN = -75.0;
const LNG_MAX = -71.5;

// Resolution step size matching our database grid (0.05 degrees ~= 3 NM blocks)
const GRID_STEP = 0.05;

async function runIngestionPipeline() {
  console.log("🌊 Starting Tactical Offshore SST Ingestion Engine...");
  console.log(`📍 Target Sector Box: Lat [${LAT_MIN} to ${LAT_MAX}] | Lng [${LNG_MIN} to ${LNG_MAX}]`);

  try {
    // 3. TARGET THE NOAA SATELLITE ERDDAP SERVER
    // We request the latest high-accuracy 1-day blended multi-satellite SST compilation dataset.
    // Instead of heavy image binaries, we request a clean, text-based JSON array of coordinate values.
    const noaaDatasetId = "jplMursst41mday"; // Jet Propulsion Laboratory Multi-Scale Ultra-High Res SST dataset ID
    const noaaUrl = `https://coastwatch.pfeg.noaa.gov/erddap/griddap/${noaaDatasetId}.json?sst[(-0.0):1:(latest)][(${LAT_MIN}):1:(${LAT_MAX})][(${LNG_MIN}):1:(${LNG_MAX})]`;

    console.log("📡 Connecting to NOAA CoastWatch servers...");
    const response = await fetch(noaaUrl);
    
    if (!response.ok) {
      throw new Error(`NOAA Server rejected network request with code: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // Parse NOAA's standardized ERDDAP multi-dimensional layout headers
    // Columns typically map out to: [time, latitude, longitude, sst_in_kelvin]
    const rows = data.table.rows;
    console.log(`📦 Successfully downloaded ${rows.length} raw satellite telemetry data points from NOAA.`);

    const upsertPayload = [];
    const gridMap = new Map();

    // 4. PROCESS THE WATER TEMPERATURE FIELDS & NORMALIZATION MATRIX
    for (const row of rows) {
      const rawLat = parseFloat(row[1]);
      const rawLng = parseFloat(row[2]);
      const sstKelvin = parseFloat(row[3]);

      // Skip missing pixels caused by cloud cover interference over the ocean
      if (isNaN(sstKelvin) || sstKelvin === null) continue;

      // Convert scientific Kelvin readings to commercial American Fahrenheit decimals
      const sstFahrenheit = ((sstKelvin - 273.15) * 9) / 5 + 32;

      // SNAP TO FIXED SPATIAL GRID LOOKUPS
      // This groups tracking points into uniform cells so they align exactly with your map display layout
      const snapLat = Math.round(rawLat / GRID_STEP) * GRID_STEP;
      const snapLng = Math.round(rawLng / GRID_STEP) * GRID_STEP;
      const gridKey = `${snapLat.toFixed(4)},${snapLng.toFixed(4)}`;

      // Average the temperature readings if multiple satellite pixels hit the same 3-mile block cell
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

    // 5. BATCH UPSERT STRIGHT INTO SUPABASE
    // Splitting data chunks into 1,000-row batch runs guarantees rapid execution without bursting memory thresholds
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
    console.error("❌ Critical Pipeline Crash:");
    console.error(error.message);
    process.exit(1);
  }
}

runIngestionPipeline();
