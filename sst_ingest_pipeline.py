#!/usr/bin/env python3
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

# NOAA ERDDAP URL API - Slices our box directly on their servers
NOAA_ERDDAP_URL = (
    "https://coastwatch.pfeg.noaa.gov/erddap/griddap/nesdisGeoSstAnomDaily.nc?"
    f"sea_surface_temperature[latest][({MAX_LAT}):({MIN_LAT})][({MIN_LNG}):({MAX_LNG})]"
)

OUTPUT_IMG_PATH = "./daily_latest.png"

# Supabase cloud credentials pulled securely from environment settings
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

def run_pipeline():
    print("⏳ Stage 1: Connecting to NOAA CoastWatch...")
    try:
        response = requests.get(NOAA_ERDDAP_URL, stream=True, timeout=45)
        response.raise_for_status()
        
        tmp_nc = "tmp_satellite_grid.nc"
        with open(tmp_nc, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        print("✅ Stage 1 Complete: Satellite gridded block secured.")
    except Exception as e:
        print(f"❌ Failure downloading NOAA grid: {e}")
        return

    print("⏳ Stage 2: Processing NetCDF satellite arrays...")
    try:
        with xr.open_dataset(tmp_nc) as ds:
            sst_k = ds['sea_surface_temperature'].values.squeeze()
            sst_f = (sst_k - 273.15) * 1.8 + 32
            
        if os.path.exists(tmp_nc):
            os.remove(tmp_nc)
            
        valid_temps = sst_f[~np.isnan(sst_f)]
        if len(valid_temps) == 0:
            valid_temps = np.array([68.0, 76.0])
            
        print("✅ Stage 2 Complete: Array mapped successfully.")
    except Exception as e:
        print(f"❌ Failure parsing NetCDF structure: {e}")
        return

    print("⏳ Stage 3: Computing dynamic palette scaling boundaries...")
    min_range = float(np.percentile(valid_temps, 2))
    max_range = float(np.percentile(valid_temps, 98))
    print(f"📈 Observed Matrix Boundaries: {min_range:.1f}°F to {max_range:.1f}°F")

    color_sequence = [
        "rgba(37, 99, 235, 0.55)", "rgba(22, 163, 74, 0.55)", "rgba(250, 204, 21, 0.55)",
        "rgba(234, 88, 12, 0.55)", "rgba(22, 163, 74, 0.45)", "rgba(185, 28, 28, 0.65)"
    ]
    
    hex_colors = ["#2563eb", "#16a34a", "#facc15", "#ea580c", "#dc2626", "#b91c1c"]
    custom_cmap = LinearSegmentedColormap.from_list("sst_scale", hex_colors, N=256)

    print("⏳ Stage 4: Rasterizing transparent map tile image...")
    sst_f_normalized = (sst_f - min_range) / (max_range - min_range)
    sst_f_normalized = np.clip(sst_f_normalized, 0, 1)
    
    nan_mask = np.isnan(sst_f)
    rgba_image_data = custom_cmap(sst_f_normalized)
    rgba_image_data[nan_mask] = [0, 0, 0, 0]
    
    uint8_img_matrix = (rgba_image_data * 255).astype(np.uint8)
    img = Image.fromarray(uint8_img_matrix, mode="RGBA")
    img_smooth = img.resize((512, 512), resample=Image.Resample.BICUBIC)
    img_smooth.save(OUTPUT_IMG_PATH, "PNG", optimize=True)
    print("✅ Stage 4 Complete: High-contrast raster overlay built.")

    # Execute Supabase synchronization if keys are present
    if SUPABASE_KEY and SUPABASE_URL:
        print("⏳ Stage 5: Uploading assets directly to Supabase Storage and DB...")
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
            print("🚀 Cloud Sync Finished! Map layers updated automatically.")
        except Exception as e:
            print(f"❌ Cloud Sync Failed: {e}")
    else:
        print("💡 Pipeline paused safely: Supabase environment handles are offline.")

if __name__ == "__main__":
    run_pipeline()
