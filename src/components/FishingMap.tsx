/**
 * FishingMap — shared Leaflet map component.
 *
 * Used by both TacticalMap (mode="full", fullscreen) and
 * Hotspots (mode="preview", partial-screen).
 *
 * Key design decisions:
 *  1. Owns all live SST fetching for hotspot markers — fetches ERDDAP on mount
 *     and whenever `hotspotDefs` changes. Parent passes HOTSPOT_DEFS; this
 *     component resolves live temps and updates markers in-place.
 *  2. Click-to-SST-query: popup opened SYNCHRONOUSLY with "fetching…" FIRST,
 *     then setContent() after the async getSSTBBoxCached resolves — fixes race.
 *  3. hotspotPane zIndex 700 + pointerEvents auto; bubblingMouseEvents:false on
 *     every circle so hotspot clicks never reach the map-level click handler.
 *  4. Canyon labels in labelPane (zIndex 620, pointerEvents none).
 */

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

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

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
  /** True when ERDDAP returned no valid pixel and fallbackSstF was used instead. */
  isFallbackSst: boolean;
  /** True when this hotspot was detected dynamically (offshore break, not a fixed canyon). */
  isDynamic?: boolean;
  /** Name of the anchor canyon this dynamic hotspot was detected relative to. */
  anchorTitle?: string;
  /**
   * Pre-computed distance + bearing label: "14NM SE of Hudson" for fixed hotspots,
   * already baked into `title` for dynamic hotspots (so this mirrors title leading segment).
   * Used by buildLabelIcon and the Hotspots card list as the leading display segment.
   */
  distanceLabel?: string;
}

export interface FishingMapProps {
  /** "full" = fullscreen TacticalMap view; "preview" = partial-screen Hotspots view */
  mode: "full" | "preview";
  /** Raw hotspot definitions — component fetches live SSTs and builds display data */
  hotspotDefs: HotspotDef[];
  /** Called when a hotspot circle is clicked — receives the hotspot id */
  onHotspotClick?: (id: string) => void;
  /** Called with live-resolved HotspotDisplay[] after SSTs arrive — lets parent sync card list */
  onHotspotsResolved?: (hotspots: HotspotDisplay[]) => void;
  /** Whether to show the hotspot markers and labels */
  showHotspots?: boolean;
  /** Whether to show the SST tile overlay */
  showSST?: boolean;
  /** Which SST day offset (0=today … 3=-3 days) */
  sstOffset?: number;
  /** Whether to show bathymetry layers */
  showBathy?: boolean;
  /** Callback fired after user map-click SST resolves */
  onMapClick?: (info: MapClickInfo) => void;
  /** Waypoint save handler — called when user fills in name + taps Save in popup */
  onSaveWaypoint?: (
    name: string,
    lat: number,
    lng: number,
    tdW: string,
    tdX: string,
  ) => Promise<void>;
  /** Waypoint count — shown as badge on the map if > 0 */
  waypointCount?: number;
  /** If provided, the map flies to this position whenever it changes */
  flyTo?: { lat: number; lng: number; zoom?: number };
  /** className applied to the root div */
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

// ---------------------------------------------------------------------------
// Bearing / cardinal helpers — used for dynamic break labels
// ---------------------------------------------------------------------------

function bearingDeg(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const dLng = ((toLng - fromLng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos((toLat * Math.PI) / 180);
  const x =
    Math.cos((fromLat * Math.PI) / 180) * Math.sin((toLat * Math.PI) / 180) -
    Math.sin((fromLat * Math.PI) / 180) *
      Math.cos((toLat * Math.PI) / 180) *
      Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function toCardinal(deg: number): string {
  const dirs = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ];
  return dirs[Math.round(deg / 22.5) % 16];
}

/** Move a lat/lng point by distNM nautical miles on a given bearing (degrees). */
function offsetPoint(
  lat: number,
  lng: number,
  distNM: number,
  brngDeg: number,
): { lat: number; lng: number } {
  const R = 3440.065;
  const d = distNM / R;
  const brng = (brngDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) +
      Math.cos(lat1) * Math.sin(d) * Math.cos(brng),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

// ---------------------------------------------------------------------------
// Canyon label positions
// ---------------------------------------------------------------------------

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

const BATHY_BASE_TILE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}";
const BATHY_OVERLAY_TILE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}";

// ---------------------------------------------------------------------------
// Popup HTML builders
// ---------------------------------------------------------------------------

function rankBadge(id: string, hotspots: HotspotDisplay[]): string {
  const sorted = [...hotspots].sort((a, b) => b.confidence - a.confidence);
  const rank = sorted.findIndex((h) => h.id === id);
  if (rank === 0)
    return `<span style="background:#16a34a;color:#fff;font-size:9px;font-weight:700;border-radius:4px;padding:1px 5px;letter-spacing:0.05em;vertical-align:middle">PRIMARY</span>`;
  if (rank === 1)
    return `<span style="background:#1d4ed8;color:#fff;font-size:9px;font-weight:700;border-radius:4px;padding:1px 5px;letter-spacing:0.05em;vertical-align:middle">SECONDARY</span>`;
  return "";
}

function sstFallbackLabel(reason: "timeout" | "land" | "error"): string {
  if (reason === "timeout") return "timed out";
  if (reason === "land") return "land / no data";
  return "unavailable";
}

function buildClickPopupHtml(
  lat: number,
  lng: number,
  td: { w: string; x: string },
  sstText: string,
  wpId: string,
  meta?: string,
): string {
  return `<div style="color:#cbd5e1;font-size:12px;min-width:190px">
    <div style="color:#67e8f9;font-weight:600;margin-bottom:4px">${lat.toFixed(4)}°N, ${Math.abs(lng).toFixed(4)}°W</div>
    <div style="color:#fb923c;margin-bottom:2px">🌡 SST: ${sstText}</div>
    ${meta ? `<div style="color:#64748b;font-size:10px;margin-bottom:4px">${meta}</div>` : ""}
    <div style="color:#94a3b8;font-size:11px;margin-bottom:6px">📡 LORAN W ${td.w} / X ${td.x} μs</div>
    <input id="wp-name-${wpId}" placeholder="Waypoint name…" style="width:100%;background:#1e293b;border:1px solid #475569;border-radius:5px;color:#e2e8f0;font-size:11px;padding:4px 7px;outline:none;box-sizing:border-box" />
    <button id="wp-save-${wpId}" style="margin-top:5px;width:100%;background:#0891b2;border:none;border-radius:5px;color:#fff;font-size:11px;font-weight:600;padding:5px 0;cursor:pointer">💾 Save Waypoint</button>
  </div>`;
}

function buildHotspotPopupHtml(
  h: HotspotDisplay,
  allHotspots: HotspotDisplay[],
  isLoading = false,
): string {
  const color = confidenceColor(h.confidence);
  const td = toLoranTD(h.lat, h.lng);
  const badge = rankBadge(h.id, allHotspots);
  const confColor = confidenceColor(h.confidence);
  const breakVal =
    h.breakDelta > 0
      ? `🔥 +${h.breakDelta}°F break`
      : `<span style="color:#94a3b8">no break detected</span>`;
  const speciesTags = h.species
    .map(
      (s) =>
        `<span style="background:rgba(6,182,212,0.2);color:#67e8f9;border-radius:999px;padding:1px 7px;font-size:10px;margin-right:3px">${s}</span>`,
    )
    .join("");
  const sig = h.signals;
  const signalRows = [
    { label: "SST proximity", val: sig.sstScore, max: 20, color: "#fb923c" },
    {
      label: "Break sharpness",
      val: sig.sstBreakScore,
      max: 35,
      color: "#fbbf24",
    },
    { label: "Chlorophyll", val: sig.chloroScore, max: 20, color: "#4ade80" },
    {
      label: "Altimetry/SSH",
      val: sig.altimetryScore,
      max: 15,
      color: "#818cf8",
    },
    {
      label: "History/Reports",
      val: sig.historyReportsScore,
      max: 10,
      color: "#67e8f9",
    },
  ]
    .map(
      (r) =>
        `<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px">
          <span style="font-size:9px;color:#94a3b8;width:88px;flex-shrink:0">${r.label}</span>
          <div style="flex:1;background:#1e293b;border-radius:3px;height:5px;overflow:hidden">
            <div style="background:${r.color};width:${Math.round((r.val / r.max) * 100)}%;height:100%;border-radius:3px"></div>
          </div>
          <span style="font-size:9px;color:${r.color};width:24px;text-align:right;flex-shrink:0">${r.val}/${r.max}</span>
        </div>`,
    )
    .join("");

  const sstLine = isLoading
    ? `<div style="color:#94a3b8;font-size:11px;margin-bottom:5px">🌡 fetching live SST…</div>`
    : `<div style="margin-bottom:5px">🌡 <strong style="color:#fb923c">${h.sstTemp.toFixed(1)}°F</strong> &nbsp;&nbsp;${breakVal}</div>`;

  return `<div style="color:#cbd5e1;font-size:12px;min-width:210px">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;flex-wrap:wrap">
      <span style="color:${color};font-weight:700;font-size:13px">${h.title}</span>
      ${badge}
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
      <span style="color:${confColor};font-size:18px;font-weight:800;line-height:1">${h.confidence}%</span>
      <span style="color:#94a3b8;font-size:10px">confidence${isLoading ? " (pending)" : " (live)"}</span>
    </div>
    ${sstLine}
    <div style="margin-bottom:4px">${signalRows}</div>
    <div style="color:#a78bfa;font-size:11px;margin-bottom:5px">📡 LORAN W ${td.w} / X ${td.x} μs</div>
    <div style="margin-bottom:4px">${speciesTags}</div>
    <div style="color:#475569;font-size:10px;border-top:1px solid #1e293b;padding-top:4px;margin-top:2px">
      Score = SST(20) + Break(35) + Chloro(20) + SSH(15) + History(10) · ERDDAP ACSPO/MUR
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Compute a "XXnm CARD of ShortName" distance label for a fixed hotspot def.
// Uses the CANYONS array (same positions used for map labels) to find the
// nearest named feature and report distance + cardinal direction from it.
// Falls back to the first word of the def title when no CANYONS entry is close.
// ---------------------------------------------------------------------------
function computeDistanceLabel(h: HotspotDef): string {
  // Find the closest CANYONS entry by straight-line distance
  let bestName = h.title.split(" ")[0];
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
  // If the break IS essentially at the canyon (< 5 NM), just name it
  if (nm < 5) return `${bestName}`;
  return `${nm}NM ${toCardinal(bestBrng)} of ${bestName}`;
}

// ---------------------------------------------------------------------------
// Build a fallback HotspotDisplay from a HotspotDef (no live data yet).
// isFallbackSst is TRUE — these are INITIAL placeholders only.
// After all ERDDAP fetches complete, any entry still marked isFallbackSst
// will be EXCLUDED from the resolved list (not shown on the map or card list).
// ---------------------------------------------------------------------------
function defToDisplay(h: HotspotDef): HotspotDisplay {
  const breakDelta = parseFloat(
    Math.max(0, (h.fallbackSstF - 68) * 0.18).toFixed(1),
  );
  const signals = buildHotspotSignals(h.fallbackSstF, breakDelta, h);
  const rawConf = computeConfidence(signals);
  return {
    id: h.id,
    title: h.title,
    distanceLabel: computeDistanceLabel(h),
    confidence: Math.max(0, rawConf), // no penalty — will be excluded if still fallback after fetch
    sstTemp: h.fallbackSstF,
    breakDelta,
    lat: h.lat,
    lng: h.lng,
    species: speciesFromSST(h.fallbackSstF),
    signals,
    isFallbackSst: true,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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

  // Layer refs
  const sstLayerRef = useRef<L.TileLayer | null>(null);
  const bathyBaseRef = useRef<L.TileLayer | null>(null);
  const bathyOverlayRef = useRef<L.TileLayer | null>(null);

  // Hotspot markers keyed by id
  const circleMarkersRef = useRef<Map<string, L.CircleMarker>>(new Map());
  const labelMarkersRef = useRef<Map<string, L.Marker>>(new Map());

  // Live-resolved display data — starts EMPTY; markers only appear when a real
  // thermal break is confirmed by the grid scan.  No fallback pins are ever shown.
  const [liveHotspots, setLiveHotspots] = useState<HotspotDisplay[]>([]);
  // Track which IDs are still loading so finaliseHotspots knows when all scans are done
  const loadingIds = useRef<Set<string>>(new Set(hotspotDefs.map((h) => h.id)));

  // Stable refs so init-effect closure is never stale
  const onMapClickRef = useRef(onMapClick);
  const onSaveWaypointRef = useRef(onSaveWaypoint);
  const onHotspotClickRef = useRef(onHotspotClick);
  const liveHotspotsRef = useRef<HotspotDisplay[]>(liveHotspots);

  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);
  useEffect(() => {
    onSaveWaypointRef.current = onSaveWaypoint;
  }, [onSaveWaypoint]);
  useEffect(() => {
    onHotspotClickRef.current = onHotspotClick;
  }, [onHotspotClick]);
  useEffect(() => {
    liveHotspotsRef.current = liveHotspots;
  }, [liveHotspots]);

  // ── No-satellite banner marker ref ───────────────────────────────────────
  const noBannerRef = useRef<L.Marker | null>(null);

  function showNoBanner(map: L.Map) {
    if (noBannerRef.current) return; // already showing
    const banner = L.marker([38.5, -73.5], {
      pane: "hotspotPane",
      interactive: false,
      icon: L.divIcon({
        className: "",
        html: `<div style="background:rgba(30,41,59,0.92);border:1px solid rgba(251,146,60,0.6);border-radius:8px;padding:8px 14px;color:#fb923c;font-size:12px;font-weight:600;white-space:nowrap;box-shadow:0 2px 12px rgba(0,0,0,0.6)">⚠ No satellite SST — hotspot detection unavailable</div>`,
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

  // ── Live scan-break fetch for all hotspots ────────────────────────────────
  //
  // Each HotspotDef has a searchBbox + minConfidence.
  // scanBreakInBbox() sweeps the bbox on a 0.25° grid and returns the cell
  // with the sharpest thermal break (hotSST − ambSST).
  //
  // A hotspot is ONLY plotted when:
  //   1. scanBreakInBbox returns ok:true (actual break in satellite data)
  //   2. computeConfidence(signals) >= def.minConfidence
  //
  // The marker is placed at result.hotLat/hotLng — the ACTUAL break position —
  // not the fixed canyon-anchor lat/lng.
  useEffect(() => {
    // Reset state — clear all previous markers and confirmed breaks
    loadingIds.current = new Set(hotspotDefs.map((h) => h.id));
    setLiveHotspots([]);
    liveHotspotsRef.current = [];

    // Confirmed breaks accumulate here; added to state one by one as they arrive
    const confirmed: HotspotDisplay[] = [];

    hotspotDefs.forEach((h) => {
      scanBreakInBbox({
        searchBbox: h.searchBbox,
        ambLat: h.ambientLat,
        ambLng: h.ambientLng,
      }).then((result) => {
        loadingIds.current.delete(h.id);

        if (result.ok) {
          const { hotLat, hotLng, hotTempF, breakDeltaF } = result;
          const breakDelta = parseFloat(Math.max(0, breakDeltaF).toFixed(1));

          // Build signals using the break cell's actual lat (not def anchor lat)
          // so the GS-intrusion multiplier fires against the real break position.
          const defAtBreak: HotspotDef = { ...h, lat: hotLat, lng: hotLng };
          const signals = buildHotspotSignals(hotTempF, breakDelta, defAtBreak);
          const rawConf = computeConfidence(signals);

          if (rawConf >= h.minConfidence) {
            // ── 100NM arc filter ──────────────────────────────────────────
            // The break cell's resolved position must lie within OC_RADIUS_NM
            // of OC Inlet.  Definitions are pre-filtered at the def level, but
            // the actual break cell can wander outside the arc boundary.
            const nmFromOC = distFromOCInlet(hotLat, hotLng);
            if (nmFromOC > OC_RADIUS_NM) {
              // Outside the 100NM operational arc — discard silently
              loadingIds.current.delete(h.id);
              return;
            }

            // Build label relative to nearest named canyon from the break cell
            const anchorDef: HotspotDef = { ...h, lat: hotLat, lng: hotLng };
            const distLabel = computeDistanceLabel(anchorDef);

            const display: HotspotDisplay = {
              id: h.id,
              title: distLabel || h.title,
              distanceLabel: distLabel,
              confidence: rawConf,
              sstTemp: hotTempF,
              breakDelta,
              lat: hotLat,
              lng: hotLng,
              species: speciesFromSST(hotTempF),
              signals,
              isFallbackSst: false,
              isDynamic: true,
              anchorTitle: h.title,
            };

            confirmed.push(display);

            // Add to map immediately as each scan resolves — no need to wait
            setLiveHotspots((prev) => {
              // Replace if id already exists (shouldn't, but guard against rerenders)
              const withoutDup = prev.filter((e) => e.id !== h.id);
              const next = [...withoutDup, display];
              liveHotspotsRef.current = next;
              return next;
            });
          }
          // else: scan found a break but confidence too low — suppress silently
        }
        // else: no break in bbox — suppress silently

        // When ALL scans are done, fire the resolved callback and handle banner
        if (loadingIds.current.size === 0) {
          setTimeout(() => {
            const finalList = liveHotspotsRef.current;
            if (finalList.length === 0) {
              const map = mapRef.current;
              if (map) showNoBanner(map);
              onHotspotsResolved?.([]);
            } else {
              hideNoBanner();
              onHotspotsResolved?.(finalList);
            }
          }, 0);
        }
      });
    });
  }, [hotspotDefs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Map init (runs once) ──────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initCenter: [number, number] =
      mode === "full" ? [38.5, -73.5] : [38.2, -73.5];
    const initZoom = mode === "full" ? 8 : 7;

    const map = L.map(containerRef.current, {
      center: initCenter,
      zoom: initZoom,
      zoomControl: false,
    });

    // ── Panes ──────────────────────────────────────────────────────────────
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

    // Hotspot circles receive pointer events — must be above ALL tile/label panes
    const hotspotPane = map.createPane("hotspotPane");
    hotspotPane.style.zIndex = "700";
    hotspotPane.style.pointerEvents = "auto";

    // ── Base tile ──────────────────────────────────────────────────────────
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      { attribution: "&copy; CartoDB", pane: "basePane" },
    ).addTo(map);

    // ── Bathy ──────────────────────────────────────────────────────────────
    const bathyBase = L.tileLayer(BATHY_BASE_TILE, {
      attribution: "&copy; Esri",
      opacity: 0.75,
      pane: "bathyBasePane",
      maxNativeZoom: 10,
      maxZoom: 14,
    });
    bathyBaseRef.current = bathyBase;
    bathyBase.addTo(map);

    const bathyOverlay = L.tileLayer(BATHY_OVERLAY_TILE, {
      attribution: "&copy; Esri",
      opacity: 0.9,
      pane: "bathyOverlayPane",
      maxNativeZoom: 10,
      maxZoom: 14,
    });
    bathyOverlayRef.current = bathyOverlay;
    bathyOverlay.addTo(map);

    // ── SST tile ───────────────────────────────────────────────────────────
    const sstLayer = L.tileLayer(gibsSSTTileUrl(0), {
      attribution: "&copy; NASA GIBS",
      opacity: mode === "full" ? 0.45 : 0.65,
      pane: "sstPane",
      maxNativeZoom: 7,
      maxZoom: 14,
      tileSize: 256,
    });
    sstLayerRef.current = sstLayer;
    sstLayer.addTo(map);

    // ── Canyon labels ──────────────────────────────────────────────────────
    CANYONS.forEach((c) => {
      L.marker([c.lat, c.lng], {
        pane: "labelPane",
        interactive: false,
        icon: L.divIcon({
          className: "",
          html: `<div style="color:#e2e8f0;font-size:11px;font-weight:700;white-space:nowrap;text-shadow:0 0 4px #000,0 0 8px #000,1px 1px 2px #000,-1px -1px 2px #000;letter-spacing:0.03em">${c.name}</div>`,
          iconAnchor: [40, 10],
        }),
      }).addTo(map);
    });

    // ── Map-level click → open popup synchronously then fill SST async ────
    map.on("click", async (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      const td = toLoranTD(lat, lng);
      const wpId = Math.random().toString(36).slice(2, 9);

      // Open popup SYNCHRONOUSLY — fixes the race where the popup closes
      // before the async SST fetch resolves.
      const popup = L.popup({ className: "fishing-map-popup" })
        .setLatLng(e.latlng)
        .setContent(buildClickPopupHtml(lat, lng, td, "fetching…", wpId))
        .openOn(map);

      // Wire the save button once the popup DOM is mounted
      const wireSave = () => {
        const btn = document.getElementById(`wp-save-${wpId}`);
        if (!btn) return;
        btn.addEventListener("click", async () => {
          const input = document.getElementById(
            `wp-name-${wpId}`,
          ) as HTMLInputElement | null;
          const name =
            input?.value.trim() || `WP ${new Date().toLocaleTimeString()}`;
          await onSaveWaypointRef.current?.(name, lat, lng, td.w, td.x);
          popup.close();
        });
      };
      popup.on("add", wireSave);

      // Fetch SST async — small ±0.1° box centred on the clicked point
      const clickPad = 0.1;
      const bbox: BBoxQuery = {
        minLat: lat - clickPad,
        maxLat: lat + clickPad,
        minLng: lng - clickPad,
        maxLng: lng + clickPad,
      };
      const result = await getSSTBBoxCached(bbox);

      // User may have closed popup while fetch was in flight
      if (!map.hasLayer(popup)) return;

      let sstText: string;
      let meta: string | undefined;
      let sstF: number | null = null;
      if (result.ok) {
        const isStale =
          (result as { dataset?: string }).dataset === "last-valid";
        if (isStale) {
          sstF = result.fahrenheit;
          // Look up when this reading was actually captured
          const lv = getLastValidSSTBBox(bbox);
          const ageStr = lv
            ? new Date(lv.fetchedAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "unknown date";
          sstText = `⚠ ${result.fahrenheit.toFixed(1)}°F (stale)`;
          meta = `Last valid satellite pass: ${ageStr} — current coverage unavailable`;
        } else {
          sstF = result.fahrenheit;
          sstText = `${result.fahrenheit.toFixed(1)}°F (${result.celsius.toFixed(1)}°C)`;
          meta = `${result.dataset} · ${result.resolution} · ${result.pixelCount}px avg`;
        }
      } else {
        sstText = sstFallbackLabel(result.reason);
      }

      // Update popup content in-place — stays open, no flicker
      popup.setContent(buildClickPopupHtml(lat, lng, td, sstText, wpId, meta));
      wireSave();

      onMapClickRef.current?.({
        lat,
        lng,
        sstF,
        sstText,
        tdW: td.w,
        tdX: td.x,
        meta,
      });
    });

    mapRef.current = map;

    // Map starts with no hotspot markers — scan effect populates them
    // as each scanBreakInBbox resolves.  Nothing to seed here.

    return () => {
      map.remove();
      mapRef.current = null;
      circleMarkersRef.current.clear();
      labelMarkersRef.current.clear();
      sstLayerRef.current = null;
      bathyBaseRef.current = null;
      bathyOverlayRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync markers whenever liveHotspots updates ────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    syncMarkers(map, liveHotspots, loadingIds.current);
  }, [liveHotspots]); // eslint-disable-line react-hooks/exhaustive-deps

  function syncMarkers(
    map: L.Map,
    spots: HotspotDisplay[],
    loadingSet: Set<string>,
  ) {
    // All entries in `spots` are already confirmed live breaks (isFallbackSst=false).
    // No filtering needed — just reconcile markers with the current list.
    const visibleSpots = spots;
    const incomingIds = new Set(visibleSpots.map((h) => h.id));

    // Remove stale markers
    circleMarkersRef.current.forEach((marker, id) => {
      if (!incomingIds.has(id)) {
        marker.remove();
        circleMarkersRef.current.delete(id);
      }
    });
    labelMarkersRef.current.forEach((marker, id) => {
      if (!incomingIds.has(id)) {
        marker.remove();
        labelMarkersRef.current.delete(id);
      }
    });

    visibleSpots.forEach((h) => {
      const color = confidenceColor(h.confidence);
      const isLoading = loadingSet.has(h.id);
      const existing = circleMarkersRef.current.get(h.id);

      if (existing) {
        existing.setStyle({ color, fillColor: color });
        existing.setPopupContent(
          buildHotspotPopupHtml(h, visibleSpots, isLoading),
        );
        // Update label with new SST/confidence
        const lbl = labelMarkersRef.current.get(h.id);
        if (lbl) {
          lbl.setIcon(buildLabelIcon(h, color));
        }
        return;
      }

      // Create circle marker
      const circle = L.circleMarker([h.lat, h.lng], {
        pane: "hotspotPane",
        radius: 13,
        color,
        fillColor: color,
        fillOpacity: 0.35,
        weight: 2,
        interactive: true,
        bubblingMouseEvents: false,
      });

      circle.bindPopup(buildHotspotPopupHtml(h, visibleSpots, isLoading), {
        className: "fishing-map-popup",
      });

      circle.on("click", () => {
        onHotspotClickRef.current?.(h.id);
        // Re-render popup with current allHotspots list so confidence badge is fresh
        circle.setPopupContent(buildHotspotPopupHtml(h, visibleSpots, false));
      });

      circle.addTo(map);
      circleMarkersRef.current.set(h.id, circle);

      // Label marker
      const labelMarker = L.marker([h.lat, h.lng], {
        pane: "labelPane",
        interactive: false,
        icon: buildLabelIcon(h, color),
      });
      labelMarker.addTo(map);
      labelMarkersRef.current.set(h.id, labelMarker);
    });
  }

  function buildLabelIcon(h: HotspotDisplay, color: string): L.DivIcon {
    // Use distanceLabel ("14NM SE of Hudson") when available, else fall back to
    // the first word of title so the marker always has a readable leading segment.
    const leading = h.distanceLabel ?? h.title.split(" ")[0];
    return L.divIcon({
      className: "",
      html: `<div style="display:flex;align-items:center;gap:4px;pointer-events:none;white-space:nowrap"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${color};flex-shrink:0;opacity:0.9"></span><span style="color:#e2e8f0;font-size:11px;font-weight:600;text-shadow:0 0 4px #000,0 0 8px #000,1px 1px 2px #000">${leading} • ${h.sstTemp.toFixed(0)}°F • ${h.confidence}%</span></div>`,
      iconAnchor: [100, -12],
    });
  }

  // ── Show/hide hotspot markers ─────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    circleMarkersRef.current.forEach((marker) => {
      if (showHotspots) {
        if (!map.hasLayer(marker)) marker.addTo(map);
      } else {
        marker.remove();
      }
    });
    labelMarkersRef.current.forEach((marker) => {
      if (showHotspots) {
        if (!map.hasLayer(marker)) marker.addTo(map);
      } else {
        marker.remove();
      }
    });
  }, [showHotspots]);

  // ── SST tile ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const layer = sstLayerRef.current;
    if (!map || !layer) return;
    if (showSST) {
      layer.setUrl(gibsSSTTileUrl(sstOffset));
      if (!map.hasLayer(layer)) layer.addTo(map);
    } else {
      layer.remove();
    }
  }, [showSST, sstOffset]);

  // ── Bathy ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const base = bathyBaseRef.current;
    const overlay = bathyOverlayRef.current;
    if (!base || !overlay) return;
    if (showBathy) {
      if (!map.hasLayer(base)) base.addTo(map);
      if (!map.hasLayer(overlay)) overlay.addTo(map);
    } else {
      base.remove();
      overlay.remove();
    }
  }, [showBathy]);

  // ── flyTo ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!flyTo || !mapRef.current) return;
    mapRef.current.flyTo([flyTo.lat, flyTo.lng], flyTo.zoom ?? 10, {
      duration: 1.2,
    });
  }, [flyTo]);

  // ── invalidateSize after resize / show (for preview mode) ─────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const t = setTimeout(() => map.invalidateSize(), 150);
    return () => clearTimeout(t);
  }, [className]);

  return <div ref={containerRef} className={`w-full h-full ${className}`} />;
}
