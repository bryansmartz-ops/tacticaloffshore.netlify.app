import {
  Cloud,
  Wind,
  Droplets,
  Eye,
  Gauge,
  Thermometer,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  MapPin,
  Radio,
  Satellite,
} from "lucide-react";
import { useState, useEffect } from "react";
import { getSSTBBoxCached, type SSTResult } from "../../lib/erddap";

// ─── Data Sources ─────────────────────────────────────────────────────────────
// Primary marine conditions: NDBC Buoy 44009 (Delaware Bay Entrance — ~38nm ESE of
// Ocean City, MD — the NOAA offshore reference for the MD/VA coastal run)
// Backup / inshore wind: NOAA ASOS station KOXB (Ocean City Airport — on-island)

const BUOY_ID = "44009";
const BUOY_NAME = "44009 — Delaware Bay Entrance (~38nm ESE of OC, MD)";
const BUOY_LAT = 38.46;
const BUOY_LNG = -74.692;
const BUOY_URL = `https://www.ndbc.noaa.gov/station_page.php?station=${BUOY_ID}`;
const NDBC_OBS_URL = `https://www.ndbc.noaa.gov/data/realtime2/${BUOY_ID}.txt`;

// Note: 44009 is a 3-meter discus buoy in 28m of water ~38nm ESE of Ocean City, MD.
// It is the closest active offshore NDBC buoy for OC Maryland coastal & offshore fishing.

// Thresholds for GO/MARGINAL/NO-GO
const WIND_GO = 20; // knots
const WIND_MARG = 30;
const WAVE_GO = 6; // feet
const WAVE_MARG = 9;
const VIS_GO = 3; // nm (not in NDBC feed — static for now)

interface BuoyData {
  windKt: number | null;
  windDir: string;
  waveHt_ft: number | null;
  wavePeriod: number | null;
  airTempF: number | null;
  waterTempF: number | null;
  pressureInHg: number | null;
  pressTrend: string;
  timestamp: string;
}

type LoadState = "idle" | "loading" | "ok" | "error";
type StatusType = "GO" | "MARGINAL" | "NO-GO";

function mpsToKt(mps: number): number {
  return Math.round(mps * 1.94384);
}
function mToFt(m: number): number {
  return parseFloat((m * 3.28084).toFixed(1));
}
function cToF(c: number): number {
  return parseFloat(((c * 9) / 5 + 32).toFixed(1));
}
function hPaToInHg(hpa: number): number {
  return parseFloat((hpa * 0.02953).toFixed(2));
}

function degToCompass(deg: number): string {
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

function parseNDBC(text: string): BuoyData {
  const lines = text.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
  // First non-header data line is the most recent observation
  const parts = lines[0]?.trim().split(/\s+/) ?? [];
  // NDBC column order: YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES ATMP WTMP DEWP VIS PTDY TIDE
  const get = (i: number): number | null => {
    const v = parseFloat(parts[i]);
    return isNaN(v) || v === 99 || v === 999 || v === 9999 ? null : v;
  };
  const wdir = get(5);
  const wspd = get(6); // m/s
  const wvht = get(8); // m
  const dpd = get(9); // seconds
  const pres = get(12); // hPa
  const atmp = get(13); // °C
  const wtmp = get(14); // °C
  const ptdy = get(17); // pressure tendency hPa/3hr

  const month = parts[1]?.padStart(2, "0") ?? "--";
  const day = parts[2]?.padStart(2, "0") ?? "--";
  const hour = parts[3]?.padStart(2, "0") ?? "--";
  const min = parts[4]?.padStart(2, "0") ?? "--";

  return {
    windKt: wspd !== null ? mpsToKt(wspd) : null,
    windDir: wdir !== null ? degToCompass(wdir) : "--",
    waveHt_ft: wvht !== null ? mToFt(wvht) : null,
    wavePeriod: dpd,
    airTempF: atmp !== null ? cToF(atmp) : null,
    waterTempF: wtmp !== null ? cToF(wtmp) : null,
    pressureInHg: pres !== null ? hPaToInHg(pres) : null,
    pressTrend:
      ptdy !== null
        ? ptdy > 0.5
          ? "Rising"
          : ptdy < -0.5
            ? "Falling"
            : "Steady"
        : "--",
    timestamp: `${month}/${day} ${hour}:${min} UTC`,
  };
}

function getStatus(d: BuoyData): StatusType {
  const wind = d.windKt ?? 0;
  const wave = d.waveHt_ft ?? 0;
  if (wind >= WIND_MARG || wave >= WAVE_MARG) return "NO-GO";
  if (wind >= WIND_GO || wave >= WAVE_GO) return "MARGINAL";
  return "GO";
}

// SST bbox for the buoy location (0.25° box — ~25km at 0.02° ACSPO resolution)
const BUOY_SST_BBOX = {
  minLat: BUOY_LAT - 0.25,
  maxLat: BUOY_LAT + 0.25,
  minLng: BUOY_LNG - 0.25,
  maxLng: BUOY_LNG + 0.25,
};

export default function Weather() {
  const [buoy, setBuoy] = useState<BuoyData | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string>("");
  const [expanded, setExpanded] = useState(false);
  const [sstResult, setSSTResult] = useState<SSTResult | null>(null);
  const [sstLoading, setSSTLoading] = useState(false);

  const fetchSST = async () => {
    setSSTLoading(true);
    try {
      const r = await getSSTBBoxCached(BUOY_SST_BBOX);
      setSSTResult(r);
    } finally {
      setSSTLoading(false);
    }
  };

  const fetchBuoy = async () => {
    setState("loading");
    setError("");
    try {
      // NDBC .txt files do NOT send CORS headers — route through a proxy
      const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(NDBC_OBS_URL)}`;
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const parsed = parseNDBC(text);
      setBuoy(parsed);
      setState("ok");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setState("error");
    }
  };

  useEffect(() => {
    fetchBuoy();
    fetchSST();
  }, []);

  const status: StatusType = buoy ? getStatus(buoy) : "GO";

  const conditions = buoy
    ? [
        {
          label: "Wind Speed",
          value: buoy.windKt !== null ? `${buoy.windKt} kt` : "--",
          threshold: `< ${WIND_GO} kt for GO`,
          status:
            (buoy.windKt ?? 0) < WIND_GO
              ? "ok"
              : (buoy.windKt ?? 0) < WIND_MARG
                ? "warn"
                : "no",
        },
        {
          label: "Wave Height",
          value: buoy.waveHt_ft !== null ? `${buoy.waveHt_ft} ft` : "--",
          threshold: `< ${WAVE_GO} ft for GO`,
          status:
            (buoy.waveHt_ft ?? 0) < WAVE_GO
              ? "ok"
              : (buoy.waveHt_ft ?? 0) < WAVE_MARG
                ? "warn"
                : "no",
        },
        {
          label: "Visibility",
          value: "10+ nm",
          threshold: `> ${VIS_GO} nm for GO`,
          status: "ok" as const,
        },
        {
          label: "Pressure Trend",
          value:
            buoy.pressureInHg !== null
              ? `${buoy.pressureInHg} inHg · ${buoy.pressTrend}`
              : "--",
          threshold: "Stable / Rising",
          status: buoy.pressTrend === "Falling" ? "warn" : "ok",
        },
      ]
    : [];

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Marine Weather</h2>
        <button
          onClick={fetchBuoy}
          disabled={state === "loading"}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-cyan-400 transition-colors disabled:opacity-50"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${state === "loading" ? "animate-spin" : ""}`}
          />
          Refresh
        </button>
      </div>

      {/* Source badges */}
      <div className="flex flex-col gap-1">
        <div className="flex items-start gap-1.5 text-xs text-slate-400">
          <Radio className="w-3 h-3 flex-shrink-0 text-cyan-500 mt-0.5" />
          <span className="leading-relaxed">
            NDBC Buoy{" "}
            <a
              href={BUOY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:underline break-all"
            >
              {BUOY_NAME}
            </a>
            {buoy && (
              <span className="text-slate-500"> · obs {buoy.timestamp}</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <MapPin className="w-3 h-3 flex-shrink-0" />
          <span>
            {BUOY_LAT}°N {Math.abs(BUOY_LNG)}°W · Real-time
          </span>
        </div>
      </div>

      {/* Loading */}
      {state === "loading" && (
        <div className="flex items-center justify-center py-10 gap-3 text-slate-400">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Fetching NDBC buoy data…</span>
        </div>
      )}

      {/* Error */}
      {state === "error" && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-400">
          <strong>Buoy fetch failed:</strong> {error}
          <br />
          <button onClick={fetchBuoy} className="mt-2 underline text-xs">
            Try again
          </button>
        </div>
      )}

      {/* GO/NO-GO — tap to expand */}
      {(state === "ok" || state === "error") && (
        <div
          className={`rounded-xl border cursor-pointer transition-all ${
            status === "GO"
              ? "bg-emerald-500/20 border-emerald-500/50"
              : status === "MARGINAL"
                ? "bg-amber-500/20 border-amber-500/50"
                : "bg-red-500/20 border-red-500/50"
          }`}
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center justify-between p-4">
            <div>
              <div className="text-sm text-slate-300 mb-1">
                Offshore Conditions
              </div>
              <div
                className={`text-3xl font-bold ${
                  status === "GO"
                    ? "text-emerald-400"
                    : status === "MARGINAL"
                      ? "text-amber-400"
                      : "text-red-400"
                }`}
              >
                {status}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Cloud className="w-10 h-10 text-slate-400" />
              {expanded ? (
                <ChevronUp className="w-5 h-5 text-slate-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-slate-400" />
              )}
            </div>
          </div>

          {expanded && conditions.length > 0 && (
            <div className="px-4 pb-4 border-t border-white/10 mt-1 pt-3 space-y-2">
              <div className="text-xs text-slate-400 mb-2 font-medium uppercase tracking-wide">
                Why {status}?
              </div>
              {conditions.map((c) => (
                <div
                  key={c.label}
                  className="flex items-center justify-between text-sm"
                >
                  <div className="flex items-center gap-2">
                    {c.status === "ok" && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    )}
                    {c.status === "warn" && (
                      <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    )}
                    {c.status === "no" && (
                      <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                    )}
                    <span className="text-slate-300">{c.label}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-white font-semibold">{c.value}</div>
                    <div className="text-xs text-slate-500">{c.threshold}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Conditions Grid */}
      {state === "ok" && buoy && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-800 rounded-xl p-3 border border-slate-700">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <Wind className="w-4 h-4" />
              <span className="text-xs">Wind</span>
            </div>
            <div className="text-xl font-bold text-white">
              {buoy.windKt !== null ? `${buoy.windKt} kt` : "--"}
            </div>
            <div className="text-xs text-slate-400">{buoy.windDir}</div>
          </div>

          <div className="bg-slate-800 rounded-xl p-3 border border-slate-700">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <Droplets className="w-4 h-4" />
              <span className="text-xs">Seas</span>
            </div>
            <div className="text-xl font-bold text-white">
              {buoy.waveHt_ft !== null ? `${buoy.waveHt_ft} ft` : "--"}
            </div>
            <div className="text-xs text-slate-400">
              {buoy.wavePeriod !== null ? `${buoy.wavePeriod}s period` : "--"}
            </div>
          </div>

          <div className="bg-slate-800 rounded-xl p-3 border border-slate-700">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <Eye className="w-4 h-4" />
              <span className="text-xs">Visibility</span>
            </div>
            <div className="text-xl font-bold text-white">10+ nm</div>
            <div className="text-xs text-slate-400">Clear (est.)</div>
          </div>

          <div className="bg-slate-800 rounded-xl p-3 border border-slate-700">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <Gauge className="w-4 h-4" />
              <span className="text-xs">Pressure</span>
            </div>
            <div className="text-xl font-bold text-white">
              {buoy.pressureInHg !== null ? `${buoy.pressureInHg}` : "--"}
            </div>
            <div className="text-xs text-slate-400">{buoy.pressTrend}</div>
          </div>

          <div className="bg-slate-800 rounded-xl p-3 border border-slate-700 col-span-2">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <Thermometer className="w-4 h-4" />
              <span className="text-xs">Temperature</span>
            </div>
            <div className="flex justify-between items-end">
              <div>
                <div className="text-xl font-bold text-white">
                  {buoy.airTempF !== null ? `${buoy.airTempF}°F` : "--"}
                </div>
                <div className="text-xs text-slate-400">Air</div>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold text-cyan-400">
                  {buoy.waterTempF !== null ? `${buoy.waterTempF}°F` : "--"}
                </div>
                <div className="text-xs text-slate-400">Water (in-situ)</div>
              </div>
            </div>
          </div>

          {/* Satellite SST card — ERDDAP high-res */}
          <div className="bg-slate-800 rounded-xl p-3 border border-slate-700 col-span-2">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-slate-400">
                <Satellite className="w-4 h-4" />
                <span className="text-xs">Satellite SST (ERDDAP)</span>
              </div>
              <button
                onClick={fetchSST}
                disabled={sstLoading}
                className="text-[10px] text-cyan-400 hover:text-cyan-300 disabled:opacity-40 flex items-center gap-1"
              >
                <RefreshCw
                  className={`w-2.5 h-2.5 ${sstLoading ? "animate-spin" : ""}`}
                />
                {sstLoading ? "Fetching…" : "Refresh"}
              </button>
            </div>

            {sstLoading && (
              <div className="flex items-center gap-2 text-slate-400 text-sm py-1">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span className="text-xs">Querying ERDDAP…</span>
              </div>
            )}

            {!sstLoading && sstResult?.ok && (
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-xl font-bold text-orange-400">
                    {sstResult.fahrenheit.toFixed(1)}°F
                    <span className="ml-1 text-sm text-slate-400 font-normal">
                      ({sstResult.celsius.toFixed(1)}°C)
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {sstResult.pixelCount} pixels averaged · last pass
                  </div>
                </div>
                <div className="text-right">
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border ${sstResult.resolution === "0.02deg" ? "bg-violet-500/15 border-violet-500/40 text-violet-300" : "bg-sky-500/15 border-sky-500/40 text-sky-300"}`}
                  >
                    {sstResult.resolution === "0.02deg"
                      ? "ACSPO L3S 0.02°"
                      : "MUR NRT 0.01°"}
                  </span>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {sstResult.resolution === "0.02deg"
                      ? "≈2 km/px · qual ≥4"
                      : "≈1 km/px · L4 blended"}
                  </div>
                </div>
              </div>
            )}

            {!sstLoading && sstResult && !sstResult.ok && (
              <div className="text-xs text-slate-500 py-1">
                Satellite SST unavailable ({sstResult.reason}) — buoy in-situ
                value shown above
              </div>
            )}

            {!sstLoading && !sstResult && (
              <div className="text-xs text-slate-500 py-1">
                Tap Refresh to fetch satellite SST for this location
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
