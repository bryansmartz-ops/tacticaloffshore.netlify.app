#!/usr/bin/env python3
"""
SST Ingestion Pipeline - Production OpenDAP Engine
Extracts live sea surface temperatures from the high-availability NOAA OI SST V2.1 stream,
natively handles 360-degree coordinate conversion, and syncs assets directly to Supabase.
"""

import os
import datetime
import numpy as np
import xarray as xr
from PIL import Image
from matplotlib.colors import LinearSegmentedColormap
from supabase import create_client, Client

# 1. GEOGRAPHIC BOUNDS (MID-ATLANTIC CANYON BOX)
MIN_LAT, MAX_LAT = 34.5, 41.0
MIN_LNG, MAX_LNG = -76.5, -70.0

# 2. MASTER OPENDAP SECURE NETWORKING STREAM
# Opening the master stream pointer allows xarray to query indexes natively at the data layer
NOAA_OPENDAP_STREAM = "https://coastwatch.pfeg.noaa.gov/erddap/griddap/ncdcOisst21Agg"
OUTPUT_IMG_PATH = "./daily_latest.png"

# Supabase credentials loaded securely from system environment variables
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

def run_pipeline():
    print("⏳ Stage 1: Opening remote secure OpenDAP stream with NOAA Clusters...")
    try:
        # Open the entire dataset as a virtual lazy-loaded array pointer.
        # This uses 0MB of local memory and completely bypasses frontend HTTP web firewalls.
        ds = xr.open_dataset(NOAA_OPENDAP_STREAM)
        print("✅ Stage 1 Complete: Live data stream connection established.")
    except Exception as e:
        print(f"❌ Critical Error connecting to NOAA OpenDAP Stream: {e}")
        return

    print("⏳ Stage 2: Slicing temporal and spatial dimensions natively in memory...")
    try:
        # DATA ALIGNMENT TRANSLATION:
        # 1. Convert standard West longitude (-76.5) to NOAA's native 0-360 East longitude scale (283.5)
        noaa_min_lng = 360 + MIN_LNG if MIN_LNG < 0 else MIN_LNG
        noaa_max_lng = 360 + MAX_LNG if MAX_LNG < 0 else MAX_LNG

        # 2. Automatically detect if the dataset coordinates are sorted ascending or descending,
        # ensuring xarray doesn't drop an empty slice due to sorting order mismatches.
        lat_slice = slice(MIN_LAT, MAX_LAT) if ds.latitude[0] < ds.latitude[-1] else slice(MAX_LAT, MIN_LAT)
        lng_slice = slice(noaa_min_lng, noaa_max_lng) if ds.longitude[0] < ds.longitude[-1] else slice(noaa_max_lng, noaa_min_lng)

        # 3. Pull the absolute latest time frame index (-1) and surface skin layer (zlev=0)
        sliced_ds = ds.sel(
            time=ds.time[-1],
            zlev=0,
            latitude=lat_slice,
            longitude=lng_slice
        )
        
        # Load the isolated spatial temperature slice down to memory
        sst_c = sliced_ds['sst'].values.squeeze()
        
        # Close the remote network stream handle cleanly
        ds.close()
        
        # Native Conversion Math: Convert Celsius matrix values directly to Fahrenheit
        sst_f = sst_c * 1.8 + 32
        
        # Isolate true marine pixels, stripping out dry landmasses or invalid grid blocks
        valid_temps = sst_f[~np.isnan(sst_f)]
        if len(valid_temps) == 0:
            raise ValueError("Satellite stream returned an entirely null matrix for these coordinate limits.")
            
        print("✅ Stage 2 Complete: Real-world marine values isolated successfully.")
    except Exception as e:
        print(f"❌ Critical Error parsing data structures: {e}")
        return

    print("⏳ Stage 3: Running Dynamic Contrast Scaling Math...")
    # Clean up signal noise by trimming out the extreme top and bottom 2% of anomalous values
    min_range = float(np.percentile(valid_temps, 2))
    max_range = float(np.percentile(valid_temps, 98))
    print(f"📈 Real-World Thermal Box Range: {min_range:.1f}°F to {max_range:.1f}°F")

    # Establish tournament-grade high-contrast palette mappings for the Leaflet front-end
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
    # Normalize data between 0.0 and 1.0 based strictly on today's active thermal span
    sst_f_normalized = (sst_f - min_range) / (max_range - min_range)
    sst_f_normalized = np.clip(sst_f_normalized, 0, 1)
    
    # Flip the image arrays on the vertical axis so it projects correctly in Leaflet coordinate bounds
    sst_f_normalized = np.flipud(sst_f_normalized)
    
    nan_mask = np.isnan(sst_f)
    rgba_image_data = custom_cmap(sst_f_normalized)
    rgba_image_data[nan_mask] = [0, 0, 0, 0] # Alpha 0 handles landmasses and cloud fields natively
    
    uint8_img_matrix = (rgba_image_data * 255).astype(np.uint8)
    img = Image.fromarray(uint8_img_matrix, mode="RGBA")
    
    # Scale up the raw data grid using high-fidelity bicubic interpolation for ultra-smooth rendering
    img_smooth = img.resize((1024, 1024), resample=Image.BICUBIC)
    img_smooth.save(OUTPUT_IMG_PATH, "PNG", optimize=True)
    print("✅ Stage 4 Complete: Transparent raster tile built.")

    if SUPABASE_KEY and SUPABASE_URL:
        print("⏳ Stage 5: Syncing assets with Supabase Cloud Ecosystem...")
        try:
            supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
            timestamp_slug = datetime.datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            storage_destination = f"daily_layers/sst_{timestamp_slug}.png"

            # 1. Stream the completed PNG directly into secure public storage bucket
            with open(OUTPUT_IMG_PATH, 'rb') as f:
                supabase.storage.from_("sst-charts").upload(
                    path=storage_destination, file=f, file_options={"content-type": "image/png"}
                )

            # 2. Deactivate previous operational records to keep layer states current
            supabase.table("sst_layers").update({"is_active": False}).eq("is_active", True).execute()

            # 3. Write active telemetry bounds into the database table for frontend legend synchronization
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
