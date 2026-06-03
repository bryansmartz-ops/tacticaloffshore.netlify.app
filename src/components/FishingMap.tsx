// FishingMap.tsx — Shared Leaflet Map Component
// ─────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import {
  getSSTBBoxCached,
  getLastValidSSTBBox,
  scanBreakInBbox,
  gibsSSTTileUrl,
} from "../lib/erddap";
import type { BBoxQuery } from "../lib/erddap";
import {
  toLoranTD,
  haversineNm,
  confidenceColor,
  speciesFromSST,
  computeConfidence,
  buildHotspotSignals,
  OC_INLET,
  OC_RADIUS_NM,
  distFromOCInlet,
} from "../lib/hotspots";
import type { HotspotDef, HotspotSignals } from "../lib/hotspots";

// ─── Public Interfaces ────────────────────────────────────────────────────────

export interface HotspotDisplay {
  id: string;
  title: string;
  confidence: number;
  sstTemp: number;
  breakDelta: number;
  lat: number;
  lng: number;
  species: string[];
  signals: HotspotSignals;
  isFallbackSst: boolean;
  isDynamic?: boolean;
  anchorTitle?: string;
  distanceLabel?: string;
}

export interface FishingMapProps {
  mode: "full" | "preview";
  hotspotDefs: any[]; // Accept dynamic properties passed down from parent cache hook
  onHotspotClick?: (id: string) => void;
  onHotspotsResolved?: (hotspots: HotspotDisplay[]) => void;
  showHotspots?: boolean;
  showSST?: boolean;
  sstOffset?: number;
  showBathy?: boolean;
  onMapClick?: (info: MapClickInfo) => void;
  onSaveWaypoint?: (
    name: string,
    lat: number,
    lng: number,
    tdW: string,
    tdX: string,
  ) => Promise<void>;
  waypointCount?: number;
  flyTo?: { lat: number; lng: number; zoom?: number };
  className?: string;
}

export interface MapClickInfo {
  lat: number;
  lng: number;
  sstF: number | null;
  sstText: string;
  tdW: string;
  tdX: string;
  meta?: string;
}

// ─── Navigation Helpers ──────────────────────────────────────────────────────

function bearingDeg(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const dLng = ((toLng - fromLng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos((toLat * Math.PI) / 180);
  const x =
    Math.cos((fromLat * Math.PI) / 180) * Math.sin((toLat * Math.PI) / 180) -
    Math.sin((fromLat * Math.PI) / 180) * Math.cos((toLat * Math.PI) / 180) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function toCardinal(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

// ─── Constants ────────────────────────────────────────────────────────────────

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

// ─── Popup HTML Renderers ─────────────────────────────────────────────────────

function rankBadge(id: string, hotspots: HotspotDisplay[]): string {
  const sorted = [...hotspots].sort((a, b) => b.confidence - a.confidence);
  const rank = sorted.findIndex((h) => h.id === id);
  if (rank === 0) return `<span style="background:#f59e0b;color:#fff;font-size:9px;font-weight:700;border-radius:4px;padding:1px 5px;letter-spacing:0.05em;vertical-align:middle">PRIMARY</span>`;
  if (rank === 1) return `<span style="background:#06b6d4;color:#fff;font-size:9px;font-weight:700;border-radius:4px;padding:1px 5px;letter-spacing:0.05em;vertical-align:middle">SECONDARY</span>`;
  return "";
}

function buildClickPopupHtml(lat: number, lng: number, td: { w: string; x: string }, sstText: string, wpId: string, meta?: string): string {
  return `<div style="color:#cbd5e1;font-size:12px;min-width:190px">
    <div style="color:#67e8f9;font-weight:600;margin-bottom:4px">${lat.toFixed(4)}°N, ${Math.abs(lng).toFixed(4)}°W</div>
    <div style="color:#fb923c;margin-bottom:2px">🌡 SST: ${sstText}</div>
    ${meta ? `<div style="color:#64748b;font-size:10px;margin-bottom:4px">${meta}</div>` : ""}
    <div style="color:#94a3b8;font-size:11px;margin-bottom:6px">📡 LORAN W ${td.w} / X ${td.x} μs</div>
    <input id="wp-name-${wpId}" placeholder="Waypoint name…" style="width:100%;background:#1e293b;border:1px solid #475569;border-radius:5px;color:#e2e8f0;font-size:11px;padding:4px 7px;outline:none;box-sizing:border-box" />
    <button id="wp-save-${wpId}" style="margin-top:5px;width:100%;background:#0891b2;border:none;border-radius:5px;color:#fff;font-size:11px;font-weight:600;padding:5px 0;cursor:pointer">💾 Save Waypoint</button>
  </div>`;
}

function buildHotspotPopupHtml(h: HotspotDisplay, allHotspots: HotspotDisplay[], isLoading = false): string {
  const color = confidenceColor(h.confidence);
  const td = toLoranTD(h.lat, h.lng);
  const badge = rankBadge(h.id, allHotspots);
  const confColor = confidenceColor(h.confidence);
  const breakVal = h.breakDelta > 0 ? `🔥 +${h.breakDelta}°F break` : `<span style="color:#94a3b8">no break detected</span>`;
  const speciesTags = h.species.map((s) => `<span style="background:rgba(6,182,212,0.2);color:#67e8f9;border-radius:999px;padding:1px 7px;font-size:10px;margin-right:3px">${s}</span>`).join("");
  const sig = h.signals;
  
  const signalRows = [
    { label: "SST proximity", val: sig.sstScore, max: 20, color: "#fb923c" },
    { label: "Break sharpness", val: sig.sstBreakScore, max: 35, color: "#fbbf24" },
    { label: "Chlorophyll", val: sig.chloroScore, max: 20, color: "#4ade80" },
    { label: "Altimetry/SSH", val: sig.altimetryScore, max: 15, color: "#818cf8" },
    { label: "History/Reports", val: sig.historyReportsScore, max: 10, color: "#67e8f9" },
  ].map((r) => `
    <div style="display:flex;align-items:center;gap:4px;margin-bottom:2px">
      <span style="font-size:9px;color:#94a3b8;width:88px;flex-shrink:0">${r.label}</span>
      <div style="flex:1;background:#1e293b;border-radius:3px;height:5px;overflow:hidden">
        <div style="background:${r.color};width:${Math.round((r.val / r.max) * 100)}%;height:100%;border-radius:3px"></div>
      </div>
      <span style="font-size:9px;color:${r.color};width:24px;text-align:right;flex-shrink:0">${r.val}/${r.max}</span>
    </div>`).join("");

  return `<div style="color:#cbd5e1;font-size:12px;min-width:210px">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;flex-wrap:wrap">
      <span style="color:${color};font-weight:700;font-size:13px">${h.title}</span>
      ${badge}
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
      <span style="color:${confColor};font-size:18px;font-weight:800;line-height:1">${h.confidence}%</span>
      <span style="color:#94a3b8;font-size:10px">confidence (live cache)</span>
    </div>
    <div style="margin-bottom:5px">🌡 <strong style="color:#fb923c">${h.sstTemp.toFixed(1)}°F</strong> &nbsp;&nbsp;${breakVal}</div>
    <div style="margin-bottom:4px">${signalRows}</div>
    <div style="color:#a78bfa;font-size:11px;margin-bottom:5px">📡 LORAN W ${td.w} / X ${td.x} μs</div>
    <div style="margin-bottom:4px">${speciesTags}</div>
  </div>`;
}

function computeDistanceLabel(h: any): string {
  let bestName = h.title?.split(" ")[0] || "Canyon";
  let bestDist = Infinity;
  let bestBrng = 0;
  for (const c of CANYONS) {
    const d = haversineNm(c.lat, c.lng, h.lat, h.lng);
    if (d < bestDist) {
      bestDist = d;
      bestBrng = bearingDeg(c.lat, c.lng, h.lat, h.lng);
      bestName = c.name;
    }
  }
  const nm = Math.round(bestDist);
  if (nm < 5) return `${bestName}`;
  return `${nm}NM ${toCardinal(bestBrng)} of ${bestName}`;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function FishingMap({
  mode,
  hotspotDefs,
  onHotspotClick,
  onHotspotsResolved,
  showHotspots = true,
  showSST = true,
  sstOffset = 0,
  showBathy = true,
  onMapClick,
  onSaveWaypoint,
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
  const loadingIds = useRef<Set<string>>(new Set(hotspotDefs.map((h) => h.id)));

  const onHotspotClickRef = useRef(onHotspotClick);
  const liveHotspotsRef = useRef<HotspotDisplay[]>(liveHotspots);

  useEffect(() => { onHotspotClickRef.current = onHotspotClick; }, [onHotspotClick]);
  useEffect(() => { liveHotspotsRef.current = liveHotspots; }, [liveHotspots]);

  const noBannerRef = useRef<L.Marker | null>(null);

  function showNoBanner(map: L.Map) {
    if (noBannerRef.current) return;
    const banner = L.marker([38.5, -73.5], {
      pane: "hotspotPane",
      interactive: false,
      icon: L.divIcon({
        className: "",
        html: `<div style="background:rgba(30,41,59,0.92);border:1px solid rgba(251,146,60,0.6);border-radius:8px;padding:8px 14px;color:#fb923c;font-size:12px;font-weight:600;white-space:nowrap;box-shadow:0 2px 12px rgba(0,0,0,0.6)">⚠ Standby — compiling local tracking arrays</div>`,
        iconAnchor: [170, 14],
      }),
    });
    banner.addTo(map);
    noBannerRef.current = banner;
  }

  function hideNoBanner() {
    if (noBannerRef.current) {
      noBannerRef.current.remove();
      noBannerRef.current = null;
    }
  }

  // ── Multi-Stream Processing Hook ──────────────────────────────────────────
  useEffect(() => {
    loadingIds.current = new Set(hotspotDefs.map((h) => h.id));
    setLiveHotspots([]);
    liveHotspotsRef.current = [];

    const confirmed: HotspotDisplay[] = [];

    hotspotDefs.forEach((h) => {
      // INTERCEPT LOGIC: If parent already has live data-cache frames, completely bypass public ERDDAP network scans
      if (h.liveSst) {
        loadingIds.current.delete(h.id);
        const distLabel = computeDistanceLabel(h);
        
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
        
        setLiveHotspots((prev) => {
          const next = [...prev.filter((e) => e.id !== h.id), display];
          liveHotspotsRef.current = next;
          return next;
        });

        if (loadingIds.current.size === 0) {
          hideNoBanner();
          onHotspotsResolved?.(confirmed);
        }
        return; 
      }

      // Fallback grid-scan pipeline if cache layers aren't initialized yet
      scanBreakInBbox({ searchBbox: h.searchBbox, ambLat: h.ambientLat, ambLng: h.ambientLng }).then((result) => {
        loadingIds.current.delete(h.id);
        if (result.ok) {
          const { hotLat, hotLng, hotTempF, breakDeltaF } = result;
          const breakDelta = parseFloat(Math.max(0, breakDeltaF).toFixed(1));
          const signals = buildHotspotSignals(hotTempF, breakDelta, { ...h, lat: hotLat, lng: hotLng });
          const rawConf = computeConfidence(signals);

          if (rawConf >= h.minConfidence && distFromOCInlet(hotLat, hotLng) <= OC_RADIUS_NM) {
            const distLabel = computeDistanceLabel({ ...h, lat: hotLat, lng: hotLng });
            const display: HotspotDisplay = {
              id: h.id,
              title: distLabel,
              distanceLabel: distLabel,
              confidence: rawConf,
              sstTemp: hotTempF,
              breakDelta,
              lat: hotLat,
              lng: hotLng,
              species: speciesFromSST(hotTempF),
              signals,
              isFallbackSst: false,
            };
            confirmed.push(display);
            setLiveHotspots((prev) => {
              const next = [...prev.filter((e) => e.id !== h.id), display];
              liveHotspotsRef.current = next;
              return next;
            });
          }
        }

        if (loadingIds.current.size === 0) {
          setTimeout(() => {
            const list = liveHotspotsRef.current;
            if (list.length === 0) {
              if (mapRef.current) showNoBanner(mapRef.current);
              onHotspotsResolved?.([]);
            } else {
              hideNoBanner();
              onHotspotsResolved?.(list);
            }
          }, 0);
        }
      });
    });
  }, [hotspotDefs]);

  // ── Map Base Initialization Loop ──────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initCenter: [number, number] = mode === "full" ? [38.5, -73.5] : [38.2, -73.5];
    const initZoom = mode === "full" ? 8 : 7;
    const map = L.map(containerRef.current, { center: initCenter, zoom: initZoom, zoomControl: false });

    const basePane = map.createPane("basePane"); basePane.style.zIndex = "100";
    const bathyBasePane = map.createPane("bathyBasePane"); bathyBasePane.style.zIndex = "250";
    const sstPane = map.createPane("sstPane"); sstPane.style.zIndex = "350";
    const bathyOverlayPane = map.createPane("bathyOverlayPane"); bathyOverlayPane.style.zIndex = "450";
    const labelPane = map.createPane("labelPane"); labelPane.style.zIndex = "620";
    const hotspotPane = map.createPane("hotspotPane"); hotspotPane.style.zIndex = "700"; hotspotPane.style.pointerEvents = "auto";

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { attribution: "&copy; CartoDB", pane: "basePane" }).addTo(map);

    const bathyBase = L.tileLayer(BATHY_BASE_TILE, { attribution: "&copy; Esri", opacity: 0.75, pane: "bathyBasePane", maxNativeZoom: 10, maxZoom: 14 });
    bathyBaseRef.current = bathyBase; bathyBase.addTo(map);

    const bathyOverlay = L.tileLayer(BATHY_OVERLAY_TILE, { attribution: "&copy; Esri", opacity: 0.9, pane: "bathyOverlayPane", maxNativeZoom: 10, maxZoom: 14 });
    bathyOverlayRef.current = bathyOverlay; bathyOverlay.addTo(map);

    const sstLayer = L.tileLayer(gibsSSTTileUrl(0), { attribution: "&copy; NASA GIBS", opacity: mode === "full" ? 0.45 : 0.65, pane: "sstPane", maxNativeZoom: 7, maxZoom: 14, tileSize: 256 });
    sstLayerRef.current = sstLayer; sstLayer.addTo(map);

    CANYONS.forEach((c) => {
      L.marker([c.lat, c.lng], {
        pane: "labelPane",
        interactive: false,
        icon: L.divIcon({
          className: "",
          html: `<div style="color:#e2e8f0;font-size:11px;font-weight:700;white-space:nowrap;text-shadow:0 0 4px #000,0 0 8px #000;letter-spacing:0.03em">${c.name}</div>`,
          iconAnchor: [40, 10],
        }),
      }).addTo(map);
    });

    map.on("click", async (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      const td = toLoranTD(lat, lng);
      const wpId = Math.random().toString(36).slice(2, 9);

      const popup = L.popup({ className: "fishing-map-popup" })
        .setLatLng(e.latlng)
        .setContent(buildClickPopupHtml(lat, lng, td, "fetching…", wpId))
        .openOn(map);

      const wireSave = () => {
        const btn = document.getElementById(`wp-save-${wpId}`);
        if (!btn) return;
        btn.addEventListener("click", async () => {
          const input = document.getElementById(`wp-name-${wpId}`) as HTMLInputElement | null;
          const name = input?.value.trim() || `WP ${new Date().toLocaleTimeString()}`;
          await onSaveWaypointRef.current?.(name, lat, lng, td.w, td.x);
          popup.close();
        });
      };
      popup.on("add", wireSave);

      const result = await getSSTBBoxCached({ minLat: lat - 0.1, maxLat: lat + 0.1, minLng: lng - 0.1, maxLng: lng + 0.1 });
      if (!map.hasLayer(popup)) return;

      let sstText = result.ok ? `${result.fahrenheit.toFixed(1)}°F` : "unavailable";
      popup.setContent(buildClickPopupHtml(lat, lng, td, sstText, wpId));
      wireSave();
    });

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; circleMarkersRef.current.clear(); labelMarkersRef.current.clear(); };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    syncMarkers(map, liveHotspots, loadingIds.current);
  }, [liveHotspots]);

  function syncMarkers(map: L.Map, spots: HotspotDisplay[], loadingSet: Set<string>) {
    const incomingIds = new Set(spots.map((h) => h.id));

    circleMarkersRef.current.forEach((marker, id) => { if (!incomingIds.has(id)) { marker.remove(); circleMarkersRef.current.delete(id); } });
    labelMarkersRef.current.forEach((marker, id) => { if (!incomingIds.has(id)) { marker.remove(); labelMarkersRef.current.delete(id); } });

    spots.forEach((h) => {
      const color = confidenceColor(h.confidence);
      const isLoading = loadingSet.has(h.id);
      const existing = circleMarkersRef.current.get(h.id);

      if (existing) {
        existing.setStyle({ color, fillColor: color });
        existing.setPopupContent(buildHotspotPopupHtml(h, spots, isLoading));
        const lbl = labelMarkersRef.current.get(h.id);
        if (lbl) lbl.setIcon(buildLabelIcon(h, color));
        return;
      }

      const circle = L.circleMarker([h.lat, h.lng], { pane: "hotspotPane", radius: 13, color, fillColor: color, fillOpacity: 0.35, weight: 2, interactive: true, bubblingMouseEvents: false });
      circle.bindPopup(buildHotspotPopupHtml(h, spots, isLoading), { className: "fishing-map-popup" });
      circle.on("click", () => { onHotspotClickRef.current?.(h.id); });
      circle.addTo(map);
      circleMarkersRef.current.set(h.id, circle);

      const labelMarker = L.marker([h.lat, h.lng], { pane: "labelPane", interactive: false, icon: buildLabelIcon(h, color) });
      labelMarker.addTo(map);
      labelMarkersRef.current.set(h.id, labelMarker);
    });
  }

  function buildLabelIcon(h: HotspotDisplay, color: string): L.DivIcon {
    const leading = h.distanceLabel ?? h.title.split(" ")[0];
    return L.divIcon({
      className: "",
      html: `<div style="display:flex;align-items:center;gap:4px;pointer-events:none;white-space:nowrap"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${color};opacity:0.9"></span><span style="color:#e2e8f0;font-size:11px;font-weight:600;text-shadow:0 0 4px #000,0 0 8px #000">${leading} • ${h.sstTemp.toFixed(0)}°F • ${h.confidence}%</span></div>`,
      iconAnchor: [100, -12],
    });
  }

  // ── Layer Visibility Syncloop Controls ─────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    circleMarkersRef.current.forEach((m) => showHotspots ? (!map.hasLayer(m) && m.addTo(map)) : m.remove());
    labelMarkersRef.current.forEach((m) => showHotspots ? (!map.hasLayer(m) && m.addTo(map)) : m.remove());
  }, [showHotspots]);

  useEffect(() => {
    const map = mapRef.current; const layer = sstLayerRef.current; if (!map || !layer) return;
    if (showSST) { layer.setUrl(gibsSSTTileUrl(sstOffset)); if (!map.hasLayer(layer)) layer.addTo(map); } else { layer.remove(); }
  }, [showSST, sstOffset]);

  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const base = bathyBaseRef.current; const overlay = bathyOverlayRef.current; if (!base || !overlay) return;
    if (showBathy) { if (!map.hasLayer(base)) base.addTo(map); if (!map.hasLayer(overlay)) overlay.addTo(map); } else { base.remove(); overlay.remove(); }
  }, [showBathy]);

  useEffect(() => { if (flyTo && mapRef.current) mapRef.current.flyTo([flyTo.lat, flyTo.lng], flyTo.zoom ?? 10, { duration: 1.2 }); }, [flyTo]);
  useEffect(() => { const map = mapRef.current; if (!map) return; const t = setTimeout(() => map.invalidateSize(), 150); return () => clearTimeout(t); }, [className]);

  return <div ref={containerRef} className={`w-full h-full ${className}`} />;
}
