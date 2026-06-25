#!/usr/bin/env python3
"""
SST Ingestion Pipeline - Bulletproof Fail-Safe Regional Grid Matrix Engine
Downloads a fixed regional satellite block and slices coordinates locally.
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
MATRIX_RES = 32

# Master Data Link - Targets a fully realized spatial projection block over the Mid-Atlantic
NOAA_BULLETPROOF_URL = "https://coastwatch.pfeg.noaa.gov/erddap/griddap/noaacwBLENDEDsstDaily.nc?sst[latest][][][]"

OUTPUT_IMG_PATH = "./daily_latest.png"

# Supabase cloud credentials pulled securely from environment settings
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

def run_pipeline():
    print("⏳ Stage 1: Downloading master North Atlantic data block from NOAA...")
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        # Passing empty dimension brackets [] [] [] instructs ERDDAP to return the full unconstrained structural layer
        response = requests.get(NOAA_BULLETPROOF_URL, headers=headers, stream=True, timeout=90)
        response.raise_for_status()
        
        tmp_nc = "tmp_satellite_grid.nc"
        with open(tmp_nc, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        print("✅ Stage 1 Complete: Master regional satellite block secured.")
    except Exception as e:
        print(f"❌ Failure downloading NOAA grid: {e}")
        return

    print("⏳ Stage 2: Slicing Mid-Atlantic coordinate window locally...")
    try:
        with xr.open_dataset(tmp_nc) as ds:
            # Dynamically identify correct coordinate axis dimensions inside the NetCDF payload
            lat_key = 'latitude' if 'latitude' in ds.coords else 'lat'
            lng_key = 'longitude' if 'longitude' in ds.coords else 'lon'
            
            # Extract and perform high-precision local matrix slicing within Python's runtime memory
            # Handles both North-South and South-North array sorting profiles automatically
            if ds[lat_key].values[0] > ds[lat_key].values[-1]:
                sliced_ds = ds.sel({lat_key: slice(MAX_LAT, MIN_LAT), lng_key: slice(MIN_LNG, MAX_LNG)})
            else:
                sliced_ds = ds.sel({lat_key: slice(MIN_LAT, MAX_LAT), lng_key: slice(MIN_LNG, MAX_LNG)})
                
            sst_k = sliced_ds['sst'].values.squeeze()
            # Convert Kelvin to Fahrenheit natively: (K - 273.15) * 9/5 + 32
            sst_f = (sst_k - 273.15) * 1.8 + 32
            
        if os.path.exists(tmp_nc):
            os.remove(tmp_nc)
            
        # Isolate real marine temperatures by skipping over missing/cloud-masked values
        valid_temps = sst_f[~np.isnan(sst_f)]
        if len(valid_temps) == 0:
            print("⚠️ Warning: Heavy cloud cover detected. Triggering static matrix boundaries.")
            valid_temps = np.array([65.0, 78.0])
            
        print("✅ Stage 2 Complete: Mid-Atlantic coordinate window sliced safely.")
    except Exception as e:
        print(f"❌ Failure parsing and slicing data matrices: {e}")
        if os.path.exists(tmp_nc):
            os.remove(tmp_nc)
        return

    print("⏳ Stage 3: Computing dynamic palette scaling boundaries...")
    min_range = float(np.percentile(valid_temps, 2))
    max_range = float(np.percentile(valid_temps, 98))
    print(f"📈 Observed Matrix Boundaries: {min_range:.1f}°F to {max_range:.1f}°F")

    color_sequence = [
        "rgba(37, 99, 235, 0.55)", "rgba(22, 163, 74, 0.55)", "rgba(250, 204, 21, 0.55)",
        "rgba(234, 88, 12, 0.55)", "rgba(220, 38, 38, 0.55)", "rgba(185, 28, 28, 0.65)"
    ]
    
    hex_colors = ["#2563eb", "#16a34a", "#facc15", "#ea580c", "#dc2626", "#b91c1c"]
    custom_cmap = LinearSegmentedColormap.from_list("sst_scale", hex_colors, N=256)
    print("✅ Stage 3 Complete: Dynamic color keys locked.")

    print("⏳ Stage 4: Rasterizing high-fidelity transparent map overlay...")
    sst_f_normalized = (sst_f - min_range) / (max_range - min_range)
    sst_f_normalized = np.clip(sst_f_normalized, 0, 1)
    
    nan_mask = np.isnan(sst_f)
    rgba_image_data = custom_cmap(sst_f_normalized)
    rgba_image_data[nan_mask] = [0, 0, 0, 0]
    
    uint8_img_matrix = (rgba_image_data * 255).astype(np.uint8)
    img = Image.fromarray(uint8_img_matrix, mode="RGBA")
    
    img_smooth = img.resize((512, 512), resample=Image.Resample.BICUBIC)
    img_smooth.save(OUTPUT_IMG_PATH, "PNG", optimize=True)
    print("✅ Stage 4 Complete: High-contrast raster file built locally.")

    # Execute automated Supabase storage and data synchronization loops
    if SUPABASE_KEY and SUPABASE_URL:
        print("⏳ Stage 5: Uploading assets directly to Supabase Cloud...")
        try:
            supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
            timestamp_slug = datetime.datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            storage_destination = f"daily_layers/sst_{timestamp_slug}.png"

            # 1. Ship physical transparent image file overlay to Storage Bucket
            with open(OUTPUT_IMG_PATH, 'rb') as f:
                supabase.storage.from_("sst-charts").upload(
                    path=storage_destination, file=f, file_options={"content-type": "image/png"}
                )

            # 2. Deactivate any previous records so clients only parse the fresh layer
            supabase.table("sst_layers").update({"is_active": False}).eq("is_active", True).execute()

            # 3. Insert complete data row to coordinate frontend dynamic scales
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
            print("🚀 Cloud Sync Finished! Map layers updated automatically.")
        except Exception as e:
            print(f"❌ Cloud Sync Failed: {e}")
    else:
        print("💡 Pipeline paused safely: Supabase environment handles are offline.")

if __name__ == "__main__":
    run_pipeline()
