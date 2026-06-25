#!/usr/bin/env python3
"""
SST Ingestion Pipeline - Real-World Production High-Fidelity Satellite Engine
Extracts 1km resolution telemetry grids directly from NOAA/NASA JPL MUR SST records.
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

# 2. TOURNAMENT GOLD STANDARD ENDPOINT: JPL MUR SST (1km Resolution Grid)
# Formatted to query the unconstrained active grid layer cleanly to bypass server-side slicing errors
NOAA_MUR_URL = "https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.nc?analysed_sst[latest][:][:]"

OUTPUT_IMG_PATH = "./daily_latest.png"

# Supabase API keys loaded from secure environment context
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

def run_pipeline():
    print("⏳ Stage 1: Establishing handshake with NOAA/NASA JPL Data Nodes...")
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        # Fetching the raw NetCDF data file via HTTP stream
        response = requests.get(NOAA_MUR_URL, headers=headers, stream=True, timeout=120)
        response.raise_for_status()
        
        tmp_nc = "tmp_satellite_grid.nc"
        with open(tmp_nc, "wb") as f:
            for chunk in response.iter_content(chunk_size=16384):
                f.write(chunk)
        print("✅ Stage 1 Complete: Binary NetCDF satellite package secured.")
    except Exception as e:
        print(f"❌ Critical Error connecting to NOAA ERDDAP Stream: {e}")
        return

    print("⏳ Stage 2: Slicing multidimensional structural dimensions locally...")
    try:
        with xr.open_dataset(tmp_nc) as ds:
            # Dynamically look up the exact name of coordinate dimensions inside NASA's payload
            lat_dim = 'latitude' if 'latitude' in ds.coords else 'lat'
            lon_dim = 'longitude' if 'longitude' in ds.coords else 'lon'
            
            # Perform high-precision slicing right in our secure virtual machine memory environment
            sliced_ds = ds.sel({
                lat_dim: slice(MIN_LAT, MAX_LAT),
                lon_dim: slice(MIN_LNG, MAX_LNG)
            })
            
            # Extract out the 2D spatial temperature matrix
            sst_k = sliced_ds['analysed_sst'].values.squeeze()
            
            # Real-World Conversion Math:
            # NOAA stores MUR data in Kelvin. Convert to Fahrenheit: (K - 273.15) * 1.8 + 32
            sst_f = (sst_k - 273.15) * 1.8 + 32
            
        if os.path.exists(tmp_nc):
            os.remove(tmp_nc)
            
        # Isolate true marine pixels, stripping out dry landmasses or cloud anomalies
        valid_temps = sst_f[~np.isnan(sst_f)]
        if len(valid_temps) == 0:
            raise ValueError("Satellite pass returned completely null/masked coordinate array blocks.")
            
        print("✅ Stage 2 Complete: Temperature metrics isolated and mapped natively.")
    except Exception as e:
        print(f"❌ Critical Error parsing data layers: {e}")
        if os.path.exists(tmp_nc):
            os.remove(tmp_nc)
        return

    print("⏳ Stage 3: Running Dynamic Contrast Scaling Math...")
    # Clean up signal noise by trimming out the extreme top and bottom 2% of anomalous entries
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
    
    # Flip the array along the vertical axis if NOAA's grid indexing sorts North-to-South
    # This prevents the satellite chart from rendering upside down on Leaflet
    sst_f_normalized = np.flipud(sst_f_normalized)
    
    nan_mask = np.isnan(sst_f_normalized)
    rgba_image_data = custom_cmap(sst_f_normalized)
    rgba_image_data[nan_mask] = [0, 0, 0, 0] # Alpha 0 handles landmasses and cloud fields
    
    uint8_img_matrix = (rgba_image_data * 255).astype(np.uint8)
    img = Image.fromarray(uint8_img_matrix, mode="RGBA")
    
    # Resize up cleanly using high-grade bicubic filtering for ultra-smooth rendering
    img_smooth = img.resize((1024, 1024), resample=Image.Resample.BICUBIC)
    img_smooth.save(OUTPUT_IMG_PATH, "PNG", optimize=True)
    print("✅ Stage 4 Complete: Transparent raster tile built.")

    if SUPABASE_KEY and SUPABASE_URL:
        print("⏳ Stage 5: Streaming data packages to Supabase Data Warehouse...")
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
