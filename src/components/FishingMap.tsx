// src/components/FishingMap.tsx
// ─────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { toLoranTD, haversineNm, confidenceColor, speciesFromSST } from "../lib/hotspots";
import type { HotspotDisplay } from "./FishingMap";

export interface FishingMapProps {
  mode: "full" | "preview";
  hotspotDefs: any[]; 
  onHotspotClick?: (id: string) => void;
  onHotspotsResolved?: (hotspots: HotspotDisplay[]) => void;
  showHotspots?: boolean;
  showSST?: boolean;
  sstOffset?: number;
  showBathy?: boolean;
  flyTo?: { lat: number; lng: number; zoom?: number };
  className?: string;
}

const CANYONS = [
  { name: "Hudson", lat: 39.52, lng: -72.05 },
  { name: "Baltimore", lat: 38.22, lng: -73.82 },
  { name: "Wilmington", lat: 38.52, lng: -73.42 },
  { name: "Toms", lat: 39.15, lng: -72.95 },
  { name: "Spencer", lat: 39.05, lng: -72.7 },
  { name: "Atlantis", lat: 39.38, lng: -72.25 },
  { name: "Lindenkohl", lat: 38.95, lng: -72.85 },
  { name: "Washington", lat: 37.55, lng: -74.35 },
  { name: "Norfolk", lat: 37.05, lng: -74.65 },
  { name: "Poorman's", lat: 37.88, lng: -74.12 }
];

const BATHY_BASE_TILE = "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}";
const BATHY_OVERLAY_TILE = "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}";
const EMPTY_SIGNALS = { sstScore: 0, sstBreakScore: 0, chloroScore: 0, altimetryScore: 0, historyReportsScore: 0 };

export default function FishingMap({
  mode,
  hotspotDefs,
  onHotspotClick,
  onHotspotsResolved,
  showHotspots = true,
  showSST = true,
  sstOffset = 0,
  showBathy = true,
  flyTo,
  className = "",
}: FishingMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  const sstLayerRef = useRef<L.TileLayer | null>(null);
  const bathyBaseRef = useRef<L.TileLayer | null>(null);
  const bathyOverlayRef = useRef<L.TileLayer | null>(null);

  const circleMarkersRef = useRef<Map<string, L.CircleMarker>>(new Map());
  const labelMarkersRef = useRef<Map<string, L.Marker>>(new Map());

  const [liveHotspots, setLiveHotspots] = useState<HotspotDisplay[]>([]);
  const loadingIds = useRef<Set<string>>(new Set());
  const liveHotspotsRef = useRef<HotspotDisplay[]>(liveHotspots);

  useEffect(() => { liveHotspotsRef.current = liveHotspots; }, [liveHotspots]);

  // ── Processing Hook ──────────────────────────────────────────────────
  useEffect(() => {
    const activeIds = hotspotDefs.map((h) => h.id);
    loadingIds.current = new Set(activeIds);
    setLiveHotspots([]);
    liveHotspotsRef.current = [];

    const confirmed: HotspotDisplay[] = [];

    hotspotDefs.forEach((h) => {
      if (h.liveSst) {
        loadingIds.current.delete(h.id);
        const distLabel = h.title?.split(" ")[0] || "Canyon";
        
        const display: HotspotDisplay = {
          id: h.id,
          title: h.isPrimaryAI ? `Primary Target (${h.title})` : h.isSecondaryAI ? `Secondary Target (${h.title})` : h.title,
          distanceLabel: distLabel,
          confidence: h.liveConfidence || 75,
          sstTemp: h.liveSst,
          breakDelta: h.liveBreak || 0,
          lat: h.lat,
          lng: h.lng,
          species: speciesFromSST(h.liveSst),
          signals: h.liveSignals || EMPTY_SIGNALS,
          isFallbackSst: false,
        };

        confirmed.push(display);
        setLiveHotspots((prev) => [...prev.filter((e) => e.id !== h.id), display]);
        
        if (loadingIds.current.size === 0) onHotspotsResolved?.(confirmed);
        return; 
      }
      loadingIds.current.delete(h.id);
      if (loadingIds.current.size === 0) onHotspotsResolved?.(confirmed);
    });
  }, [hotspotDefs]);

  // ── Map Initialization Loop ──────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initCenter: [number, number] = mode === "full" ? [38.5, -73.5] : [38.2, -73.5];
    const initZoom = mode === "full" ? 8 : 7;
    const map = L.map(containerRef.current, { center: initCenter, zoom: initZoom, zoomControl: false });

    map.createPane("basePane").style.zIndex = "100";
    map.createPane("bathyBasePane").style.zIndex = "250";
    map.createPane("sstPane").style.zIndex = "350";
    map.createPane("bathyOverlayPane").style.zIndex = "450";
    map.createPane("labelPane").style.zIndex = "620";
    map.createPane("hotspotPane").style.zIndex = "700";

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { pane: "basePane" }).addTo(map);

    const bathyBase = L.tileLayer(BATHY_BASE_TILE, { opacity: 0.75, pane: "bathyBasePane", maxNativeZoom: 10, maxZoom: 14 });
    bathyBaseRef.current = bathyBase; bathyBase.addTo(map);

    const bathyOverlay = L.tileLayer(BATHY_OVERLAY_TILE, { opacity: 0.9, pane: "bathyOverlayPane", maxNativeZoom: 10, maxZoom: 14 });
    bathyOverlayRef.current = bathyOverlay; bathyOverlay.addTo(map);

    // Route image requests directly through your new server tile proxy
    const proxySstUrl = `/.netlify/functions/get-sst-tile?x={x}&y={y}&z={z}&offset=${sstOffset}`;
    const sstLayer = L.tileLayer(proxySstUrl, {
      opacity: mode === "full" ? 0.55 : 0.70,
      pane: "sstPane",
      maxZoom: 14
    });
    
    sstLayerRef.current = sstLayer; sstLayer.addTo(map);

    CANYONS.forEach((c) => {
      L.marker([c.lat, c.lng], {
        pane: "labelPane",
        interactive: false,
        icon: L.divIcon({ className: "", html: `<div style="color:#e2e8f0;font-size:11px;font-weight:700;white-space:nowrap;text-shadow:0 0 4px #000">${c.name}</div>`, iconAnchor: [40, 10] }),
      }).addTo(map);
    });

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Hot-swap proxy paths when historical timeline adjustments occur
  useEffect(() => {
    const layer = sstLayerRef.current;
    if (layer) {
      const proxySstUrl = `/.netlify/functions/get-sst-tile?x={x}&y={y}&z={z}&offset=${sstOffset}`;
      layer.setUrl(proxySstUrl);
    }
  }, [sstOffset]);

  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    syncMarkers(map, liveHotspots);
  }, [liveHotspots]);

  function syncMarkers(map: L.Map, spots: HotspotDisplay[]) {
    const incomingIds = new Set(spots.map((h) => h.id));
    circleMarkersRef.current.forEach((marker, id) => { if (!incomingIds.has(id)) { marker.remove(); circleMarkersRef.current.delete(id); } });
    labelMarkersRef.current.forEach((marker, id) => { if (!incomingIds.has(id)) { marker.remove(); labelMarkersRef.current.delete(id); } });

    spots.forEach((h) => {
      const color = confidenceColor(h.confidence);
      const existing = circleMarkersRef.current.get(h.id);

      if (existing) {
        existing.setStyle({ color, fillColor: color });
        return;
      }

      const circle = L.circleMarker([h.lat, h.lng], { pane: "hotspotPane", radius: 13, color, fillColor: color, fillOpacity: 0.35, weight: 2, interactive: true });
      circle.bindPopup(h.title, { className: "fishing-map-popup" });
      circle.addTo(map);
      circleMarkersRef.current.set(h.id, circle);

      const leading = h.distanceLabel ?? h.title.split(" ")[0];
      const labelMarker = L.marker([h.lat, h.lng], {
        pane: "labelPane",
        interactive: false,
        icon: L.divIcon({ className: "", html: `<div style="display:flex;align-items:center;gap:4px;white-space:nowrap"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${color}"></span><span style="color:#e2e8f0;font-size:11px;font-weight:600;text-shadow:0 0 4px #000">${leading} • ${h.sstTemp.toFixed(0)}°F</span></div>`, iconAnchor: [100, -12] })
      });
      labelMarker.addTo(map);
      labelMarkersRef.current.set(labelMarker);
    });
  }

  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    circleMarkersRef.current.forEach((m) => showHotspots ? (!map.hasLayer(m) && m.addTo(map)) : m.remove());
    labelMarkersRef.current.forEach((m) => showHotspots ? (!map.hasLayer(m) && m.addTo(map)) : m.remove());
  }, [showHotspots]);

  useEffect(() => {
    const map = mapRef.current; const layer = sstLayerRef.current; if (!map || !layer) return;
    if (showSST) { if (!map.hasLayer(layer)) layer.addTo(map); } else { layer.remove(); }
  }, [showSST]);

  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const base = bathyBaseRef.current; const overlay = bathyOverlayRef.current; if (!base || !overlay) return;
    if (showBathy) { if (!map.hasLayer(base)) base.addTo(map); if (!map.hasLayer(overlay)) overlay.addTo(map); } else { base.remove(); overlay.remove(); }
  }, [showBathy]);

  useEffect(() => { if (flyTo && mapRef.current) mapRef.current.flyTo([flyTo.lat, flyTo.lng], flyTo.zoom ?? 10, { duration: 1.2 }); }, [flyTo]);

  return <div ref={containerRef} className={`w-full h-full ${className}`} />;
}
