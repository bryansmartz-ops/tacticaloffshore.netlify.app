#!/usr/bin/env python3
"""
SST Ingestion Pipeline - Self-Discovering Enterprise Production Engine
Dynamically discovers the live active time array indices from NOAA metadata 
to prevent hardcoded connection breaks permanently.
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

# Metadata endpoint to read the current array limits dynamically
NOAA_INFO_URL = "https://coastwatch.pfeg.noaa.gov/erddap/griddap/ncdcOisst21Agg.json"
OUTPUT_IMG_PATH = "./daily_latest.png"

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

def get_latest_time_index():
    """Queries NOAA's structural metadata to find the exact active index limit."""
    print("⏳ Stage 0: Discovering live time array limits from NOAA metadata...")
    headers = {"User-Agent": "Mozilla/5.0"}
    response = requests.get(NOAA_INFO_URL, headers=headers, timeout=30)
    response.raise_for_status()
    data = response.json()
    
    # Parse ERDDAP JSON structural layout to find axis length
    for variable in data.get("table", {}).get("rows", []):
        if variable[0] == "Dimension" and variable[1] == "time":
            # The 'length' string attribute gives the total size of the axis
            axis_length = int(variable[4].split("=")[-1].strip())
            latest_index = axis_length - 1  # 0-indexed maximum bound
            print(f"🎯 Discovery Complete: Live server index identified as [{latest_index}]")
            return latest_index
    
    raise ValueError("Could not parse active time index parameters from NOAA metadata.")

def run_pipeline():
    try:
        # Dynamic Discovery Step
        latest_idx = get_latest_time_index()
    except Exception as e:
        print(f"❌ Critical Error during server auto-discovery: {e}")
        return

    # Construct the query URL dynamically using the fresh index
    noaa_download_url = (
        "https://coastwatch.pfeg.noaa.gov/erddap/griddap/ncdcOisst21Agg.nc?sst"
        f"[{latest_idx}][0][({MIN_LAT}):({MAX_LAT})][({MIN_LNG}):({MAX_LNG})]"
    )

    print("⏳ Stage 1: Handshaking with verified NOAA data target...")
    try:
        headers = {"User-Agent": "Mozilla/5.0"}
        response = requests.get(noaa_download_url, headers=headers, stream=True, timeout=60)
        response.raise_for_status()
        
        tmp_nc = "tmp_satellite_grid.nc"
        with open(tmp_nc, "wb") as f:
            for chunk in response.iter_content(chunk_size=16384):
                f.write(chunk)
        print("✅ Stage 1 Complete: Operational NetCDF asset downloaded.")
    except Exception as e:
        print(f"❌ Critical Error connecting to NOAA OISST Hub: {e}")
        return

    print("⏳ Stage 2: Parsing telemetry layers and uncompressing matrices...")
    try:
        with xr.open_dataset(tmp_nc) as ds:
            sst_c = ds['sst'].values.squeeze()
            sst_f = sst_c * 1.8 + 32
            
        if os.path.exists(tmp_nc):
            os.remove(tmp_nc)
            
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

    color_sequence = [
        "rgba(37, 99, 235, 0.55)", "rgba(22, 163, 74, 0.55)", "rgba(250, 204, 21, 0.55)",
        "rgba(234, 88, 12, 0.55)", "rgba(220, 38, 38, 0.55)", "rgba(185, 28, 28, 0.65)"
    ]
    hex_colors = ["#2563eb", "#16a34a", "#facc15", "#ea580c", "#dc2626", "#b91c1c"]
    custom_cmap = LinearSegmentedColormap.from_list("sst_scale", hex_colors, N=256)

    print("⏳ Stage 4: Compiling transparent raster overlay...")
    sst_f_normalized = (sst_f - min_range) / (max_range - min_range)
    sst_f_normalized = np.clip(sst_f_normalized, 0, 1)
    sst_f_normalized = np.flipud(sst_f_normalized)
    
    nan_mask = np.isnan(sst_f)
    rgba_image_data = custom_cmap(sst_f_normalized)
    rgba_image_data[nan_mask] = [0, 0, 0, 0]
    
    uint8_img_matrix = (rgba_image_data * 255).astype(np.uint8)
    img = Image.fromarray(uint8_img_matrix, mode="RGBA")
    
    img_smooth = img.resize((1024, 1024), resample=Image.BICUBIC)
    img_smooth.save(OUTPUT_IMG_PATH, "PNG", optimize=True)
    print("✅ Stage 4 Complete: Transparent raster tile built.")

    if SUPABASE_KEY and SUPABASE_URL:
        print("⏳ Stage 5: Syncing assets with Supabase Cloud Ecosystem...")
        try:
            supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
            timestamp_slug = datetime.datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            storage_destination = f"daily_layers/sst_{timestamp_slug}.png"

            with open(OUTPUT_IMG_PATH, 'rb') as f:
                supabase.storage.from_("sst-charts").upload(
                    path=storage_destination, file=f, file_options={"content-type": "image/png"}
                )

            supabase.table("sst_layers").update({"is_active": False}).eq("is_active", True).execute()

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
        print("💡 Sync Paused: Supabase secure keys are not visible.")

if __name__ == "__main__":
    run_pipeline()
