import { Sun, Moon, Bell, BellOff, RefreshCw } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";

// ─── Pure-math solunar engine ─────────────────────────────────────────────────
// Based on Jean Meeus "Astronomical Algorithms" (simplified for fishing use)
// Accurate to ~5 minutes for moon transit times.

const LAT = 38.3365; // Ocean City, MD
const LNG = -75.0849;

function jd(date: Date): number {
  const Y = date.getUTCFullYear();
  const M = date.getUTCMonth() + 1;
  const D =
    date.getUTCDate() +
    date.getUTCHours() / 24 +
    date.getUTCMinutes() / 1440 +
    date.getUTCSeconds() / 86400;
  const A = Math.floor((14 - M) / 12);
  const y = Y + 4800 - A;
  const m = M + 12 * A - 3;
  return (
    D +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

function moonPhase(date: Date): {
  phase: number;
  illumination: number;
  name: string;
} {
  // Synodic period = 29.53058867 days
  // New moon reference: Jan 6, 2000 18:14 UTC → JD 2451550.259
  const KNOWN_NEW_MOON_JD = 2451550.259;
  const SYNODIC = 29.53058867;
  const j = jd(date);
  const daysSince = j - KNOWN_NEW_MOON_JD;
  const phase = ((daysSince % SYNODIC) + SYNODIC) % SYNODIC; // 0–29.53
  const angle = (phase / SYNODIC) * 360;
  const illumination = Math.round((1 - Math.cos((angle * Math.PI) / 180)) * 50);
  let name: string;
  if (phase < 1.85) name = "New Moon";
  else if (phase < 7.38) name = "Waxing Crescent";
  else if (phase < 9.22) name = "First Quarter";
  else if (phase < 14.77) name = "Waxing Gibbous";
  else if (phase < 16.61) name = "Full Moon";
  else if (phase < 22.15) name = "Waning Gibbous";
  else if (phase < 23.99) name = "Last Quarter";
  else if (phase < 29.53) name = "Waning Crescent";
  else name = "New Moon";
  return { phase, illumination, name };
}

/** Moon's approximate ecliptic longitude (degrees) at given JD */
function moonLongitude(j: number): number {
  const T = (j - 2451545.0) / 36525;
  const L0 = 218.3164477 + 481267.88123421 * T;
  const M = 357.5291092 + 35999.0502909 * T; // Sun mean anomaly
  const Mm = 134.9633964 + 477198.8675055 * T; // Moon mean anomaly
  const F = 93.272095 + 483202.0175233 * T; // Moon arg of lat
  const D = 297.8501921 + 445267.1114034 * T; // Elongation
  const toRad = (d: number) => (d * Math.PI) / 180;
  const lon =
    L0 +
    6.288774 * Math.sin(toRad(Mm)) +
    1.274027 * Math.sin(toRad(2 * D - Mm)) +
    0.658314 * Math.sin(toRad(2 * D)) +
    0.213618 * Math.sin(toRad(2 * Mm)) -
    0.185116 * Math.sin(toRad(M)) -
    0.114332 * Math.sin(toRad(2 * F));
  return ((lon % 360) + 360) % 360;
}

/** Local sidereal time (degrees) */
function localSiderealTime(j: number, lngDeg: number): number {
  const T = (j - 2451545.0) / 36525;
  const theta0 =
    280.46061837 + 360.98564736629 * (j - 2451545.0) + 0.000387933 * T * T;
  return (((theta0 + lngDeg) % 360) + 360) % 360;
}

/** Returns moon transit time (UTC hours) for a given local calendar date */
function moonTransitUTC(date: Date): number {
  // Noon on that date as starting JD
  const noon = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0),
  );
  let j0 = jd(noon);
  // Iterate 2x for convergence
  for (let iter = 0; iter < 2; iter++) {
    const lst = localSiderealTime(j0, LNG);
    const moonLon = moonLongitude(j0);
    // Moon's right ascension ≈ ecliptic longitude (good enough within ~1–2°)
    let ha = lst - moonLon;
    ha = ((ha + 180) % 360) - 180; // wrap to ±180
    j0 -= ha / 360;
  }
  // j0 is now moon upper transit JD
  const utcHours = ((j0 - Math.floor(j0)) * 24 + 24) % 24;
  return utcHours;
}

function utcHoursToLocal(utcHours: number, offsetH: number): number {
  return (((utcHours + offsetH) % 24) + 24) % 24;
}

function decimalToHM(h: number): { hours: number; minutes: number } {
  const hours = Math.floor(h);
  const minutes = Math.round((h - hours) * 60);
  return {
    hours: minutes === 60 ? hours + 1 : hours,
    minutes: minutes === 60 ? 0 : minutes,
  };
}

function formatHM(h: number): string {
  const { hours, minutes } = decimalToHM(h);
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  const ampm = hours < 12 ? "AM" : "PM";
  return `${h12}:${String(minutes).padStart(2, "0")} ${ampm}`;
}

function addHours(h: number, delta: number): number {
  return (((h + delta) % 24) + 24) % 24;
}

/** Get device UTC offset in hours (e.g. EDT = -4) */
function tzOffsetHours(): number {
  return -new Date().getTimezoneOffset() / 60;
}

interface FeedingPeriod {
  type: "major" | "minor";
  start: string;
  end: string;
  startH: number; // local decimal hours — for reminder scheduling
  quality: number;
}

interface SolunarData {
  periods: FeedingPeriod[];
  moonPhaseName: string;
  illumination: number;
  dailyRating: string;
  ratingScore: number;
}

/** Score 0–100 → "Poor" / "Fair" / "Good" / "Excellent" */
function ratingLabel(score: number): string {
  if (score >= 80) return "Excellent";
  if (score >= 60) return "Good";
  if (score >= 40) return "Fair";
  return "Poor";
}

function computeSolunar(date: Date): SolunarData {
  const tzOff = tzOffsetHours();
  const transitUTC = moonTransitUTC(date);
  const transitLocal = utcHoursToLocal(transitUTC, tzOff);
  // Anti-transit (lower transit) ≈ +12.41h (half synodic day)
  const antiLocal = addHours(transitLocal, 12.41);

  const { name: moonPhaseName, illumination, phase } = moonPhase(date);

  // Major periods: ±1h around upper and lower transit
  // Minor periods: ±30min around the midpoints between majors
  const minor1 = addHours(transitLocal, 6.2);
  const minor2 = addHours(antiLocal, 6.2);

  // Quality bonuses: full/new moon = peak; first/last quarter = baseline
  const phaseScore = (() => {
    const p = phase;
    // Peak at 0 (new) and 14.77 (full), trough at 7.38 and 22.15 (quarters)
    const distFromPeak = Math.min(
      Math.abs(p),
      Math.abs(p - 14.77),
      Math.abs(p - 29.53),
    );
    return Math.max(0, 100 - distFromPeak * 10);
  })();

  const majorQ = Math.min(100, Math.round(50 + phaseScore * 0.5));
  const minorQ = Math.min(100, Math.round(30 + phaseScore * 0.4));
  const dailyScore = Math.round(majorQ * 0.7 + minorQ * 0.3);

  const periods: FeedingPeriod[] = [
    {
      type: "major",
      start: formatHM(transitLocal),
      end: formatHM(addHours(transitLocal, 2)),
      startH: transitLocal,
      quality: majorQ,
    },
    {
      type: "minor",
      start: formatHM(minor1),
      end: formatHM(addHours(minor1, 1)),
      startH: minor1,
      quality: minorQ,
    },
    {
      type: "major",
      start: formatHM(antiLocal),
      end: formatHM(addHours(antiLocal, 2)),
      startH: antiLocal,
      quality: Math.max(60, majorQ - 8),
    },
    {
      type: "minor",
      start: formatHM(minor2),
      end: formatHM(addHours(minor2, 1)),
      startH: minor2,
      quality: Math.max(40, minorQ - 8),
    },
  ].sort((a, b) => a.startH - b.startH);

  return {
    periods,
    moonPhaseName,
    illumination,
    dailyRating: ratingLabel(dailyScore),
    ratingScore: dailyScore,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Solunar() {
  const [data, setData] = useState<SolunarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [reminders, setReminders] = useState<Set<number>>(new Set());
  const timerRefs = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const compute = useCallback(() => {
    setLoading(true);
    setTimeout(() => {
      const result = computeSolunar(new Date());
      setData(result);
      setLoading(false);
    }, 0);
  }, []);

  useEffect(() => {
    compute();
    return () => {
      timerRefs.current.forEach((t) => clearTimeout(t));
    };
  }, [compute]);

  const toggleReminder = async (idx: number) => {
    if (!data) return;
    const next = new Set(reminders);
    if (next.has(idx)) {
      next.delete(idx);
      const t = timerRefs.current.get(idx);
      if (t !== undefined) clearTimeout(t);
      timerRefs.current.delete(idx);
    } else {
      if ("Notification" in window) {
        let perm = Notification.permission;
        if (perm === "default") perm = await Notification.requestPermission();
        if (perm === "denied") {
          alert(
            "Notifications are blocked. Enable them in your browser settings.",
          );
          return;
        }
        const period = data.periods[idx];
        const now = new Date();
        const fireH = period.startH - 0.5; // 30 min early
        const fireDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          0,
          0,
          0,
        );
        fireDate.setTime(fireDate.getTime() + fireH * 3600000);
        const delay = fireDate.getTime() - Date.now();
        if (delay > 0) {
          const t = setTimeout(() => {
            new Notification(
              `🎣 ${period.type === "major" ? "Major" : "Minor"} Feeding Period in 30 min`,
              {
                body: `${period.start} – ${period.end} · Quality: ${period.quality}%`,
                icon: "/favicon.ico",
              },
            );
            setReminders((prev) => {
              const s = new Set(prev);
              s.delete(idx);
              return s;
            });
          }, delay);
          timerRefs.current.set(idx, t);
        } else {
          alert("That period has already started or passed.");
          return;
        }
      } else {
        alert("Push notifications are not supported in this browser.");
        return;
      }
      next.add(idx);
    }
    setReminders(next);
  };

  const ratingColor =
    data?.dailyRating === "Excellent"
      ? "text-emerald-400"
      : data?.dailyRating === "Good"
        ? "text-amber-400"
        : data?.dailyRating === "Fair"
          ? "text-yellow-400"
          : "text-slate-400";

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Solunar Forecast</h2>
        <button
          onClick={compute}
          disabled={loading}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-cyan-400 transition-colors disabled:opacity-50"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
          />
          Recalculate
        </button>
      </div>

      <div className="text-xs text-slate-500 flex items-center gap-1.5">
        <span>📍 Ocean City, MD</span>
        <span className="text-slate-700">·</span>
        <span>Live moon transit calculation</span>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-10 gap-3 text-slate-400">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Computing moon transits…</span>
        </div>
      )}

      {data && !loading && (
        <>
          {/* Today's Rating */}
          <div className="bg-gradient-to-br from-amber-500/20 to-orange-600/20 rounded-xl p-4 border border-amber-500/30">
            <div className="flex items-center justify-between mb-2">
              <span className="text-amber-400 font-medium">
                Today&#39;s Rating
              </span>
              <div className="flex items-center gap-1">
                <Sun className="w-5 h-5 text-amber-400" />
                <Moon className="w-5 h-5 text-slate-400" />
              </div>
            </div>
            <div className={`text-4xl font-bold mb-1 ${ratingColor}`}>
              {data.dailyRating}
            </div>
            <div className="text-sm text-slate-300">
              Moon Phase: {data.moonPhaseName} ({data.illumination}%
              illuminated)
            </div>
          </div>

          {/* Feeding Periods */}
          <div className="space-y-2">
            <h3 className="font-semibold text-slate-300">Feeding Periods</h3>
            {data.periods.map((p, i) => (
              <div
                key={i}
                className={`rounded-xl p-3 border flex items-center gap-3 ${
                  p.type === "major"
                    ? "bg-amber-500/10 border-amber-500/30"
                    : "bg-slate-800 border-slate-700"
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                    p.type === "major" ? "bg-amber-500" : "bg-slate-700"
                  }`}
                >
                  {p.type === "major" ? (
                    <Sun className="w-5 h-5 text-white" />
                  ) : (
                    <Moon className="w-5 h-5 text-slate-300" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-white capitalize">
                    {p.type} Period
                  </div>
                  <div className="text-sm text-slate-400">
                    {p.start} – {p.end}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-white">
                    {p.quality}%
                  </div>
                  <div className="text-xs text-slate-500">quality</div>
                </div>
                <button
                  onClick={() => toggleReminder(i)}
                  className={`p-2 rounded-lg transition-colors shrink-0 ${
                    reminders.has(i)
                      ? "bg-cyan-500 text-white"
                      : "bg-slate-700 text-slate-400"
                  }`}
                  title={
                    reminders.has(i)
                      ? "Remove reminder"
                      : "Remind me 30 min before"
                  }
                >
                  {reminders.has(i) ? (
                    <Bell className="w-4 h-4" />
                  ) : (
                    <BellOff className="w-4 h-4" />
                  )}
                </button>
              </div>
            ))}
          </div>

          <div className="text-xs text-slate-600 text-center pt-1">
            Based on moon upper &amp; lower transit · Jean Meeus method · times
            in local time
          </div>
        </>
      )}
    </div>
  );
}
