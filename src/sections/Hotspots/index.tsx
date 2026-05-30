import { useState, useCallback } from "react";
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
} from "lucide-react";
import FishingMap from "../../components/FishingMap";
import type { HotspotDisplay } from "../../components/FishingMap";
import { getCacheAge, formatSST, gibsSSTDate } from "../../lib/erddap";
import {
  toLoranTD,
  confidenceColor,
  HOTSPOT_DEFS,
  HOTSPOTS_IN_RANGE,
} from "../../lib/hotspots";

export default function Hotspots() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(true);
  const [flyTo, setFlyTo] = useState<
    { lat: number; lng: number; zoom?: number } | undefined
  >();

  // Live-resolved hotspot display data — FishingMap calls onHotspotsResolved after SSTs arrive
  const [liveHotspots, setLiveHotspots] = useState<HotspotDisplay[]>([]);
  const [sstDate] = useState(gibsSSTDate);
  const [cacheAge, setCacheAge] = useState<number | null>(getCacheAge);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(
    () =>
      new Set(
        (HOTSPOTS_IN_RANGE.length > 0 ? HOTSPOTS_IN_RANGE : HOTSPOT_DEFS).map(
          (h) => h.id,
        ),
      ),
  );

  const activeHotspotDefs =
    HOTSPOTS_IN_RANGE.length > 0 ? HOTSPOTS_IN_RANGE : HOTSPOT_DEFS;

  const handleHotspotsResolved = useCallback((hotspots: HotspotDisplay[]) => {
    setLiveHotspots(hotspots);
    setLoadingIds(new Set()); // all resolved
    setCacheAge(getCacheAge());
  }, []);

  const handleHotspotClick = useCallback(
    (id: string) => {
      setSelectedId((prev) => (prev === id ? null : id));
      const h = activeHotspotDefs.find((x) => x.id === id);
      if (h) setFlyTo({ lat: h.lat, lng: h.lng, zoom: 9 });
    },
    [activeHotspotDefs],
  );

  // Use liveHotspots if available, otherwise show spinner cards from defs
  const displayHotspots: HotspotDisplay[] =
    liveHotspots.length > 0
      ? liveHotspots
      : activeHotspotDefs.map((h) => ({
          id: h.id,
          title: h.title,
          confidence: 50,
          sstTemp: h.fallbackSstF,
          breakDelta: 0,
          lat: h.lat,
          lng: h.lng,
          species: [],
          signals: {
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
          hotspotDefs={activeHotspotDefs}
          showSST={true}
          showBathy={true}
          showHotspots={true}
          onHotspotClick={handleHotspotClick}
          onHotspotsResolved={handleHotspotsResolved}
          flyTo={flyTo}
          className="absolute inset-0"
        />

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
            <span className="text-xs text-blue-400">60&#176;F</span>
            <div className="w-16 h-1.5 rounded bg-gradient-to-r from-blue-500 via-yellow-400 to-red-500" />
            <span className="text-xs text-red-400">85&#176;F</span>
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

      {/* ── Card list ────────────────────────────────────────────────────── */}
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
          SST from NOAA CoastWatch ERDDAP · ACSPO L3S 0.02° / MUR NRT 0.01° ·
          GIBS {sstDate} · Cached hourly · Tap card to pan map
        </p>

        {displayHotspots.map((h) => {
          const td = toLoranTD(h.lat, h.lng);
          const isSelected = selectedId === h.id;
          const isLoading = loadingIds.has(h.id);
          const def = activeHotspotDefs.find((d) => d.id === h.id);

          // Resolve sstResult-like data from liveHotspot for badge display
          const liveEntry = liveHotspots.find((l) => l.id === h.id);
          const hasLiveSST = !!liveEntry && !isLoading;
          const isFallback = !!liveEntry?.isFallbackSst && !isLoading;

          return (
            <div
              key={h.id}
              onClick={() => handleHotspotClick(h.id)}
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
                    {h.lat.toFixed(2)}&#176;N, {Math.abs(h.lng).toFixed(2)}
                    &#176;W
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
                        style={{ color: confidenceColor(h.confidence) }}
                      >
                        {h.confidence}%
                      </div>
                      <div className="text-xs text-slate-500">confidence</div>
                    </>
                  )}
                </div>
              </div>

              {/* Fallback SST warning banner */}
              {isFallback && (
                <div className="flex items-start gap-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-1.5 text-xs text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>
                    No satellite data — showing hardcoded {h.sstTemp.toFixed(1)}
                    &#176;F. Score penalised −18 pts.
                  </span>
                </div>
              )}

              <div className="flex items-center gap-4 text-sm flex-wrap">
                <div className="flex items-center gap-1">
                  {isLoading ? (
                    <span className="flex items-center gap-1 text-slate-400">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span className="text-xs">fetching SST…</span>
                    </span>
                  ) : (
                    <>
                      <ThermometerSun
                        className={`w-4 h-4 ${isFallback ? "text-slate-500" : "text-orange-400"}`}
                      />
                      <span
                        className={
                          isFallback
                            ? "text-slate-500 line-through"
                            : hasLiveSST
                              ? "text-orange-400"
                              : "text-slate-400"
                        }
                      >
                        {h.sstTemp.toFixed(1)}&#176;F
                      </span>
                      {hasLiveSST && !isFallback && (
                        <span className="ml-1 text-[9px] text-cyan-400 font-medium uppercase tracking-wide">
                          live
                        </span>
                      )}
                      {isFallback && (
                        <span className="ml-1 text-[9px] text-amber-500 font-medium uppercase tracking-wide">
                          fallback
                        </span>
                      )}
                    </>
                  )}
                </div>
                {!isLoading && (
                  <div className="flex items-center gap-1 text-amber-400">
                    <Flame className="w-4 h-4" />
                    {h.breakDelta > 0
                      ? `+${h.breakDelta}&#176;F break`
                      : "no break detected"}
                  </div>
                )}
              </div>

              {/* Signal bucket mini-bars */}
              {!isLoading && (
                <div className="space-y-0.5 mt-1">
                  {[
                    {
                      label: "SST",
                      val: h.signals.sstScore,
                      max: 25,
                      color: "#fb923c",
                    },
                    {
                      label: "Break",
                      val: h.signals.sstBreakScore,
                      max: 25,
                      color: "#fbbf24",
                    },
                    {
                      label: "Chloro",
                      val: h.signals.chloroScore,
                      max: 20,
                      color: "#4ade80",
                    },
                    {
                      label: "SSH",
                      val: h.signals.altimetryScore,
                      max: 15,
                      color: "#818cf8",
                    },
                    {
                      label: "History",
                      val: h.signals.historyReportsScore,
                      max: 15,
                      color: "#67e8f9",
                    },
                  ].map((r) => (
                    <div key={r.label} className="flex items-center gap-1.5">
                      <span className="text-[9px] text-slate-500 w-10 shrink-0">
                        {r.label}
                      </span>
                      <div className="flex-1 bg-slate-700 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.round((r.val / r.max) * 100)}%`,
                            background: r.color,
                          }}
                        />
                      </div>
                      <span
                        className="text-[9px] shrink-0"
                        style={{ color: r.color }}
                      >
                        {r.val}/{r.max}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {!isLoading && (
                <div className="text-xs text-purple-400 flex items-center gap-1">
                  <Navigation className="w-3 h-3" />
                  LORAN W {td.w} / X {td.x} μs
                </div>
              )}

              {!isLoading && h.species.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {h.species.map((s) => (
                    <span
                      key={s}
                      className="text-xs bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded-full"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}

              {def && !isLoading && (
                <div className="text-[10px] text-slate-600 mt-0.5">
                  {def.idealSstF}&#176;F ideal · {def.historyPrior}/15 history
                  score
                  {isFallback && (
                    <span className="text-amber-700"> · ⚠ no live SST</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
