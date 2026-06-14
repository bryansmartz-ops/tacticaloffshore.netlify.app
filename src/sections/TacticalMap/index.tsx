import { useState, useCallback, useRef, useEffect } from "react";
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
import FishingMap from "../../components/FishingMap";
import { gibsSSTDate, gibsSSTLabel } from "../../lib/erddap";
import { HOTSPOTS_IN_RANGE, HOTSPOT_DEFS } from "../../lib/hotspots";
import { supabase } from "../../lib/supabase";

const SST_HISTORY_OFFSETS = [0, 1, 2, 3];
const KV_TABLE = "kv_store_8db09b0a";

export interface Waypoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  tdW: string;
  tdY: string; // Adjusted safely to mirror underlying object models natively
  tdX: string;
  savedAt: string;
}

const activeHotspotDefs =
  HOTSPOTS_IN_RANGE.length > 0 ? HOTSPOTS_IN_RANGE : HOTSPOT_DEFS;

export default function TacticalMap() {
  const [showSST, setShowSST] = useState(true);
  const [showBathy, setShowBathy] = useState(true);
  const [showHotspots, setShowHotspots] = useState(true);
  const [sstOffset, setSstOffset] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const animIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showWaypoints, setShowWaypoints] = useState(false);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; zoom?: number } | undefined>();

  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [wpMutating, setWpMutating] = useState(false);

  // ── Sync Waypoint Vectors Natively from Supabase ─────────────────────────
  const fetchWaypoints = async () => {
    try {
      const { data, error } = await supabase
        .from(KV_TABLE)
        .select("value")
        .like("key", "waypoint:%");

      if (error) throw error;

      if (data) {
        const parsedWps = data.map((row: any) => row.value as Waypoint);
        // Sort newest saved entries to the top
        parsedWps.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
        setWaypoints(parsedWps);
      }
    } catch (err) {
      console.error("[Waypoint Synchronization Failure]:", err);
    }
  };

  useEffect(() => {
    fetchWaypoints();
  }, []);

  // ── Save Waypoints ───────────────────────────────────────────────────────
  const handleSaveWaypoint = useCallback(
    async (name: string, lat: number, lng: number, tdW: string, tdX: string) => {
      setWpMutating(true);
      try {
        const id = Math.random().toString(36).substring(2, 9).toUpperCase();
        const newWp: Waypoint = {
          id,
          name: name.trim() || `Mark-${id}`,
          lat,
          lng,
          tdW,
          tdY: "", 
          tdX,
          savedAt: new Date().toISOString(),
        };

        const { error } = await supabase
          .from(KV_TABLE)
          .insert([{ key: `waypoint:${id}`, value: newWp }]);

        if (error) throw error;
        await fetchWaypoints();
      } catch (err) {
        console.error("[Waypoint Persistence Failed]:", err);
      } finally {
        setWpMutating(false);
      }
    },
    []
  );

  // ── Delete Waypoints ─────────────────────────────────────────────────────
  const deleteWaypoint = useCallback(
    async (id: string) => {
      setWpMutating(true);
      try {
        const { error } = await supabase
          .from(KV_TABLE)
          .delete()
          .eq("key", `waypoint:${id}`);

        if (error) throw error;
        await fetchWaypoints();
      } catch (err) {
        console.error("[Waypoint Deletion Failed]:", err);
      } finally {
        setWpMutating(false);
      }
    },
    []
  );

  // Animation loop
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

  return (
    <div className="h-[calc(100vh-8rem)] relative">
      {/* ── Shared map ─────────────────────────────────────────────────── */}
      <FishingMap
        mode="full"
        hotspotDefs={activeHotspotDefs}
        showSST={showSST}
        sstOffset={sstOffset}
        showBathy={showBathy}
        showHotspots={showHotspots}
        onSaveWaypoint={handleSaveWaypoint}
        flyTo={flyTo}
        className="absolute inset-0"
      />

      {/* ── Waypoints panel ────────────────────────────────────────────── */}
      {showWaypoints && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1200] w-[min(340px,calc(100vw-24px))] bg-slate-900/97 border border-cyan-700 rounded-xl shadow-2xl flex flex-col max-h-[70vh]">
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700">
            <span className="text-sm font-bold text-cyan-400 flex items-center gap-1.5">
              <BookmarkCheck className="w-4 h-4" /> Saved Waypoints ({waypoints.length})
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
                        setFlyTo({ lat: wp.lat, lng: wp.lng, zoom: 10 });
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

      {/* ── SST History panel ──────────────────────────────────────────── */}
      <div className="absolute bottom-4 left-3 z-[1000] bg-slate-900/95 border border-slate-600 rounded-lg px-2 py-1.5 flex flex-col items-center gap-1 w-[min(230px,calc(100vw-80px))]">
        <div className="flex items-center gap-1.5 w-full">
          <Clock className="w-3 h-3 text-cyan-400 shrink-0" />
          <span className="text-[9px] text-slate-300 font-semibold flex-1">
            SST History
          </span>
          <button
            onClick={() => {
              setIsAnimating((a) => !a);
              if (!showSST) setShowSST(true);
            }}
            className={`text-[9px] px-1.5 py-0.5 rounded border transition-all min-w-[42px] ${isAnimating ? "bg-cyan-500 border-cyan-400 text-white" : "bg-slate-700 border-slate-500 text-slate-300"}`}
          >
            {isAnimating ? "⏹ Stop" : "▶ Play"}
          </button>
        </div>
        <div className="grid grid-cols-4 gap-0.5 w-full">
          {SST_HISTORY_OFFSETS.map((offset) => (
            <button
              key={offset}
              onClick={() => {
                setSstOffset(offset);
                setIsAnimating(false);
                if (!showSST) setShowSST(true);
              }}
              className={`py-0.5 rounded text-[9px] font-semibold border transition-all text-center leading-tight ${
                sstOffset === offset
                  ? "bg-orange-500 border-orange-400 text-white"
                  : "bg-slate-800 border-slate-600 text-slate-400"
              }`}
            >
              {gibsSSTLabel(offset)}
            </button>
          ))}
        </div>
        <div className="text-[9px] text-slate-500 self-start">
          {gibsSSTDate(3 + sstOffset)} · MUR 1km
        </div>
      </div>

      {/* ── Right-side toolbar ────────────────────────────────────────── */}
      <div className="absolute top-3 right-3 z-[1100] flex flex-col gap-2">
        <button
          onClick={() => setShowSST(!showSST)}
          className={`p-2 rounded-lg border transition-all ${showSST ? "bg-orange-500 border-orange-400 text-white" : "bg-slate-800/90 border-slate-600 text-slate-300"}`}
          title="Toggle SST overlay"
        >
          <Themeometer className="w-5 h-5" />
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
          onClick={() => {
            if (navigator.geolocation) {
              navigator.geolocation.getCurrentPosition((pos) => {
                setFlyTo({
                  lat: pos.coords.latitude,
                  lng: pos.coords.longitude,
                  zoom: 10,
                });
              });
            }
          }}
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

      {/* ── Legend ───────────────────────────────────────────────────────── */}
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

      {/* ── SST tap-for-temp key ─────────────────────────────────────────── */}
      <div className="absolute bottom-3 right-3 z-[1000] bg-slate-900/85 rounded px-1.5 py-1 border border-slate-700/60">
        <div className="text-[9px] text-slate-400 mb-0.5 leading-none">
          tap map for temp
        </div>
        <div className="flex items-center gap-0.5">
          <span className="text-[8px] text-blue-400">60&#176;</span>
          <div className="w-16 h-1.5 rounded bg-gradient-to-r from-blue-500 via-yellow-400 to-red-500" />
          <span className="text-[8px] text-red-400">85&#176;</span>
        </div>
      </div>
    </div>
  );
}
