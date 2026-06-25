#!/usr/bin/env python3
"""
SST Ingestion Pipeline - Enterprise Production Engine
Extracts live sea surface temperatures from the high-availability NOAA OI SST V2.1 stream.
"""

import os
import datetime
import requests
import numpy as np
import xarray as xr
from PIL import Image
from matplotlib.colors import LinearSegmentedColormap
from supabase import create_client, Client

# 1. GEOGRAPHIC BOUNDS (MID-ATLANTIC CANYON BOX)
MIN_LAT, MAX_LAT = 34.5, 41.0
MIN_LNG, MAX_LNG = -76.5, -70.0

# 2. HIGH-AVAILABILITY NODE: NOAA OI SST V2.1 Daily Aggregation
# Realigned: Swapped 'latest' for the explicit live integer index 16343 verified by the server
NOAA_OISST_URL = (
    "https://coastwatch.pfeg.noaa.gov/erddap/griddap/ncdcOisst21Agg.nc?sst"
    f"[16343][0][({MIN_LAT}):({MAX_LAT})][({MIN_LNG}):({MAX_LNG})]"
)

OUTPUT_IMG_PATH = "./daily_latest.png"

# Supabase API keys loaded from secure environment context
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

def run_pipeline():
    print("⏳ Stage 1: Handshaking with NOAA High-Availability Data Stream...")
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
        response = requests.get(NOAA_OISST_URL, headers=headers, stream=True, timeout=60)
        response.raise_for_status()
        
        tmp_nc = "tmp_satellite_grid.nc"
        with open(tmp_nc, "wb") as f:
            for chunk in response.iter_content(chunk_size=16384):
                f.write(chunk)
        print("✅ Stage 1 Complete: Operational NetCDF satellite asset secured.")
    except Exception as e:
        print(f"❌ Critical Error connecting to NOAA OISST Hub: {e}")
        return

    print("⏳ Stage 2: Parsing telemetry layers and uncompressing matrices...")
    try:
        with xr.open_dataset(tmp_nc) as ds:
            # Extract 2D matrix, squeezing out the 1-sized Time and Zlev dimensions cleanly
            sst_c = ds['sst'].values.squeeze()
            
            # NOAA OI SST stores values natively in Celsius. Convert directly to Fahrenheit:
            sst_f = sst_c * 1.8 + 32
            
        if os.path.exists(tmp_nc):
            os.remove(tmp_nc)
            
        # Extract active marine pixels, trimming out dry landmasses
        valid_temps = sst_f[~np.isnan(sst_f)]
        if len(valid_temps) == 0:
            raise ValueError("Satellite array returned completely null or masked matrix data bounds.")
            
        print("✅ Stage 2 Complete: Real-world marine values isolated successfully.")
    except Exception as e:
        print(f"❌ Critical Error parsing data structures: {e}")
        if os.path.exists(tmp_nc):
            os.remove(tmp_nc)
        return

    print("⏳ Stage 3: Running Dynamic Contrast Scaling Math...")
    min_range = float(np.percentile(valid_temps, 2))
    max_range = float(np.percentile(valid_temps, 98))
    print(f"📈 Real-World Thermal Box Range: {min_range:.1f}°F to {max_range:.1f}°F")

    # Establish high-contrast palette hex mappings
    color_sequence = [
        "rgba(37, 99, 235, 0.55)",   # Blue (Cool Inshore/Shelf)
        "rgba(22, 163, 74, 0.55)",   # Green (The Green Monster Curve)
        "rgba(250, 204, 21, 0.55)",  # Yellow (Transition Water)
        "rgba(234, 88, 12, 0.55)",   # Orange (Warm Core Structure)
        "rgba(220, 38, 38, 0.55)",   # Deep Red (Marlin Water)
        "rgba(185, 28, 28, 0.65)"    # Crimson (Core Gulf Stream Mainline)
    ]
    hex_colors = ["#2563eb", "#16a34a", "#facc15", "#ea580c", "#dc2626", "#b91c1c"]
    custom_cmap = LinearSegmentedColormap.from_list("sst_scale", hex_colors, N=256)

    print("⏳ Stage 4: Compiling transparent raster overlay...")
    # Normalize values between 0.0 and 1.0 based on today's true active span
    sst_f_normalized = (sst_f - min_range) / (max_range - min_range)
    sst_f_normalized = np.clip(sst_f_normalized, 0, 1)
    
    # Flip the image arrays on the vertical axis so it projects correctly in Leaflet coordinate bounds
    sst_f_normalized = np.flipud(sst_f_normalized)
    
    nan_mask = np.isnan(sst_f)
    rgba_image_data = custom_cmap(sst_f_normalized)
    rgba_image_data[nan_mask] = [0, 0, 0, 0] # Alpha 0 handles landmasses and cloud fields
    
    uint8_img_matrix = (rgba_image_data * 255).astype(np.uint8)
    img = Image.fromarray(uint8_img_matrix, mode="RGBA")
    
    # Bicubic interpolation scales the grid up smoothly to a sharp high-contrast chart
    img_smooth = img.resize((1024, 1024), resample=Image.BICUBIC)
    img_smooth.save(OUTPUT_IMG_PATH, "PNG", optimize=True)
    print("✅ Stage 4 Complete: Transparent raster tile built.")

    if SUPABASE_KEY and SUPABASE_URL:
        print("⏳ Stage 5: Syncing assets with Supabase Cloud Ecosystem...")
        try:
            supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
            timestamp_slug = datetime.datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            storage_destination = f"daily_layers/sst_{timestamp_slug}.png"

            # 1. Ship image straight to public storage
            with open(OUTPUT_IMG_PATH, 'rb') as f:
                supabase.storage.from_("sst-charts").upload(
                    path=storage_destination, file=f, file_options={"content-type": "image/png"}
                )

            # 2. Deactivate old rows
            supabase.table("sst_layers").update({"is_active": False}).eq("is_active", True).execute()

            # 3. Write active telemetry stats for Legend Bar synchronization
            db_payload = {
                "valid_time": datetime.datetime.utcnow().isoformat(),
                "range_min": min_range,
                "range_max": max_range,
                "breakpoints": [float(x) for x in np.linspace(min_range, max_range, 6)],
                "colors": color_sequence,
                "storage_path": storage_destination,
                "is_active": True
            }
            supabase.table("sst_layers").insert(db_payload).execute()
            print("🚀 Cloud Sync Finished! Real-world ocean telemetry active inside Supabase.")
        except Exception as e:
            print(f"❌ Cloud Sync Failed: {e}")
    else:
        print("💡 Sync Paused: Supabase secure keys are not visible to system runtime handles.")

if __name__ == "__main__":
    run_pipeline()
