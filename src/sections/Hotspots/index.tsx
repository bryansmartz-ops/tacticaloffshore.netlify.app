import { useEffect, useRef, useState } from "react";
import {
  Target,
  Flame,
  ThermometerSun,
  MapPin,
  Navigation,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react";
import L from "leaflet";
import {
  getSSTBBoxCached,
  getCacheAge,
  formatSST,
  gibsSSTDate,
  type SSTResult,
  type BBoxQuery,
} from "../../lib/erddap";

interface Hotspot {
  id: string;
  title: string;
  /** fallback SST (°F) used when ERDDAP returns no data */
  fallbackSstF: number;
  lat: number;
  lng: number;
  /** lat/lng of a nearby "ambient" shelf point used to compute breakDelta */
  ambientLat: number;
  ambientLng: number;
  /** bounding-box half-width in degrees; default 0.12 (~13 km) for canyon-scale queries */
  bboxPad?: number;
}

/** Build a BBoxQuery centred on a lat/lng with the hotspot's pad */
function hotspotBBox(lat: number, lng: number, pad: number): BBoxQuery {
  return {
    minLat: lat - pad,
    maxLat: lat + pad,
    minLng: lng - pad,
    maxLng: lng + pad,
  };
}

/** Static geographic definitions — no scores, no species here */
const HOTSPOT_DEFS: Hotspot[] = [
  {
    id: "1",
    title: "Washington Canyon Break",
    fallbackSstF: 76,
    lat: 37.55,
    lng: -74.35,
    ambientLat: 37.55,
    ambientLng: -73.6,
    bboxPad: 0.15,
  },
  {
    id: "2",
    title: "Norfolk Canyon Edge",
    fallbackSstF: 74,
    lat: 37.05,
    lng: -74.65,
    ambientLat: 37.05,
    ambientLng: -73.9,
    bboxPad: 0.15,
  },
  {
    id: "3",
    title: "Baltimore Canyon Warm Pocket",
    fallbackSstF: 78,
    lat: 38.22,
    lng: -73.82,
    ambientLat: 38.22,
    ambientLng: -73.1,
    bboxPad: 0.15,
  },
  {
    id: "4",
    title: "Hudson Canyon Rip",
    fallbackSstF: 72,
    lat: 39.52,
    lng: -72.05,
    ambientLat: 39.52,
    ambientLng: -71.3,
    bboxPad: 0.15,
  },
  {
    id: "5",
    title: "Wilmington Canyon Ledge",
    fallbackSstF: 73,
    lat: 38.52,
    lng: -73.42,
    ambientLat: 38.52,
    ambientLng: -72.7,
    bboxPad: 0.15,
  },
];

// ---------------------------------------------------------------------------
// Live scoring helpers
// ---------------------------------------------------------------------------

/** Derive likely species from SST in °F */
function speciesFromSST(tempF: number): string[] {
  const list: string[] = [];
  if (tempF >= 60 && tempF <= 68) list.push("Bluefin Tuna");
  if (tempF >= 65 && tempF <= 75) list.push("Bigeye Tuna");
  if (tempF >= 70 && tempF <= 80) list.push("Yellowfin Tuna");
  if (tempF >= 70) list.push("White Marlin");
  if (tempF >= 74) list.push("Wahoo");
  if (tempF >= 78) list.push("Mahi Mahi");
  if (tempF < 65) list.push("Swordfish");
  // cap at 3 species
  return list.slice(0, 3);
}

/**
 * Compute confidence % from live SST (°F) and breakDelta (°F).
 * Formula:
 *   base 50
 *   + up to 25 pts for warm SST (peak at 76-78 °F for mid-Atlantic summer run)
 *   + up to 25 pts for strong thermal break (ΔT ≥ 4°F = full bonus)
 * Result clamped 40–95.
 */
function computeConfidence(tempF: number, breakDelta: number): number {
  const sstScore = Math.max(0, Math.min(25, ((tempF - 65) / 15) * 25));
  const breakScore = Math.max(0, Math.min(25, (breakDelta / 4) * 25));
  return Math.round(Math.min(95, Math.max(40, 50 + sstScore + breakScore)));
}

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

function confidenceColor(c: number) {
  if (c >= 80) return "#34d399";
  if (c >= 65) return "#fbbf24";
  return "#f87171";
}

// Per-hotspot computed prediction state
interface HotspotPrediction {
  sstResult: SSTResult | null;
  ambientResult: SSTResult | null;
  loading: boolean;
  /** computed from live data; falls back to static when ERDDAP fails */
  confidence: number;
  breakDelta: number;
  species: string[];
}

type HotspotPredictions = Record<string, HotspotPrediction>;

function staticPrediction(h: Hotspot): HotspotPrediction {
  // Fallback values derived from the static SST so UI is never empty
  const breakDelta = parseFloat(((h.fallbackSstF - 68) * 0.18).toFixed(1));
  return {
    sstResult: null,
    ambientResult: null,
    loading: false,
    confidence: computeConfidence(h.fallbackSstF, breakDelta),
    breakDelta: Math.max(0, breakDelta),
    species: speciesFromSST(h.fallbackSstF),
  };
}

export default function Hotspots() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.CircleMarker[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(true);
  const initAttemptedRef = useRef(false);
  const [predictions, setPredictions] = useState<HotspotPredictions>(() =>
    Object.fromEntries(
      HOTSPOT_DEFS.map((h) => [
        h.id,
        { ...staticPrediction(h), loading: true },
      ]),
    ),
  );
  const [sstDate] = useState(gibsSSTDate);
  const [cacheAge, setCacheAge] = useState<number | null>(getCacheAge);

  // Initialize map once, after a short delay so the flex layout has resolved
  useEffect(() => {
    if (initAttemptedRef.current) return;
    initAttemptedRef.current = true;

    const timerId = setTimeout(() => {
      const container = mapContainerRef.current;
      if (!container || mapRef.current) return;

      const map = L.map(container, {
        center: [38.2, -73.5],
        zoom: 7,
        zoomControl: false,
      });

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        { attribution: "&copy; CartoDB" },
      ).addTo(map);

      const tileSSTDate = (() => {
        const d = new Date();
        d.setDate(d.getDate() - 3);
        return d.toISOString().slice(0, 10);
      })();

      L.tileLayer(
        `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GHRSST_L4_MUR_Sea_Surface_Temperature/default/${tileSSTDate}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`,
        {
          attribution: "&copy; NASA GIBS",
          opacity: 0.65,
          maxNativeZoom: 7,
          maxZoom: 14,
          tileSize: 256,
        },
      ).addTo(map);

      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}",
        {
          attribution: "&copy; Esri",
          opacity: 0.7,
          maxNativeZoom: 10,
          maxZoom: 14,
        },
      ).addTo(map);

      HOTSPOT_DEFS.forEach((h) => {
        const fallbackConf = computeConfidence(h.fallbackSstF, 2.0);
        const color = confidenceColor(fallbackConf);
        const td = toLoranTD(h.lat, h.lng);
        const marker = L.circleMarker([h.lat, h.lng], {
          radius: 12,
          color,
          fillColor: color,
          fillOpacity: 0.35,
          weight: 2,
        });

        L.marker([h.lat, h.lng], {
          icon: L.divIcon({
            className: "",
            html: `<div style="background:rgba(15,23,42,0.85);color:${color};border:1px solid ${color};border-radius:6px;padding:2px 6px;font-size:11px;white-space:nowrap;pointer-events:none">${h.title}</div>`,
            iconAnchor: [60, -10],
          }),
          interactive: false,
        }).addTo(map);

        marker.on("click", () => {
          setSelectedId((prev) => (prev === h.id ? null : h.id));
          map.panTo([h.lat, h.lng]);
        });

        marker.bindPopup(
          `<div style="color:#cbd5e1;font-size:12px;min-width:160px">
            <div style="color:${color};font-weight:600;margin-bottom:4px">${h.title}</div>
            <div>🌡 ${h.fallbackSstF}°F (static fallback)</div>
            <div style="color:#a78bfa;font-size:11px;margin-top:4px">📡 LORAN W ${td.w} / X ${td.x} μs</div>
          </div>`,
          { className: "fishing-map-popup" },
        );

        marker.addTo(map);
        markersRef.current.push(marker);
      });

      mapRef.current = map;
      map.invalidateSize();
    }, 150);

    return () => {
      clearTimeout(timerId);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markersRef.current = [];
      }
    };
  }, []);

  // When showMap toggles back on, wait for the CSS transition then fix tile layout
  useEffect(() => {
    if (!showMap || !mapRef.current) return;
    const t = setTimeout(() => {
      mapRef.current?.invalidateSize();
    }, 320);
    return () => clearTimeout(t);
  }, [showMap]);

  // Prefetch / serve-from-cache all hotspot SSTs on mount
  useEffect(() => {
    loadSSTs(false);
  }, []);

  function loadSSTs(forceRefresh: boolean) {
    if (forceRefresh) {
      try {
        localStorage.removeItem("sst_cache_v1");
        localStorage.removeItem("sst_cache_v2");
      } catch {
        /* ignore */
      }
    }

    // Mark all as loading
    setPredictions((prev) =>
      Object.fromEntries(
        HOTSPOT_DEFS.map((h) => [h.id, { ...prev[h.id], loading: true }]),
      ),
    );

    // Fire bbox queries for all hotspot + ambient boxes in parallel
    HOTSPOT_DEFS.forEach((h) => {
      const pad = h.bboxPad ?? 0.12;
      const hotBBox = hotspotBBox(h.lat, h.lng, pad);
      // Ambient box uses same pad but centred on the shelf point
      const ambBBox = hotspotBBox(h.ambientLat, h.ambientLng, pad);

      Promise.all([
        getSSTBBoxCached(hotBBox, true),
        getSSTBBoxCached(ambBBox, false),
      ]).then(([hotResult, ambResult]) => {
        setCacheAge(getCacheAge());
        const hotF = hotResult.ok ? hotResult.fahrenheit : h.fallbackSstF;
        const ambF = ambResult.ok ? ambResult.fahrenheit : hotF - 2.0;
        const breakDelta = parseFloat(Math.max(0, hotF - ambF).toFixed(1));
        const confidence = computeConfidence(hotF, breakDelta);
        const species = speciesFromSST(hotF);

        setPredictions((prev) => ({
          ...prev,
          [h.id]: {
            sstResult: hotResult,
            ambientResult: ambResult,
            loading: false,
            confidence,
            breakDelta,
            species,
          },
        }));
      });
    });
  }

  // Re-fetch on demand (bypass cache)
  function refreshSST() {
    loadSSTs(true);
  }

  useEffect(() => {
    if (!selectedId || !mapRef.current) return;
    const h = HOTSPOT_DEFS.find((x) => x.id === selectedId);
    if (h) mapRef.current.panTo([h.lat, h.lng]);
  }, [selectedId]);

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] overflow-hidden">
      <div
        className={`relative transition-all duration-300 flex-shrink-0 ${showMap ? "h-[45%]" : "h-0 overflow-hidden"}`}
      >
        <div ref={mapContainerRef} className="absolute inset-0 z-0" />

        <button
          onClick={() => setShowMap((v) => !v)}
          className="absolute bottom-2 right-2 z-[1000] bg-slate-800/90 border border-slate-600 text-slate-300 text-xs px-2 py-1 rounded-lg flex items-center gap-1"
        >
          {showMap ? (
            <ChevronUp className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
          {showMap ? "Hide map" : "Show map"}
        </button>

        <div className="absolute bottom-2 left-2 z-[1000] bg-slate-800/80 rounded px-2 py-1 border border-slate-700">
          <div className="flex items-center gap-1">
            <span className="text-xs text-blue-400">60°F</span>
            <div className="w-16 h-1.5 rounded bg-gradient-to-r from-blue-500 via-yellow-400 to-red-500" />
            <span className="text-xs text-red-400">85°F</span>
          </div>
        </div>
      </div>

      {!showMap && (
        <button
          onClick={() => setShowMap(true)}
          className="mx-4 mt-2 bg-slate-800 border border-slate-600 text-slate-300 text-xs px-3 py-2 rounded-lg flex items-center justify-center gap-1"
        >
          <ChevronDown className="w-3 h-3" /> Show map
        </button>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Target className="w-5 h-5 text-orange-400" /> AI Hotspots
          </h2>
          <button
            onClick={refreshSST}
            className="flex items-center gap-1.5 text-xs text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 px-2.5 py-1 rounded-lg transition-all"
            title="Refresh live SST from ERDDAP"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh SST
          </button>
          {cacheAge !== null && (
            <span className="text-xs text-slate-500">
              Updated {cacheAge === 0 ? "just now" : `${cacheAge} min ago`}
            </span>
          )}
        </div>

        <p className="text-xs text-slate-500">
          SST from NOAA CoastWatch ERDDAP · ACSPO L3S 0.02° / MUR NRT 0.01° ·
          GIBS {sstDate} · Cached hourly · Tap card to pan map
        </p>

        {HOTSPOT_DEFS.map((h) => {
          const td = toLoranTD(h.lat, h.lng);
          const isSelected = selectedId === h.id;
          const pred = predictions[h.id];
          const isLoading = pred?.loading ?? true;
          const confidence = pred?.confidence ?? 50;
          const breakDelta = pred?.breakDelta ?? 0;
          const species = pred?.species ?? [];
          const sstResult = pred?.sstResult ?? null;

          return (
            <div
              key={h.id}
              onClick={() => setSelectedId(isSelected ? null : h.id)}
              className={`bg-slate-800 rounded-xl p-4 border transition-all cursor-pointer space-y-2 ${
                isSelected
                  ? "border-emerald-500/60 shadow-lg shadow-emerald-900/20"
                  : "border-slate-700"
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-white">{h.title}</h3>
                  <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3 h-3" />
                    {h.lat.toFixed(2)}°N, {Math.abs(h.lng).toFixed(2)}°W
                  </div>
                </div>
                <div className="text-right">
                  {isLoading ? (
                    <div className="flex items-center gap-1 text-slate-400 justify-end">
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span className="text-xs">scoring…</span>
                    </div>
                  ) : (
                    <>
                      <div
                        className="text-lg font-bold"
                        style={{ color: confidenceColor(confidence) }}
                      >
                        {confidence}%
                      </div>
                      <div className="text-xs text-slate-500">confidence</div>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-4 text-sm flex-wrap">
                <div className="flex items-center gap-1">
                  {isLoading ? (
                    <span className="flex items-center gap-1 text-slate-400">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span className="text-xs">fetching SST…</span>
                    </span>
                  ) : (
                    <>
                      <ThermometerSun className="w-4 h-4 text-orange-400" />
                      {(() => {
                        const { text, live } = sstResult
                          ? formatSST(sstResult, h.fallbackSstF)
                          : { text: `${h.fallbackSstF}°F`, live: false };
                        return (
                          <span
                            className={
                              live ? "text-orange-400" : "text-slate-400"
                            }
                          >
                            {text}
                            {live && (
                              <span className="ml-1 text-[9px] text-cyan-400 font-medium uppercase tracking-wide">
                                live
                              </span>
                            )}
                          </span>
                        );
                      })()}
                    </>
                  )}
                </div>
                {!isLoading && (
                  <div className="flex items-center gap-1 text-amber-400">
                    <Flame className="w-4 h-4" />
                    {breakDelta > 0
                      ? `+${breakDelta}°F break`
                      : "no break detected"}
                  </div>
                )}
              </div>

              {/* Dataset + resolution + pixel-count badge */}
              {!isLoading && sstResult?.ok && (
                <div className="flex items-center gap-2 flex-wrap mt-0.5">
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${sstResult.resolution === "0.02deg" ? "bg-violet-500/15 border-violet-500/40 text-violet-300" : "bg-sky-500/15 border-sky-500/40 text-sky-300"}`}
                  >
                    {sstResult.resolution === "0.02deg"
                      ? "ACSPO L3S 0.02°"
                      : "MUR NRT 0.01°"}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {sstResult.pixelCount} px avg
                  </span>
                  {sstResult.resolution === "0.02deg" && (
                    <span className="text-[10px] text-slate-500">≈2 km/px</span>
                  )}
                  {sstResult.resolution === "0.01deg" && (
                    <span className="text-[10px] text-slate-500">≈1 km/px</span>
                  )}
                </div>
              )}
              {!isLoading && sstResult && !sstResult.ok && (
                <div className="text-[10px] text-slate-500 mt-0.5">
                  ERDDAP unavailable — showing static fallback
                </div>
              )}

              {!isLoading && (
                <div className="text-xs text-purple-400 flex items-center gap-1">
                  <Navigation className="w-3 h-3" />
                  LORAN W {td.w} / X {td.x} μs
                </div>
              )}

              {!isLoading && species.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {species.map((s) => (
                    <span
                      key={s}
                      className="text-xs bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded-full"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
