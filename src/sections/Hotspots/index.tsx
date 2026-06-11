// src/sections/Hotspots/index.tsx
// ─────────────────────────────────────────────────────────────────────

import { useState, useCallback, useEffect } from "react";
import {
  Target,
  Flame,
  ThermometerSun,
  MapPin,
  Navigation,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  AlertTriangle,
  Layers,
  History
} from "lucide-react";
import FishingMap from "../../components/FishingMap";
import type { HotspotDisplay } from "../../components/FishingMap";
import { getCacheAge, gibsSSTDate } from "../../lib/erddap";
import {
  toLoranTD,
  confidenceColor,
  HOTSPOT_DEFS,
  HOTSPOTS_IN_RANGE,
  buildHotspotSignals,
  computeConfidence,
  speciesFromSST,
} from "../../lib/hotspots";

export default function Hotspots() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(true);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; zoom?: number } | undefined>();

  // ─── Toggles & Timeline Playback States ────────────────────────────────────
  const [showHotspots, setShowHotspots] = useState(true);
  const [showSST, setShowSST] = useState(true);
  const [showBathy, setShowBathy] = useState(true);
  const [sstOffset, setSstOffset] = useState<number>(0); // 0=Live, 1=-12h, 2=-24h, 3=-36h
  const [showControls, setShowControls] = useState(false);

  // Live-resolved data frameworks
  const [liveHotspots, setLiveHotspots] = useState<HotspotDisplay[]>([]);
  const [sstDate] = useState(gibsSSTDate);
  const [cacheAge, setCacheAge] = useState<number | null>(getCacheAge);
  
  const [dynamicDefs, setDynamicDefs] = useState<any[]>(() => 
    HOTSPOTS_IN_RANGE.length > 0 ? [...HOTSPOTS_IN_RANGE] : [...HOTSPOT_DEFS]
  );

  const [loadingIds, setLoadingIds] = useState<Set<string>>(() =>
    new Set(dynamicDefs.map((h) => h.id))
  );

  // ─── Explicit Core Target Synchronization ──────────────────────────────────
  useEffect(() => {
    fetch("/.netlify/functions/get-latest-brief")
      .then((res) => {
        if (!res.ok) throw new Error("Endpoint standby mode");
        return res.json();
      })
      .then((data) => {
        if (data && data.primary_lat) {
          setDynamicDefs((prevDefs) =>
            prevDefs.map((def) => {
              if (def.id === "1") {
                const liveSignals = buildHotspotSignals(data.live_sst_value, data.live_break_delta, {
                  ...def,
                  lat: data.primary_lat,
                  lng: data.primary_lng,
                });
                return {
                  ...def,
                  lat: data.primary_lat,
                  lng: data.primary_lng,
                  liveSst: data.live_sst_value,
                  liveBreak: data.live_break_delta,
                  liveConfidence: Math.max(92, computeConfidence(liveSignals)),
                  liveSignals,
                  isPrimaryAI: true,
                };
              }

              if (def.id === "2" && data.secondary_lat) {
                const secondarySst = Math.max(60, data.live_sst_value - 1.0);
                const secondaryBreak = Math.max(0, data.live_break_delta - 0.4);
                
                const liveSignals = buildHotspotSignals(secondarySst, secondaryBreak, {
                  ...def,
                  lat: data.secondary_lat,
                  lng: data.secondary_lng,
                });
                return {
                  ...def,
                  lat: data.secondary_lat,
                  lng: data.secondary_lng,
                  liveSst: secondarySst,
                  liveBreak: secondaryBreak,
                  liveConfidence: Math.max(86, computeConfidence(liveSignals)),
                  liveSignals,
                  isSecondaryAI: true,
                };
              }

              return def;
            })
          );
        }
      })
      .catch((err) => console.warn("[hotspots] Core targets pipeline deferred:", err));
  }, []);

  const handleHotspotsResolved = useCallback((hotspots: HotspotDisplay[]) => {
    const compiled = hotspots.map((satHot) => {
      const match = dynamicDefs.find((d) => d.id === satHot.id);
      if (match && match.liveSst) {
        return {
          ...satHot,
          lat: match.lat,
          lng: match.lng,
          sstTemp: match.liveSst,
          breakDelta: match.liveBreak,
          confidence: match.liveConfidence,
          signals: match.liveSignals,
          species: speciesFromSST(match.liveSst),
        };
      }
      return satHot;
    });

    setLiveHotspots(compiled);
    setLoadingIds(new Set()); 
    setCacheAge(getCacheAge());
  }, [dynamicDefs]);

  const handleHotspotClick = useCallback(
    (id: string) => {
      setSelectedId((prev) => (prev === id ? null : id));
      const h = dynamicDefs.find((x) => x.id === id) ?? liveHotspots.find((x) => x.id === id);
      if (h) setFlyTo({ lat: h.lat, lng: h.lng, zoom: 9 });
    },
    [dynamicDefs, liveHotspots],
  );

  const fetchesDone = loadingIds.size === 0;
  const allSatelliteUnavailable = fetchesDone && liveHotspots.length === 0;

  const displayHotspots: HotspotDisplay[] = fetchesDone
    ? [...liveHotspots].sort((a, b) => b.confidence - a.confidence)
    : dynamicDefs.map((h) => ({
        id: h.id,
        title: h.title,
        confidence: h.liveConfidence ?? 50,
        sstTemp: h.liveSst ?? h.fallbackSstF,
        breakDelta: h.liveBreak ?? 0,
        lat: h.lat,
        lng: h.lng,
        species: h.liveSst ? speciesFromSST(h.liveSst) : [],
        isFallbackSst: !h.liveSst,
        signals: h.liveSignals ?? {
          sstScore: 0,
          sstBreakScore: 0,
          chloroScore: 0,
          altimetryScore: 0,
          historyReportsScore: 0,
        },
      }));

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] overflow-hidden">
      {/* ── Map panel ────────────────────────────────────────────────────── */}
      <div
        className={`relative transition-all duration-300 flex-shrink-0 ${showMap ? "h-[45%]" : "h-0 overflow-hidden"}`}
      >
        <FishingMap
          mode="preview"
          hotspotDefs={dynamicDefs}
          showHotspots={showHotspots}
          showSST={showSST}
          sstOffset={sstOffset}
          showBathy={showBathy}
          onHotspotClick={handleHotspotClick}
          onHotspotsResolved={handleHotspotsResolved}
          flyTo={flyTo}
          className="absolute inset-0"
        />

        {/* Floating Controller HUD */}
        <div className="absolute top-2 right-2 z-[1000] flex flex-col gap-1.5 items-end">
          <button
            onClick={() => setShowControls((v) => !v)}
            className="bg-slate-900/90 border border-slate-700 text-slate-200 p-2 rounded-xl shadow-xl flex items-center justify-center backdrop-blur-sm"
          >
            <Layers className="w-4 h-4" />
          </button>

          {showControls && (
            <div className="bg-slate-900/95 border border-slate-700 p-3 rounded-xl shadow-2xl w-48 space-y-3 backdrop-blur-sm text-xs text-slate-200">
              {/* Layer Toggles */}
              <div className="space-y-1.5">
                <div className="font-semibold text-slate-400 tracking-wider uppercase text-[10px]">Layers</div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={showHotspots} onChange={(e) => setShowHotspots(e.target.checked)} className="rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-0 w-3.5 h-3.5" />
                  <span>AI Hotspot Pins</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={showSST} onChange={(e) => setShowSST(e.target.checked)} className="rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-0 w-3.5 h-3.5" />
                  <span>Satellite SST Overlay</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={showBathy} onChange={(e) => setShowBathy(e.target.checked)} className="rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-0 w-3.5 h-3.5" />
                  <span>High-Res Bathymetry</span>
                </label>
              </div>

              {/* Time Playback */}
              <div className="space-y-1.5 border-t border-slate-800 pt-2">
                <div className="font-semibold text-slate-400 tracking-wider uppercase text-[10px] flex items-center gap-1">
                  <History className="w-3 h-3" /> Historical Playback
                </div>
                <div className="grid grid-cols-4 gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800">
                  {[
                    { label: "Live", val: 0 },
                    { label: "-12h", val: 1 },
                    { label: "-24h", val: 2 },
                    { label: "-36h", val: 3 },
                  ].map((t) => (
                    <button
                      key={t.val}
                      onClick={() => setSstOffset(t.val)}
                      className={`text-[10px] font-medium py-1 rounded-md transition-all ${
                        sstOffset === t.val
                          ? "bg-cyan-600 text-white shadow-md font-semibold"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => setShowMap((v) => !v)}
          className="absolute bottom-2 right-2 z-[1000] bg-slate-800/90 border border-slate-600 text-slate-300 text-xs px-2 py-1 rounded-lg flex items-center gap-1"
        >
          {showMap ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {showMap ? "Hide map" : "Show map"}
        </button>

        <div className="absolute bottom-2 left-2 z-[1000] bg-slate-800/80 rounded px-2 py-1 border border-slate-700">
          <div className="flex items-center gap-1">
            <span className="text-xs text-blue-400">60°C</span>
            <div className
