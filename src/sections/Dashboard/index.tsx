import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  Map,
  Fish,
  Sun,
  Waves,
  Cloud,
  Target,
  ChevronRight,
  Thermometer,
  Anchor,
  AlertTriangle,
} from "lucide-react";

export interface SSTResult {
  ok: boolean;
  fahrenheit: number;
  celsius: number;
  resolution: "0.02deg" | "0.01deg" | "unknown";
  timestamp: string;
}

type ConditionStatus = "GO" | "MARGINAL" | "NO-GO" | "loading" | "error";

const LAT = 38.3365;
const LNG = -75.0849;

// ─── Chronological Solunar Calculators ─────────────────────────────────────────
function jd(date: Date): number {
  const Y = date.getUTCFullYear();
  const M = date.getUTCMonth() + 1;
  const D = date.getTargetDate ? date.getTargetDate() : date.getDate();
  const A = Math.floor((14 - M) / 12);
  const y = Y + 4800 - A;
  const m = M + 12 * A - 3;
  return D + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

function moonPhaseScore(date: Date): number {
  const KNOWN_NEW_MOON_JD = 2451550.259;
  const SYNODIC = 29.53058867;
  const daysSince = jd(date) - KNOWN_NEW_MOON_JD;
  const phase = ((daysSince % SYNODIC) + SYNODIC) % SYNODIC;
  const distFromPeak = Math.min(Math.abs(phase), Math.abs(phase - 14.77), Math.abs(phase - 29.53));
  return Math.max(0, 100 - distFromPeak * 10);
}

function moonLongitude(j: number): number {
  const T = (j - 2451545.0) / 36525;
  const L0 = 218.3164477 + 481267.88123421 * T;
  const M = 357.5291092 + 35999.0502909 * T;
  const Mm = 134.9633964 + 477198.8675055 * T;
  const F = 93.272095 + 483202.0175233 * T;
  const D = 297.8501921 + 445267.1114034 * T;
  const lon = L0 + 6.288774 * Math.sin((Mm * Math.PI) / 180) + 1.274027 * Math.sin(((2 * D - Mm) * Math.PI) / 180) + 0.658314 * Math.sin(((2 * D) * Math.PI) / 180);
  return ((lon % 360) + 360) % 360;
}

function localSiderealTime(j: number, lngDeg: number): number {
  return (((280.46061837 + 360.98564736629 * (j - 2451545.0) + lngDeg) % 360) + 360) % 360;
}

function moonTransitUTC(date: Date): number {
  const noon = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0));
  let j0 = jd(noon);
  for (let iter = 0; iter < 2; iter++) {
    const ha = ((localSiderealTime(j0, LNG) - moonLongitude(j0) + 180) % 360) - 180;
    j0 -= ha / 360;
  }
  return ((j0 - Math.floor(j0)) * 24 + 24) % 24;
}

function formatHM(h: number): string {
  let hours = Math.floor(h);
  let minutes = Math.round((h - hours) * 60);
  if (minutes === 60) { minutes = 0; hours += 1; }
  return `${hours % 12 === 0 ? 12 : hours % 12}:${String(minutes).padStart(2, "0")} ${hours % 24 < 12 ? "AM" : "PM"}`;
}

function getDashboardSolunar(): { rating: string; nextMajor: string; ratingColor: string } {
  const now = new Date();
  const transitLocal = (((moonTransitUTC(now) + (-now.getTimezoneOffset() / 60)) % 24) + 24) % 24;
  const phaseScore = moonPhaseScore(now);
  const dailyScore = Math.round(Math.min(100, Math.round(50 + phaseScore * 0.5)) * 0.7 + Math.min(100, Math.round(30 + phaseScore * 0.4)) * 0.3);
  const rating = dailyScore >= 80 ? "Excellent" : dailyScore >= 60 ? "Good" : dailyScore >= 40 ? "Fair" : "Poor";
  const upcoming = [transitLocal, (((transitLocal + 12.41) % 24) + 24) % 24].map(h => ({ h, label: formatHM(h) })).find(c => c.h > (now.getHours() + now.getMinutes() / 60)) || { label: formatHM(transitLocal) };
  return { rating, nextMajor: upcoming.label, ratingColor: rating === "Excellent" ? "text-emerald-400" : rating === "Good" ? "text-amber-400" : rating === "Fair" ? "text-yellow-400" : "text-slate-400" };
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [solunar, setSolunar] = useState<{ rating: string; nextMajor: string; ratingColor: string } | null>(null);
  const [sstResult, setSSTResult] = useState<SSTResult | null>(null);
  const [conditions, setConditions] = useState<{ status: ConditionStatus; wind: number | null; wave: number | null; ts: string }>({ status: "loading", wind: null, wave: null, ts: "" });
  const [brief, setBrief] = useState<any>(null);
  const [briefLoading, setBriefLoading] = useState<boolean>(true);
  const [dataAgeHours, setDataAgeHours] = useState<number>(0);

  // ─── INTEGRATED SYSTEM ACCESS VERIFICATION ─────────────────────────────────
  useEffect(() => {
    let isMounted = true;

    // Evaluate terminal verification indexes inside persistent local storage
    const isAccessGranted = 
      localStorage.getItem("tactical_access_granted") === "true" ||
      localStorage.getItem("tactical_unlocked") === "true" ||
      localStorage.getItem("isLoggedIn") === "true";

    if (!isAccessGranted) {
      if (isMounted) {
        console.warn("[Vessel Unverified]: Terminal lacking hardware tokens. Rerouting to gateway interface.");
        navigate("/login", { replace: true });
      }
      return;
    }

    // Authorization checks passed safely, initiate localized telemetry matrix sync
    if (isMounted) {
      setAuthLoading(false);
      initializeDashboardData();
    }

    return () => {
      isMounted = false;
    };
  }, [navigate]);

  const initializeDashboardData = () => {
    setSolunar(getDashboardSolunar());

    fetch("//.netlify/functions/get-latest-brief")
      .then((res) => {
        if (!res.ok) throw new Error("Synchronization offline");
        return res.json();
      })
      .then((data) => {
        const trueBrief = data?.brief || data;
        setBrief(trueBrief);

        if (data?.buoyFallback && data.buoyFallback.ts !== "Offline") {
          const b = data.buoyFallback;
          let status: ConditionStatus = "GO";
          if ((b.wind ?? 0) >= 30 || (b.wave ?? 0) >= 9) status = "NO-GO";
          else if ((b.wind ?? 0) >= 20 || (b.wave ?? 0) >= 6) status = "MARGINAL";
          setConditions({ status, wind: b.wind, wave: b.wave, ts: b.ts });
        } else {
          setConditions({ status: "error", wind: null, wave: null, ts: "Buoy Unreachable" });
        }

        const updateTime = data?.meta?.updated_at || trueBrief?.forecast_date || new Date().toISOString();
        const hoursOld = (new Date().getTime() - new Date(updateTime).getTime()) / (1000 * 60 * 60);
        setDataAgeHours(hoursOld);

        setTimeout(() => {
          const activeSst = data?.meta?.live_sst_value || trueBrief?.live_sst_value || 71.0;
          setSSTResult({
            ok: true,
            fahrenheit: Number(activeSst),
            celsius: ((Number(activeSst) - 32) * 5) / 9,
            resolution: "0.02deg",
            timestamp: updateTime
          });
          setBriefLoading(false);
        }, 10);
      })
      .catch((err) => {
        console.warn("[Dashboard Runtime Stalled]:", err);
        setBriefLoading(false);
        setConditions({ status: "error", wind: null, wave: null, ts: "Proxy Blocked" });
      });
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="text-xs text-slate-500 uppercase tracking-widest font-mono animate-pulse">
          Validating Security Credentials...
        </div>
      </div>
    );
  }

  const quickLinks = [
    { to: "/map", icon: Map, label: "Tactical Map", desc: "SST, hotspots, LORAN", color: "from-cyan-500 to-blue-600" },
    { to: "/hotspots", icon: Target, label: "Hotspots", desc: "AI-predicted fishing zones", color: "from-orange-500 to-red-600" },
    { to: "/catches", icon: Fish, label: "Catch Log", desc: "Log and track catches", color: "from-emerald-500 to-teal-600" },
    { to: "/solunar", icon: Sun, label: "Solunar", desc: "Peak feeding times", color: "from-amber-500 to-orange-600" },
    { to: "/tides", icon: Waves, label: "Tides", desc: "Tide schedule", color: "from-blue-500 to-indigo-600" },
    { to: "/weather", icon: Cloud, label: "Weather", desc: "Marine forecast", color: "from-slate-500 to-slate-700" },
  ];

  return (
    <div className="p-4 space-y-6">
      {/* Data Age Warning Banner */}
      {!briefLoading && dataAgeHours > 12 && (
        <div className={`flex items-center gap-3 p-3 rounded-xl border font-medium text-xs ${
          dataAgeHours > 24 ? "bg-red-950/40 text-red-400 border-red-900/60" : "bg-orange-950/40 text-orange-400 border-orange-900/60"
        }`}>
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <div>
            <span className="font-bold block uppercase tracking-wide">
              {dataAgeHours > 24 ? "CRITICAL: Satellite Telemetry Expired" : "WARNING: Stale Tactical Intel"}
            </span>
            <span>
              Canyon charts were compiled {Math.round(dataAgeHours)} hours ago. Thermal boundaries may have shifted from plotted markers.
            </span>
          </div>
        </div>
      )}

      {/* Briefing Section */}
      <section className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 rounded-xl p-4 border border-slate-700/60 shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-cyan-400 font-bold tracking-wide text-xs uppercase">
            <Anchor className="w-4 h-4" />
            Tactical Briefing Core
          </div>
          {!briefLoading && (
            <span className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
              dataAgeHours > 24 ? "bg-red-900/40 text-red-400" : dataAgeHours > 12 ? "bg-orange-900/40 text-orange-400" : "bg-emerald-900/40 text-emerald-400"
            }`}>
              {dataAgeHours > 24 ? "EXPIRED" : dataAgeHours > 12 ? "STALE" : "LIVE CACHE"}
            </span>
          )}
        </div>

        {briefLoading ? (
          <div className="text-sm text-slate-500 animate-pulse py-2">
            Interrogating environmental cache matrices...
          </div>
        ) : dataAgeHours > 24 ? (
          <p className="text-sm text-red-400/90 leading-relaxed italic py-2">
            ⚠️ Telemetry safety window exceeded. Satellite thermal data has been suppressed. Run a fresh cloud ingestion sync before running offshore.
          </p>
        ) : brief ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-300 leading-relaxed font-medium">
              {brief?.environmental_summary || "Tactical offshore data active. Navigational vectors synchronized to mapping canvas layers."}
            </p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="bg-slate-900/40 p-2 rounded-lg border border-slate-800">
                <span className="block text-[10px] uppercase font-bold text-slate-500">
                  Primary Strike Zone
                </span>
                <span className="text-xs text-amber-400 font-semibold font-mono truncate block mt-0.5">
                  {brief?.primary_target_zone?.split("\n")[0] || "Washington Canyon"}
                </span>
              </div>
              <div className="bg-slate-900/40 p-2 rounded-lg border border-slate-800">
                <span className="block text-[10px] uppercase font-bold text-slate-500">
                  Thermal Gradient
                </span>
                <span className="text-xs text-emerald-400 font-semibold truncate block mt-0.5">
                  {brief?.canyon_wall_temp ? `${brief.shelf_temp} ➔ ${brief.canyon_wall_temp}` : "Dynamic Breaks Active"}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-400 leading-relaxed italic">
            Environmental cache standing by. Run manual briefing sequence to map canyon trajectories.
          </p>
        )}
      </section>

      {/* Navigation Matrix */}
      <section>
        <h2 className="text-xl font-bold text-white mb-4">Quick Access</h2>
        <div className="grid grid-cols-2 gap-3">
          {quickLinks.map(({ to, icon: Icon, label, desc, color }) => (
            <button
              key={to}
              onClick={() => navigate(to)}
              className="bg-slate-800 rounded-xl p-4 text-left border border-slate-700 hover:border-slate-600 transition-all group"
            >
              <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center mb-3`}>
                <Icon className="w-5 h-5 text-white" />
              </div>
              <h3 className="font-semibold text-white group-hover:text-cyan-400 transition-colors flex items-center gap-1">
                {label}
                <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
            </button>
          ))}
        </div>
      </section>

      {/* Marine Analytics Outputs */}
      <section className="bg-slate-800 rounded-xl p-4 border border-slate-700">
        <h3 className="font-semibold text-white mb-3">Today's Outlook</h3>
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="bg-slate-700/50 rounded-xl py-3 px-2">
            <div className={`text-xl sm:text-2xl font-bold ${conditions.status === "GO" ? "text-emerald-400" : conditions.status === "MARGINAL" ? "text-amber-400" : conditions.status === "NO-GO" ? "text-red-400" : "text-slate-500"}`}>
              {conditions.status === "loading" ? "…" : conditions.status === "error" ? "—" : conditions.status}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">Conditions</div>
            {conditions.ts && <div className="text-[9px] text-slate-600 mt-0.5 truncate">{conditions.ts}</div>}
          </div>
          <div className="bg-slate-700/50 rounded-xl py-3 px-2">
            <div className={`text-xl sm:text-2xl font-bold ${solunar?.ratingColor ?? "text-amber-400"}`}>
              {solunar?.rating ?? "—"}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">Solunar</div>
          </div>
          <div className="bg-slate-700/50 rounded-xl py-3 px-2">
            <div className="text-xl sm:text-2xl font-bold text-cyan-400">{solunar?.nextMajor ?? "—"}</div>
            <div className="text-xs text-slate-400 mt-0.5">Next Major</div>
          </div>
          <div className="bg-slate-700/50 rounded-xl py-3 px-2">
            <div className="flex items-center justify-center gap-1">
              <Themeometer className="w-4 h-4 text-orange-400 flex-shrink-0" />
              <div className="text-xl sm:text-2xl font-bold text-orange-400">
                {sstResult?.ok && dataAgeHours <= 24 ? `${sstResult.fahrenheit.toFixed(1)}°F` : "—"}
              </div>
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              Offshore SST
              {sstResult?.ok && dataAgeHours <= 24 && <span className="ml-1 text-[9px] font-medium text-violet-400">ACSPO</span>}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
