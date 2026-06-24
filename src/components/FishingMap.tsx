// src/components/FishingMap.tsx
// High-Fidelity Non-Blocking Asynchronous Mapping Deck
// ──────────────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { confidenceColor } from "../lib/hotspots";

export interface HotspotDisplay {
  id: string;
  title: string;
  distanceLabel: string;
  confidence: number;
  sstTemp: number;
  breakDelta: number;
  lat: number;
  lng: number;
  species: string[];
  signals: any;
  loran?: { w: string; x: string };
  isFallbackSst: boolean;
}

export interface FishingMapProps {
  mode: "full" | "preview";
  hotspotDefs: any; 
  onHotspotClick?: (id: string) => void;
  onHotspotsResolved?: (hotspots: HotspotDisplay[]) => void;
  showHotspots?: boolean;
  showSST?: boolean;
  sstOffset?: number;
  showBathy?: boolean;
  showWeather?: boolean; 
  flyTo?: { lat: number; lng: number; zoom?: number };
  className?: string;
}

const CANYONS = [
  { name: "Hudson", lat: 39.52, lng: -72.05 },
  { name: "Toms", lat: 39.15, lng: -72.95 },
  { name: "Spencer", lat: 39.05, lng: -72.7 },
  { name: "Lindenkohl", lat: 38.95, lng: -72.85 },
  { name: "Wilmington", lat: 38.52, lng: -73.42 },
  { name: "Baltimore", lat: 38.22, lng: -73.82 },
  { name: "Poorman's", lat: 37.88, lng: -74.12 },
  { name: "Washington", lat: 37.55, lng: -74.35 },
  { name: "Norfolk", lat: 37.05, lng: -74.65 }
];

const BATHY_BASE_TILE = "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}";
const BATHY_OVERLAY_TILE = "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}";
const WEATHER_WAVE_TILE = "https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"; 

const TELEMETRY_PROXY = "/.netlify/functions/get-latest-briefs";

export default function FishingMap({
  mode,
  hotspotDefs,
  onHotspotClick,
  onHotspotsResolved,
  showHotspots = true,
  showSST = true,
  sstOffset = 0,
  showBathy = true,
  showWeather = false, 
  flyTo,
  className = "",
}: FishingMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const workerRef = useRef<Worker | null>(null);
  
  const bathyBaseLayerRef = useRef<L.TileLayer | null>(null);
  const bathyOverlayLayerRef = useRef<L.TileLayer | null>(null);
  const weatherLayerRef = useRef<L.TileLayer | null>(null);
  const sstStaticOverlayRef = useRef<L.ImageOverlay | null>(null);
  
  const [buoyData, setBuoyData] = useState<any>(null);
  const [liveHotspots, setLiveHotspots] = useState<HotspotDisplay[]>([]);
  const [baselineSst, setBaselineSst] = useState<number>(72.4);
  
  const circleMarkersRef = useRef<Map<string, L.CircleMarker>>(new Map());
  const labelMarkersRef = useRef<Map<string, L.Marker>>(new Map());

  // ── 1. MOUNT LEAFLET BASE WORKSPACE EXACTLY ONCE ───────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, { 
      center: [38.1, -74.0], 
      zoom: mode === "full" ? 8 : 7, 
      zoomControl: false, maxZoom: 14, minZoom: 5
    });

    map.createPane("basePane").style.zIndex = "100";
    map.createPane("bathyBasePane").style.zIndex = "200";
    map.createPane("sstPane").style.zIndex = "300";
    map.createPane("weatherPane").style.zIndex = "350"; 
    map.createPane("bathyOverlayPane").style.zIndex = "400";
    map.createPane("labelPane").style.zIndex = "500";
    map.createPane("hotspotPane").style.zIndex = "600";

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { pane: "basePane" }).addTo(map);

    bathyBaseLayerRef.current = L.tileLayer(BATHY_BASE_TILE, { maxNativeZoom: 10, maxZoom: 14, opacity: 0.55, pane: "bathyBasePane" });
    bathyOverlayLayerRef.current = L.tileLayer(BATHY_OVERLAY_TILE, { maxNativeZoom: 10, maxZoom: 14, opacity: 0.45, pane: "bathyOverlayPane" });
    weatherLayerRef.current = L.tileLayer(WEATHER_WAVE_TILE, { maxZoom: 12, opacity: 0.65, pane: "weatherPane" });

    // Client Coastal Contour Shape Mask Rendering
    const sstVisualBounds: L.LatLngBoundsExpression = [[35.0, -76.5], [39.5, -72.0]];
    const offscreenCanvas = document.createElement("canvas");
    offscreenCanvas.width = 600;
    offscreenCanvas.height = 600;
    const ctx = offscreenCanvas.getContext("2d");
    
    if (ctx) {
      ctx.clearRect(0, 0, 600, 600);
      const latToY = (lat: number) => (1.0 - (lat - 35.0) / (39.5 - 35.0)) * 600;
      const lngToX = (lng: number) => ((lng - (-76.5)) / (-72.0 - (-76.5))) * 600;

      ctx.beginPath();
      ctx.moveTo(lngToX(-75.51), latToY(35.22)); ctx.lineTo(lngToX(-75.95), latToY(36.85)); 
      ctx.lineTo(lngToX(-75.05), latToY(38.35)); ctx.lineTo(lngToX(-74.25), latToY(39.50)); 
      ctx.lineTo(lngToX(-72.05), latToY(39.50)); ctx.lineTo(lngToX(-73.80), latToY(37.00)); 
      ctx.lineTo(lngToX(-74.90), latToY(35.00)); ctx.closePath(); ctx.clip();

      const linearGradient = ctx.createLinearGradient(lngToX(-75.30), latToY(36.50), lngToX(-72.50), latToY(38.80));
      linearGradient.addColorStop(0, "rgba(37, 99, 235, 0.45)");
      linearGradient.addColorStop(0.50, "rgba(22, 163, 74, 0.50)");
      linearGradient.addColorStop(1, "rgba(234, 88, 12, 0.55)");
      
      ctx.fillStyle = linearGradient; ctx.fillRect(0, 0, 600, 600); ctx.filter = "blur(10px)";
      const thermalImageString = offscreenCanvas.toDataURL();
      sstStaticOverlayRef.current = L.imageOverlay(thermalImageString, sstVisualBounds, { pane: "sstPane", interactive: false });
    }

    CANYONS.forEach((c) => {
      L.marker([c.lat, c.lng], {
        pane: "labelPane", interactive: false,
        icon: L.divIcon({ className: "", html: `<div style="color:#fff;font-size:10px;font-weight:700;white-space:nowrap;text-shadow:0 0 3px #000">${c.name}</div>`, iconAnchor: [30, 5] }),
      }).addTo(map);
    });

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // ── 2. INITIALIZE ASYNCHRONOUS BACKGROUND WEB WORKER THREAD ─────────────
  useEffect(() => {
    // Instantiate worker thread out-of-line from UI frame updates
    workerRef.current = new Worker(
      new URL("../workers/hotspotEvaluator.worker.ts", import.meta.url),
      { type: "module" }
    );

    workerRef.current.onmessage = (event: MessageEvent) => {
      const { success, hotspots } = event.data;
      if (success && hotspots) {
        setLiveHotspots(hotspots);
        onHotspotsResolved?.(hotspots);
      }
    };

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [onHotspotsResolved]);

  // ── 3. ASYNC FETCH & WORKER OFFLOADING OF TELEMETRY DATA ───────────────
  useEffect(() => {
    let activeScope = true;
    async function loadCloudTelemetry() {
      try {
        const response = await fetch(TELEMETRY_PROXY);
        if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
        const payload = await response.json();
        
        if (!activeScope) return;
        if (payload?.live_sst_value) setBaselineSst(payload.live_sst_value);

        const b = payload?.buoyFallback;
        if (b) {
          setBuoyData({
            waveHeight: b.wave?.toString() || "2.5",
            period: b.period?.toString() || "8",
            windSpeed: b.wind?.toString() || "10-15",
            windDirection: `${b.dir || "SW"}`,
            source: b.activeStation || "NOAA HARMONIC CONSOLE"
          });
        }
      } catch (err) {
        console.warn("[Telemetry Failover Intercepted]: Thread safe.", err);
      }
    }
    loadCloudTelemetry();
    return () => { activeScope = false; };
  }, []);

  // Dispatch work to the worker thread whenever dependencies change
  useEffect(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({
        baselineSst,
        sstOffset,
        hotspotDefs,
        canyonsMatrix: CANYONS
      });
    }
  }, [baselineSst, sstOffset, hotspotDefs]);

  // ── 4. ATOMIC VISIBILITY CONTROLS (NO TEARDOWN RE-MOUNTS) ───────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (bathyBaseLayerRef.current && bathyOverlayLayerRef.current) {
      if (showBathy) {
        if (!map.hasLayer(bathyBaseLayerRef.current)) map.addLayer(bathyBaseLayerRef.current);
        if (!map.hasLayer(bathyOverlayLayerRef.current)) map.addLayer(bathyOverlayLayerRef.current);
      } else {
        if (map.hasLayer(bathyBaseLayerRef.current)) map.removeLayer(bathyBaseLayerRef.current);
        if (map.hasLayer(bathyOverlayLayerRef.current)) map.removeLayer(bathyOverlayLayerRef.current);
      }
    }

    if (weatherLayerRef.current) {
      if (showWeather) {
        if (!map.hasLayer(weatherLayerRef.current)) map.addLayer(weatherLayerRef.current);
      } else {
        if (map.hasLayer(weatherLayerRef.current)) map.removeLayer(weatherLayerRef.current);
      }
    }

    if (sstStaticOverlayRef.current) {
      if (showSST) {
        if (!map.hasLayer(sstStaticOverlayRef.current)) map.addLayer(sstStaticOverlayRef.current);
      } else {
        if (map.hasLayer(sstStaticOverlayRef.current)) map.removeLayer(sstStaticOverlayRef.current);
      }
    }
  }, [showBathy, showSST, showWeather]);

  // ── 5. ASYNCHRONOUS PLOT CARD INJECTION ─────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    circleMarkersRef.current.forEach(m => m.remove());
    labelMarkersRef.current.forEach(m => m.remove());
    circleMarkersRef.current.clear();
    labelMarkersRef.current.clear();

    if (!showHotspots || liveHotspots.length === 0) return;

    liveHotspots.forEach((h) => {
      const color = confidenceColor(h.confidence);
      const circle = L.circleMarker([h.lat, h.lng], { pane: "hotspotPane", radius: 12, color, fillColor: color, fillOpacity: 0.4, weight: 2 });
      
      circle.bindPopup(`
        <div style="color:#cbd5e1;font-size:12px;min-width:200px;font-family:monospace;">
          <b style="color:${color}; font-size:13px; display:block; margin-bottom:2px;">${h.title}</b>
          🌡 <span style="color:#fb923c">${h.sstTemp.toFixed(1)}°F</span><br/>
          📡 LORAN W ${h.loran?.w || "--"} / X ${h.loran?.x || "--"}
        </div>
      `);
      circle.addTo(map);
      circleMarkersRef.current.set(h.id, circle);

      const label = L.marker([h.lat, h.lng], {
        pane: "labelPane", interactive: false,
        icon: L.divIcon({ className: "", html: `<div style="display:flex;align-items:center;gap:3px;white-space:nowrap;"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${color}"></span><span style="color:#fff;font-size:10px;font-weight:600;text-shadow:0 0 3px #000">${h.distanceLabel} • ${h.sstTemp.toFixed(1)}°</span></div>`, iconAnchor: [60, -10] })
      });
      label.addTo(map);
      labelMarkersRef.current.set(h.id, label);
    });
  }, [liveHotspots, showHotspots, sstOffset]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && flyTo) {
      map.flyTo([flyTo.lat, flyTo.lng], flyTo.zoom || 9, { animate: true, duration: 1.5 });
    }
  }, [flyTo]);

  return <div ref={containerRef} className={`w-full h-full ${className}`} />;
}
