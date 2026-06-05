// src/App.tsx
// Central Application Traffic Controller & View Router
// ─────────────────────────────────────────────────────────────────────

import { useState, useEffect } from "react";
import AdminPanel from "./sections/Admin";
import FishingMap from "./components/FishingMap";

export default function App() {
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [activeTab, setActiveTab] = useState<"map" | "dashboard">("map");
  
  // Custom Map Configuration States
  const [showHotspots, setShowHotspots] = useState(true);
  const [showSST, setShowSST] = useState(true);
  const [sstOffset, setSstOffset] = useState(0);
  const [showBathy, setShowBathy] = useState(true);

  // Sync browser URL paths natively
  useEffect(() => {
    const handleLocationChange = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener("popstate", handleLocationChange);
    return () => window.removeEventListener("popstate", handleLocationChange);
  }, []);

  // 1. GLOBAL ADMIN ROUTE INTERCEPTOR
  if (currentPath === "/admin" || currentPath === "/admin/") {
    return <AdminPanel />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30">
      {/* GLOBAL APPLICATION HEADER */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between sticky top-0 z-50 shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/10">
            <span className="text-slate-950 font-black text-lg tracking-tighter">TO</span>
          </div>
          <div>
            <h1 className="text-base font-bold text-white tracking-wide">TACTICAL OFFSHORE</h1>
            <p className="text-[10px] text-cyan-400 font-mono tracking-widest uppercase">Real-Time Canyon Telemetry</p>
          </div>
        </div>

        {/* APPS CONTROL BAR NAVIGATION */}
        <div className="flex gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab("map")}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all ${
              activeTab === "map"
                ? "bg-gradient-to-r from-cyan-500 to-cyan-600 text-slate-950 shadow-md font-bold"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Chart Vector Map
          </button>
          <button
            onClick={() => setActiveTab("dashboard")}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all ${
              activeTab === "dashboard"
                ? "bg-gradient-to-r from-cyan-500 to-cyan-600 text-slate-950 shadow-md font-bold"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Telemetry Control
          </button>
        </div>
      </header>

      {/* CORE RUNTIME WORKSPACE LAYOUT */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        {activeTab === "map" ? (
          <div className="flex-1 w-full h-full relative min-h-[calc(100vh-65px)]">
            <FishingMap
              mode="full"
              hotspotDefs={null}
              showHotspots={showHotspots}
              showSST={showSST}
              sstOffset={sstOffset}
              showBathy={showBathy}
              className="absolute inset-0 w-full h-full"
            />
            
            {/* INLINE CONFIGURATION FLOATER FLAPS */}
            <div className="absolute bottom-4 left-4 z-[1000] bg-slate-900/90 backdrop-blur-md p-3 rounded-xl border border-slate-800 shadow-2xl max-w-xs space-y-2.5 font-mono text-[11px]">
              <div className="flex items-center justify-between text-slate-400 border-b border-slate-800 pb-1.5">
                <span className="font-bold text-slate-200">MAP CONTROLS</span>
                <span className="text-[10px] bg-cyan-900/40 text-cyan-400 border border-cyan-800/50 px-1.5 py-0.5 rounded">AUTO LOCK BYPASS</span>
              </div>
              <label className="flex items-center justify-between gap-4 cursor-pointer text-slate-300 hover:text-white">
                <span>Show Hotspot Zones</span>
                <input type="checkbox" checked={showHotspots} onChange={(e) => setShowHotspots(e.target.checked)} className="accent-cyan-500 h-3.5 w-3.5" />
              </label>
              <label className="flex items-center justify-between gap-4 cursor-pointer text-slate-300 hover:text-white">
                <span>Render SST Vector Overlay</span>
                <input type="checkbox" checked={showSST} onChange={(e) => setShowSST(e.target.checked)} className="accent-cyan-500 h-3.5 w-3.5" />
              </label>
              <label className="flex items-center justify-between gap-4 cursor-pointer text-slate-300 hover:text-white">
                <span>Enable Bathymetry Layers</span>
                <input type="checkbox" checked={showBathy} onChange={(e) => setShowBathy(e.target.checked)} className="accent-cyan-500 h-3.5 w-3.5" />
              </label>
              <div className="flex items-center justify-between border-t border-slate-800 pt-2 text-slate-300">
                <span>Thermal Temp Offset</span>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setSstOffset(o => o - 0.5)} className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 text-xs">-</button>
                  <span className="text-orange-400 font-bold min-w-[35px] text-center">{sstOffset >= 0 ? `+${sstOffset.toFixed(1)}` : sstOffset.toFixed(1)}°</span>
                  <button onClick={() => setSstOffset(o => o + 0.5)} className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 text-xs">+</button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 p-6 max-w-4xl w-full mx-auto space-y-6 overflow-y-auto">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <h2 className="text-lg font-bold text-white mb-2">Telemetry Integration Settings</h2>
              <p className="text-sm text-slate-400 mb-4">
                Your 4,818 matrix array data coordinates are streaming natively into the map view layer. 
                Use the quick control switches on the bottom left corner of the Chart View map to toggle satellite grids, tracking scopes, and adjust thermal offsets.
              </p>
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2 font-mono text-xs text-slate-400">
                <div className="flex justify-between"><span className="text-slate-500">Live Server Connection:</span> <span className="text-emerald-400 font-bold">ONLINE</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Active Database Cluster:</span> <span className="text-cyan-400">xvvgahrcjqxclykxcbfb</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Ingested Matrix Rows:</span> <span className="text-white font-bold">4,818 Rows</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Security Access Level:</span> <span className="text-purple-400 font-bold">MASTER ADMIN MASTER BYPASS</span></div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
