// src/sections/Hotspots/index.tsx
// High-Fidelity Non-Blocking Intel Deck - Plotted Mode Controller
// ──────────────────────────────────────────────────────────────────────────────────────

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  Target,
  Flame,
  ThermometerSun,
  MapPin,
  Navigation,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Layers,
  History,
  Compass
} from "lucide-react";
import FishingMap from "../../components/FishingMap";
import type { HotspotDisplay } from "../../components/FishingMap";
import { getCacheAge, gibsSSTDate } from "../../lib/erddap";
import {
  toLoranTD,
  HOTSPOT_DEFS,
  HOTSPOTS_IN_RANGE,
  buildHotspotSignals,
  computeConfidence,
  speciesFromSST,
} from "../../lib/hotspots";

function getLocalConfidenceColor(score: number): string {
  if (score >= 80) return "#34d399"; 
  if (score >= 65) return "#fbbf24"; 
  return "#f87171"; 
}

export default function Hotspots() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(true);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; zoom?: number } | undefined>();

  const [showHotspots, setShowHotspots] = useState(true);
  const [showSST, setShowSST] = useState(true);
  const [showBathy, setShowBathy] = useState(true);
  const [showWeather, setShowWeather] = useState(false); 
  const [sstOffset, setSstOffset] = useState<number>(0); 
  const [showControls, setShowControls] = useState(false);
  const [isPlotterArmed, setIsPlotterArmed] = useState(false); 

  const [liveHotspots, setLiveHotspots] = useState<HotspotDisplay[]>([]);
  const [sstDate] = useState<string>(() => gibsSSTDate(3));
  const [cacheAge, setCacheAge] = useState<number | null>(() => getCacheAge());
  
  const [dynamicDefs, setDynamicDefs] = useState<any[]>(() => 
    HOTSPOTS_IN_RANGE.length > 0 ? [...HOTSPOTS_IN_RANGE] : [...HOTSPOT_DEFS]
  );

  const [loadingIds, setLoadingIds] = useState<Set<string>>(() =>
    new Set(dynamicDefs.map((h) => h.id))
  );

  useEffect(() => {
    let activeScope = true;
    fetch("/.netlify/functions/get-latest-briefs")
      .then((res) => res.ok ? res.json() : Promise.reject())
      .then((data) => {
        if (!activeScope || !data) return;
        
        setDynamicDefs((prevDefs) =>
          prevDefs.map((def) => {
            if (def.id === "1" && data.primary_lat) {
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
      })
      .catch((err) => console.warn("[Hotspots Container] Telemetry standby active.", err));

    return () => { activeScope = false; };
  }, []);

  const handleHotspotsResolved = useCallback((hotspots: HotspotDisplay[]) => {
    setLiveHotspots((prev) => {
      const matchFound = hotspots.some(h => {
        const existing = prev.find(p => p.id === h.id);
        return !existing || existing.sstTemp !== h.sstTemp || existing.confidence !== h.confidence;
      });
      if (!matchFound && prev.length === hotspots.length) return prev;

      return hotspots.map((satHot) => {
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
    });

    setLoadingIds((prev) => prev.size === 0 ? prev : new Set()); 
    setCacheAge(getCacheAge());
  }, [dynamicDefs]);

  const handleHotspotClick = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
    const h = dynamicDefs.find((x) => x.id === id) ?? liveHotspots.find((x) => x.id === id);
    if (h) setFlyTo({ lat: h.lat, lng: h.lng, zoom: 9 });
  }, [dynamicDefs, liveHotspots]);

  const fetchesDone = loadingIds.size === 0;
  const allSatelliteUnavailable = fetchesDone && liveHotspots.length === 0;

  const displayHotspots = useMemo(() => {
    if (fetchesDone) {
      return [...liveHotspots].sort((a, b) => b.confidence - a.confidence);
    }
    return dynamicDefs.map((h) => ({
      id: h.id,
      title: h.title,
      distanceLabel: h.distanceLabel,
      confidence: h.liveConfidence ?? 50,
      sstTemp: h.liveSst ?? h.fallbackSstF,
      breakDelta: h.liveBreak ?? 0,
      lat: h.lat,
      lng: h.lng,
      species: h.liveSst ? speciesFromSST(h.liveSst) : [],
      isFallbackSst: !h.liveSst,
      signals: h.liveSignals ?? {
        sstScore: 0, sstBreakScore: 0, chloroScore: 0, altimetryScore: 0, historyReportsScore: 0,
      },
    }));
  }, [fetchesDone, liveHotspots, dynamicDefs]);

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] overflow-hidden bg-slate-950">
      <div className={`relative transition-all duration-300 flex-shrink-0 ${showMap ? "h-[45%]" : "h-0 overflow-hidden"}`}>
        <FishingMap
          mode="preview"
          hotspotDefs={dynamicDefs}
          showHotspots={showHotspots}
          showSST={showSST}
          sstOffset={sstOffset}
          showBathy={showBathy}
          showWeather={showWeather}
          isPlotterArmed={isPlotterArmed} 
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

          {/* Master Operational Navigation Arm Button */}
          <button
            onClick={() => setIsPlotterArmed((prev) => !prev)}
            className={`border p-2 rounded-xl shadow-xl flex items-center justify-center backdrop-blur-sm transition-all ${
              isPlotterArmed 
                ? "bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-cyan-500/10" 
                : "bg-slate-900/90 border-slate-700 text-slate-400 hover:text-slate-200"
            }`}
            title={isPlotterArmed ? "Deactivate Leg Plotter" : "Arm Leg Plotter"}
          >
            <Compass className={`w-4 h-4 ${isPlotterArmed ? "animate-pulse" : ""}`} />
          </button>

          {showControls && (
            <div className="bg-slate-900/95 border border-slate-700 p-3 rounded-xl shadow-2xl w-48 space-y-3 backdrop-blur-sm text-xs text-slate-200">
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
                  <input type="checkbox" checked={showBathy} onChange={(e) => setShowBathy} onChange={(e) => setShowBathy(e.target.checked)} className="rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-0 w-3.5 h-3.5" />
                  <span>High-Res Bathymetry</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={showWeather} onChange={(e) => setShowWeather(e.target.checked)} className="rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-0 w-3.5 h-3.5" />
                  <span>Marine Sea State</span>
                </label>
              </div>

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

      {/* ── Card List ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Target className="w-5 h-5 text-orange-400" /> AI Hotspots
          </h2>
          <div className="flex items-center gap-2">
            {loadingIds.size > 0 && (
              <span className="flex items-center gap-1 text-xs text-cyan-400">
                <RefreshCw className="w-3 h-3 animate-spin" />
                fetching live SST…
              </span>
            )}
            {cacheAge !== null && loadingIds.size === 0 && (
              <span className="text-xs text-slate-500">
                Updated {cacheAge === 0 ? "just now" : `${cacheAge} min ago`}
              </span>
            )}
          </div>
        </div>

        <p className="text-xs text-slate-500">
          SST from NOAA CoastWatch ERDDAP · ACSPO L3S 0.02° · Cached hourly
        </p>

        {allSatelliteUnavailable && (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
            <AlertTriangle className="w-10 h-10 text-amber-500 opacity-70" />
            <div className="text-amber-400 font-semibold text-base">No satellite SST available</div>
          </div>
        )}

        {displayHotspots.map((h) => {
          const td = toLoranTD(h.lat, h.lng);
          const isSelected = selectedId === h.id;
          const def = dynamicDefs.find((d) => d.id === h.id);

          return (
            <div
              key={h.id}
              onClick={() => handleHotspotClick(h.id)}
              className={`bg-slate-800 rounded-xl p-4 border transition-all cursor-pointer space-y-2 ${
                isSelected ? "border-emerald-500/60 shadow-lg shadow-emerald-900/20" : "border-slate-700"
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-white flex items-center gap-2 text-sm">
                    {h.distanceLabel ?? h.title}
                    {def?.isPrimaryAI && <span className="text-[9px] font-bold bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded uppercase">PRIMARY</span>}
                    {def?.isSecondaryAI && <span className="text-[9px] font-bold bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded uppercase">SECONDARY</span>}
                  </h3>
                  <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3 h-3" />
                    {h.lat.toFixed(2)}°, {Math.abs(h.lng).toFixed(2)}°W
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold" style={{ color: getLocalConfidenceColor(h.confidence) }}>{h.confidence}%</div>
                  <div className="text-[10px] text-slate-500">confidence</div>
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs flex-wrap">
                <div className="flex items-center gap-1">
                  <ThermometerSun className="w-4 h-4 text-orange-400" />
                  <span className="text-orange-400 font-semibold">{h.sstTemp.toFixed(1)}°F</span>
                </div>
                <div className="flex items-center gap-1 text-amber-400">
                  <Flame className="w-4 h-4" />
                  {h.breakDelta > 0 ? `+${h.breakDelta.toFixed(1)}°F break` : "no break"}
                </div>
              </div>

              {h.signals && (
                <div className="space-y-0.5 mt-1 border-t border-slate-700/50 pt-1.5">
                  {[
                    { label: "SST", val: h.signals.sstScore || 0, max: 20, color: "#fb923c" },
                    { label: "Break", val: h.signals.sstBreakScore || 0, max: 35, color: "#fbbf24" },
                    { label: "Chloro", val: h.signals.chloroScore || 0, max: 20, color: "#4ade80" },
                    { label: "SSH", val: h.signals.altimetryScore || 0, max: 15, color: "#818cf8" },
                    { label: "History", val: h.signals.historyReportsScore || 0, max: 10, color: "#67e8f9" },
                  ].map((r) => (
                    <div key={r.label} className="flex items-center gap-1.5">
                      <span className="text-[9px] text-slate-500 w-10 shrink-0">{r.label}</span>
                      <div className="flex-1 bg-slate-700 rounded-full h-1 overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${Math.round((r.val / r.max) * 100)}%`, background: r.color }} />
                      </div>
                      <span className="text-[9px] shrink-0 font-mono" style={{ color: r.color }}>{r.val}/{r.max}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-700/30">
                <div className="text-purple-400 flex items-center gap-1">
                  <Navigation className="w-3 h-3" />
                  TD: W {td.w} / X {td.x}
                </div>
                <div className="text-slate-500 font-mono">{def ? `${def.idealSstF || 72}° ideal` : ""}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
