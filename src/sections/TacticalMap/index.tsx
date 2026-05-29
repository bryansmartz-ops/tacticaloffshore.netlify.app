import { useEffect, useRef, useState, useCallback } from "react";
import {
  Layers,
  Thermometer,
  Navigation,
  Target,
  Clock,
  Bookmark,
  BookmarkCheck,
  Trash2,
  X,
} from "lucide-react";
import L from "leaflet";
import {
  getSSTCached,
  gibsSSTDate,
  gibsSSTTileUrl,
  gibsSSTLabel,
} from "../../lib/erddap";
import { useQuery, useMutation } from "@animaapp/playground-react-sdk";
import type { Waypoint } from "@animaapp/playground-react-sdk";

const MASTER = { lat: 42.7137, lng: -76.8246 };
const SEC_W = { lat: 46.8, lng: -67.9266 };
const SEC_X = { lat: 41.253, lng: -69.9775 };

const ED_W = 28691;
const ED_X = 41657;
const C_US_PER_NM = 6.177;

function haversineNm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 3440.065;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function toLoranTD(lat: number, lng: number) {
  const dM = haversineNm(lat, lng, MASTER.lat, MASTER.lng);
  const dW = haversineNm(lat, lng, SEC_W.lat, SEC_W.lng);
  const dX = haversineNm(lat, lng, SEC_X.lat, SEC_X.lng);
  const tdW = ED_W + (dM - dW) * C_US_PER_NM;
  const tdX = ED_X + (dM - dX) * C_US_PER_NM;
  return {
    w: (tdW >= 0 ? "+" : "") + Math.round(tdW),
    x: (tdX >= 0 ? "+" : "") + Math.round(tdX),
  };
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
];

interface HotspotDef {
  id: string;
  title: string;
  confidence: number;
  sstTemp: number;
  breakDelta: number;
  lat: number;
  lng: number;
  species: string[];
}

const HOTSPOTS: HotspotDef[] = [
  {
    id: "1",
    title: "Washington Canyon Break",
    confidence: 88,
    sstTemp: 76,
    breakDelta: 4.2,
    lat: 37.55,
    lng: -74.35,
    species: ["Yellowfin Tuna", "Mahi Mahi"],
  },
  {
    id: "2",
    title: "Norfolk Canyon Edge",
    confidence: 82,
    sstTemp: 74,
    breakDelta: 3.1,
    lat: 37.05,
    lng: -74.65,
    species: ["Bluefin Tuna", "Wahoo"],
  },
  {
    id: "3",
    title: "Baltimore Canyon Warm Pocket",
    confidence: 76,
    sstTemp: 78,
    breakDelta: 2.8,
    lat: 38.22,
    lng: -73.82,
    species: ["Mahi Mahi", "White Marlin"],
  },
  {
    id: "4",
    title: "Hudson Canyon Rip",
    confidence: 71,
    sstTemp: 72,
    breakDelta: 2.2,
    lat: 39.52,
    lng: -72.05,
    species: ["Bigeye Tuna", "Swordfish"],
  },
  {
    id: "5",
    title: "Wilmington Canyon Ledge",
    confidence: 68,
    sstTemp: 73,
    breakDelta: 1.9,
    lat: 38.52,
    lng: -73.42,
    species: ["Yellowfin Tuna", "Wahoo"],
  },
];

function confidenceColor(c: number) {
  if (c >= 80) return "#34d399";
  if (c >= 65) return "#fbbf24";
  return "#f87171";
}

const BATHY_BASE_TILE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}";
const BATHY_OVERLAY_TILE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}";

const SST_HISTORY_OFFSETS = [0, 1, 2, 3];
const SST_DATE = gibsSSTDate();

function sstFallbackLabel(reason: "timeout" | "land" | "error"): string {
  if (reason === "timeout") return "timed out";
  if (reason === "land") return "land / no data";
  return "unavailable";
}

function renderPopup(
  lat: number,
  lng: number,
  td: { w: string; x: string },
  sstText: string,
  wpId: string,
): string {
  return `<div style="color:#cbd5e1;font-size:12px;min-width:190px">
    <div style="color:#67e8f9;font-weight:600;margin-bottom:4px">${lat.toFixed(4)}°N, ${Math.abs(lng).toFixed(4)}°W</div>
    <div style="color:#fb923c;margin-bottom:2px">🌡 SST: ${sstText}</div>
    <div style="color:#94a3b8;font-size:11px;margin-bottom:6px">📡 LORAN W ${td.w} / X ${td.x} μs</div>
    <input id="wp-name-${wpId}" placeholder="Waypoint name…" style="width:100%;background:#1e293b;border:1px solid #475569;border-radius:5px;color:#e2e8f0;font-size:11px;padding:4px 7px;outline:none;box-sizing:border-box" />
    <button id="wp-save-${wpId}" style="margin-top:5px;width:100%;background:#0891b2;border:none;border-radius:5px;color:#fff;font-size:11px;font-weight:600;padding:5px 0;cursor:pointer">💾 Save Waypoint</button>
  </div>`;
}

export default function TacticalMap() {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sstLayersRef = useRef<(L.TileLayer | null)[]>([null, null, null, null]);
  const bathyBaseRef = useRef<L.TileLayer | null>(null);
  const bathyOverlayRef = useRef<L.TileLayer | null>(null);
  const [showSST, setShowSST] = useState(true);
  const [showBathy, setShowBathy] = useState(true);
  const [showHotspots, setShowHotspots] = useState(true);
  const [sstOffset, setSstOffset] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const animIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showWaypoints, setShowWaypoints] = useState(false);

  const { data: waypointsData } = useQuery("Waypoint", {
    orderBy: { savedAt: "desc" },
  });
  const {
    create: createWaypoint,
    remove: removeWaypoint,
    isPending: wpMutating,
  } = useMutation("Waypoint");

  const waypoints: Waypoint[] = waypointsData ?? [];
  const waypointsRef = useRef<Waypoint[]>(waypoints);

  useEffect(() => {
    waypointsRef.current = waypoints;
  }, [waypoints]);

  const addWaypoint = useCallback(
    async (
      name: string,
      lat: number,
      lng: number,
      tdW: string,
      tdX: string,
    ) => {
      await createWaypoint({
        name,
        lat,
        lng,
        tdW,
        tdX,
        savedAt: new Date(),
      });
    },
    [createWaypoint],
  );

  const deleteWaypoint = useCallback(
    async (id: string) => {
      await removeWaypoint(id);
    },
    [removeWaypoint],
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [38.5, -73.5],
      zoom: 8,
      zoomControl: false,
    });

    const basePane = map.createPane("basePane");
    basePane.style.zIndex = "100";
    basePane.style.pointerEvents = "none";

    const bathyBasePane = map.createPane("bathyBasePane");
    bathyBasePane.style.zIndex = "250";
    bathyBasePane.style.pointerEvents = "none";

    const sstPane = map.createPane("sstPane");
    sstPane.style.zIndex = "350";
    sstPane.style.pointerEvents = "none";

    const bathyOverlayPane = map.createPane("bathyOverlayPane");
    bathyOverlayPane.style.zIndex = "450";
    bathyOverlayPane.style.pointerEvents = "none";

    const labelPane = map.createPane("labelPane");
    labelPane.style.zIndex = "620";
    labelPane.style.pointerEvents = "none";

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        attribution: "&copy; CartoDB",
        pane: "basePane",
      },
    ).addTo(map);

    const bathyBase = L.tileLayer(BATHY_BASE_TILE, {
      attribution: "&copy; Esri",
      opacity: 0.75,
      pane: "bathyBasePane",
      maxNativeZoom: 10,
      maxZoom: 14,
    });
    bathyBaseRef.current = bathyBase;
    bathyBase.addTo(map);

    SST_HISTORY_OFFSETS.forEach((offset, idx) => {
      const layer = L.tileLayer(gibsSSTTileUrl(offset), {
        attribution: "&copy; NASA GIBS",
        opacity: 0.45,
        pane: "sstPane",
        maxNativeZoom: 7,
        maxZoom: 14,
        tileSize: 256,
      });
      sstLayersRef.current[idx] = layer;
      if (idx === 0) layer.addTo(map);
    });

    const bathyOverlay = L.tileLayer(BATHY_OVERLAY_TILE, {
      attribution: "&copy; Esri",
      opacity: 0.9,
      pane: "bathyOverlayPane",
      maxNativeZoom: 10,
      maxZoom: 14,
    });
    bathyOverlayRef.current = bathyOverlay;
    bathyOverlay.addTo(map);

    CANYONS.forEach((c) => {
      L.marker([c.lat, c.lng], {
        pane: "labelPane",
        interactive: false,
        icon: L.divIcon({
          className: "",
          html: `<div style="background:rgba(255,255,255,0.88);color:#000000;border:1px solid rgba(0,0,0,0.25);border-radius:5px;padding:2px 7px;font-size:11px;font-weight:600;white-space:nowrap">${c.name}</div>`,
          iconAnchor: [40, 10],
        }),
      }).addTo(map);
    });

    HOTSPOTS.forEach((h) => {
      const color = confidenceColor(h.confidence);
      const td = toLoranTD(h.lat, h.lng);

      const circle = L.circleMarker([h.lat, h.lng], {
        pane: "labelPane",
        radius: 13,
        color,
        fillColor: color,
        fillOpacity: 0.35,
        weight: 2,
      });

      const labelMarker = L.marker([h.lat, h.lng], {
        pane: "labelPane",
        interactive: false,
        icon: L.divIcon({
          className: "",
          html: `<div style="background:rgba(15,23,42,0.85);color:${color};border:1px solid ${color};border-radius:6px;padding:2px 7px;font-size:11px;white-space:nowrap;pointer-events:none">${h.title}</div>`,
          iconAnchor: [60, -12],
        }),
      });

      circle.bindPopup(
        `<div style="color:#cbd5e1;font-size:12px;min-width:170px">
          <div style="color:${color};font-weight:600;margin-bottom:4px">${h.title}</div>
          <div style="margin-bottom:2px">🌡 ${h.sstTemp}°F &nbsp;🔥 +${h.breakDelta}°F break</div>
          <div style="color:#a78bfa;font-size:11px;margin-bottom:4px">📡 LORAN W ${td.w} / X ${td.x} μs</div>
          <div>${h.species.map((s) => `<span style="background:rgba(6,182,212,0.2);color:#67e8f9;border-radius:999px;padding:1px 7px;font-size:10px;margin-right:3px">${s}</span>`).join("")}</div>
          <div style="color:#64748b;font-size:10px;margin-top:4px">Confidence: ${h.confidence}%</div>
        </div>`,
        { className: "fishing-map-popup" },
      );

      circle.addTo(map);
      labelMarker.addTo(map);

      (circle as any)._labelMarker = labelMarker;
    });

    map.on("click", async (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      const td = toLoranTD(lat, lng);
      const wpId = Math.random().toString(36).slice(2, 9);

      const popup = L.popup({ className: "fishing-map-popup" })
        .setLatLng(e.latlng)
        .setContent(renderPopup(lat, lng, td, "fetching…", wpId))
        .openOn(map);

      const wireSave = () => {
        const btn = document.getElementById(`wp-save-${wpId}`);
        if (!btn) return;
        btn.addEventListener("click", async () => {
          const input = document.getElementById(
            `wp-name-${wpId}`,
          ) as HTMLInputElement | null;
          const name =
            input?.value.trim() ||
            `Waypoint ${waypointsRef.current.length + 1}`;
          await addWaypoint(name, lat, lng, td.w, td.x);
          popup.close();
        });
      };
      popup.on("add", wireSave);

      const result = await getSSTCached(lat, lng);
      if (!map.hasLayer(popup)) return;

      const sstText = result.ok
        ? `${result.fahrenheit.toFixed(1)}°F (${result.celsius.toFixed(1)}°C)`
        : sstFallbackLabel(result.reason);
      popup.setContent(renderPopup(lat, lng, td, sstText, wpId));
      wireSave();
    });

    mapRef.current = map;

    return () => {
      if (animIntervalRef.current) clearInterval(animIntervalRef.current);
      map.remove();
      mapRef.current = null;
      sstLayersRef.current = [null, null, null, null];
      bathyBaseRef.current = null;
      bathyOverlayRef.current = null;
    };
  }, [addWaypoint]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    sstLayersRef.current.forEach((layer, idx) => {
      if (!layer) return;
      if (showSST && idx === sstOffset) layer.addTo(map);
      else layer.remove();
    });
  }, [showSST]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !showSST) return;
    sstLayersRef.current.forEach((layer, idx) => {
      if (!layer) return;
      if (idx === sstOffset) layer.addTo(map);
      else layer.remove();
    });
  }, [sstOffset, showSST]);

  // Start/stop the animation loop using setInterval held in a ref.
  // This is intentionally NOT cleaned up by React — the interval lives as long as
  // isAnimating is true, and is only cleared when the user stops or unmounts.
  useEffect(() => {
    if (isAnimating) {
      if (animIntervalRef.current) clearInterval(animIntervalRef.current);
      animIntervalRef.current = setInterval(() => {
        setSstOffset((prev) => (prev + 1) % SST_HISTORY_OFFSETS.length);
      }, 1200);
    } else {
      if (animIntervalRef.current) {
        clearInterval(animIntervalRef.current);
        animIntervalRef.current = null;
      }
    }
    return () => {
      if (animIntervalRef.current) {
        clearInterval(animIntervalRef.current);
        animIntervalRef.current = null;
      }
    };
  }, [isAnimating]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const base = bathyBaseRef.current;
    const overlay = bathyOverlayRef.current;
    if (!base || !overlay) return;
    if (showBathy) {
      base.addTo(map);
      overlay.addTo(map);
    } else {
      base.remove();
      overlay.remove();
    }
  }, [showBathy]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.eachLayer((layer) => {
      if (layer instanceof L.CircleMarker) {
        const lm = (layer as any)._labelMarker as L.Marker | undefined;
        if (showHotspots) {
          if (!map.hasLayer(layer)) layer.addTo(map);
          if (lm && !map.hasLayer(lm)) lm.addTo(map);
        } else {
          if (map.hasLayer(layer)) layer.remove();
          if (lm && map.hasLayer(lm)) lm.remove();
        }
      }
    });
  }, [showHotspots]);

  return (
    <div className="h-[calc(100vh-8rem)] relative">
      <div ref={containerRef} className="absolute inset-0" />

      {showWaypoints && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1200] w-[min(340px,calc(100vw-24px))] bg-slate-900/97 border border-cyan-700 rounded-xl shadow-2xl flex flex-col max-h-[70vh]">
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700">
            <span className="text-sm font-bold text-cyan-400 flex items-center gap-1.5">
              <BookmarkCheck className="w-4 h-4" /> Saved Waypoints (
              {waypoints.length})
            </span>
            <button
              onClick={() => setShowWaypoints(false)}
              className="text-slate-400 hover:text-white p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="overflow-y-auto flex-1">
            {waypoints.length === 0 ? (
              <div className="text-slate-500 text-xs text-center py-8 px-4">
                No waypoints saved yet.
                <br />
                Tap anywhere on the map to add one.
              </div>
            ) : (
              waypoints.map((wp) => (
                <div
                  key={wp.id}
                  className="flex items-start gap-2 px-3 py-2.5 border-b border-slate-800 last:border-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white truncate">
                      {wp.name}
                    </div>
                    <div className="text-xs text-cyan-400">
                      {wp.lat.toFixed(4)}°N, {Math.abs(wp.lng).toFixed(4)}°W
                    </div>
                    <div className="text-xs text-slate-400">
                      📡 LORAN W {wp.tdW} / X {wp.tdX} μs
                    </div>
                    <div className="text-[10px] text-slate-600 mt-0.5">
                      {new Date(wp.savedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      onClick={() => {
                        mapRef.current?.flyTo([wp.lat, wp.lng], 10, {
                          duration: 1.2,
                        });
                        setShowWaypoints(false);
                      }}
                      className="text-[10px] bg-slate-700 hover:bg-slate-600 text-slate-300 rounded px-2 py-1"
                    >
                      Go
                    </button>
                    <button
                      onClick={() => deleteWaypoint(wp.id)}
                      disabled={wpMutating}
                      className="text-red-400 hover:text-red-300 p-1 disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-[1000] bg-slate-900/95 border border-slate-600 rounded-xl px-3 py-2 flex flex-col items-center gap-1.5 w-[min(290px,calc(100vw-80px))]">
        <div className="flex items-center gap-2 w-full">
          <Clock className="w-4 h-4 text-cyan-400 shrink-0" />
          <span className="text-xs text-slate-300 font-semibold flex-1">
            SST History
          </span>
          <button
            onClick={() => {
              setIsAnimating((a) => !a);
              if (!showSST) setShowSST(true);
            }}
            className={`text-xs px-2.5 py-1 rounded border transition-all min-w-[52px] ${isAnimating ? "bg-cyan-500 border-cyan-400 text-white" : "bg-slate-700 border-slate-500 text-slate-300"}`}
          >
            {isAnimating ? "⏹ Stop" : "▶ Play"}
          </button>
        </div>
        <div className="grid grid-cols-4 gap-1 w-full">
          {SST_HISTORY_OFFSETS.map((offset) => (
            <button
              key={offset}
              onClick={() => {
                setSstOffset(offset);
                setIsAnimating(false);
                if (!showSST) setShowSST(true);
              }}
              className={`py-1.5 rounded text-[10px] font-semibold border transition-all text-center leading-tight ${
                sstOffset === offset
                  ? "bg-orange-500 border-orange-400 text-white"
                  : "bg-slate-800 border-slate-600 text-slate-400"
              }`}
            >
              {gibsSSTLabel(offset)}
            </button>
          ))}
        </div>
        <div className="text-[10px] text-slate-500 self-start">
          {gibsSSTDate(3 + sstOffset)} · MUR 1km
        </div>
      </div>

      <div className="absolute top-3 right-3 z-[1100] flex flex-col gap-2">
        <button
          onClick={() => setShowSST(!showSST)}
          className={`p-2 rounded-lg border transition-all ${showSST ? "bg-orange-500 border-orange-400 text-white" : "bg-slate-800/90 border-slate-600 text-slate-300"}`}
          title="Toggle SST overlay"
        >
          <Thermometer className="w-5 h-5" />
        </button>
        <button
          onClick={() => setShowBathy(!showBathy)}
          className={`p-2 rounded-lg border transition-all ${showBathy ? "bg-blue-500 border-blue-400 text-white" : "bg-slate-800/90 border-slate-600 text-slate-300"}`}
          title="Toggle bathymetry"
        >
          <Layers className="w-5 h-5" />
        </button>
        <button
          onClick={() => setShowHotspots(!showHotspots)}
          className={`p-2 rounded-lg border transition-all ${showHotspots ? "bg-emerald-600 border-emerald-500 text-white" : "bg-slate-800/90 border-slate-600 text-slate-300"}`}
          title="Toggle hotspots"
        >
          <Target className="w-5 h-5" />
        </button>
        <button
          onClick={() => mapRef.current?.locate({ setView: true, maxZoom: 10 })}
          className="p-2 rounded-lg bg-slate-800/90 border border-slate-600 text-slate-300 hover:bg-slate-700 transition-all"
          title="Go to my location"
        >
          <Navigation className="w-5 h-5" />
        </button>
        <button
          onClick={() => setShowWaypoints((v) => !v)}
          className={`p-2 rounded-lg border transition-all relative ${showWaypoints ? "bg-cyan-600 border-cyan-500 text-white" : "bg-slate-800/90 border-slate-600 text-slate-300 hover:bg-slate-700"}`}
          title="Saved waypoints"
        >
          <Bookmark className="w-5 h-5" />
          {waypoints.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-cyan-500 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
              {waypoints.length > 9 ? "9+" : waypoints.length}
            </span>
          )}
        </button>
      </div>

      <div className="absolute top-3 left-3 z-[1000] bg-slate-800/90 rounded-lg p-2 border border-slate-700 space-y-1">
        <div className="text-xs font-semibold text-slate-300 mb-1">
          Hotspots
        </div>
        {[
          { label: "High ≥80%", color: "#34d399" },
          { label: "Med 65–79%", color: "#fbbf24" },
          { label: "Low <65%", color: "#f87171" },
        ].map(({ label, color }) => (
          <div key={label} className="flex items-center gap-2">
            <span
              className="inline-block w-3 h-3 rounded-full border-2"
              style={{ borderColor: color, background: color + "55" }}
            />
            <span className="text-xs text-slate-400">{label}</span>
          </div>
        ))}
      </div>

      <div className="absolute bottom-3 left-3 z-[1000] bg-slate-800/90 rounded-lg p-2 border border-slate-700">
        <div className="text-xs text-slate-400 mb-1">
          SST — tap map for temp
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-blue-400">60°F</span>
          <div className="w-24 h-2 rounded bg-gradient-to-r from-blue-500 via-yellow-400 to-red-500" />
          <span className="text-xs text-red-400">85°F</span>
        </div>
        <div className="text-xs text-slate-500 mt-1">
          GIBS visual · ERDDAP point · {gibsSSTLabel(sstOffset)} · {SST_DATE}
        </div>
      </div>
    </div>
  );
}
