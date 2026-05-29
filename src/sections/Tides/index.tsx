import {
  Waves,
  TrendingUp,
  TrendingDown,
  Bell,
  BellOff,
  RefreshCw,
  MapPin,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";

// ─── NOAA Station ────────────────────────────────────────────────────────────
const STATION_ID = "8570283";
const STATION_NAME = "Ocean City Inlet, MD";
const STATION_URL = "https://tidesandcurrents.noaa.gov";

interface TideEvent {
  type: "H" | "L";
  time: string; // "HH:MM" 24-hr
  height: number; // feet
}

type LoadState = "idle" | "loading" | "ok" | "error";

function formatTime(t: string): string {
  // t is "YYYY-MM-DD HH:MM" from NOAA API
  const parts = t.split(" ");
  if (parts.length < 2) return t;
  const [h, m] = parts[1].split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function parseToDate(t: string): Date {
  // "YYYY-MM-DD HH:MM"
  const [datePart, timePart] = t.split(" ");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi] = timePart.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi, 0);
}

export default function Tides() {
  const [tides, setTides] = useState<TideEvent[]>([]);
  const [rawJson, setRawJson] = useState<
    { t: string; v: string; type: string }[]
  >([]);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string>("");
  const [reminders, setReminders] = useState<Set<number>>(new Set());
  const timerRefs = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  };

  const fetchTides = async () => {
    setState("loading");
    setError("");
    try {
      const dateStr = today();
      const url =
        `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter` +
        `?begin_date=${dateStr}&end_date=${dateStr}` +
        `&station=${STATION_ID}&product=predictions&datum=MLLW` +
        `&time_zone=lst_ldt&interval=hilo&units=english&application=TacticalFish&format=json`;

      const res = await fetch(url);
      const json = await res.json();

      if (json.error) throw new Error(json.error.message || "NOAA error");

      const predictions: { t: string; v: string; type: string }[] =
        json.predictions ?? [];
      setRawJson(predictions);
      const parsed: TideEvent[] = predictions.map((p) => ({
        type: p.type as "H" | "L",
        time: p.t,
        height: parseFloat(parseFloat(p.v).toFixed(1)),
      }));
      setTides(parsed);
      setState("ok");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      setState("error");
    }
  };

  useEffect(() => {
    fetchTides();
    return () => {
      timerRefs.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  const nextTide: TideEvent | null = (() => {
    const now = Date.now();
    for (const t of tides) {
      if (parseToDate(t.time).getTime() > now) return t;
    }
    return tides[0] ?? null;
  })();

  const toggleReminder = async (idx: number) => {
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
          alert("Notifications blocked. Enable them in browser settings.");
          return;
        }
        const tide = tides[idx];
        const tDate = parseToDate(tide.time);
        const fireAt = new Date(tDate.getTime() - 30 * 60 * 1000);
        const delay = fireAt.getTime() - Date.now();
        if (delay > 0) {
          const t = setTimeout(() => {
            new Notification(
              `🌊 ${tide.type === "H" ? "High" : "Low"} Tide in 30 min`,
              {
                body: `${formatTime(tide.time)} · ${tide.height} ft`,
                icon: "/favicon.ico",
              },
            );
            const cleaned = new Set(reminders);
            cleaned.delete(idx);
            setReminders(cleaned);
          }, delay);
          timerRefs.current.set(idx, t);
        } else {
          alert("That tide has already passed or is less than 30 min away.");
          return;
        }
      } else {
        alert("Push notifications not supported in this browser.");
        return;
      }
      next.add(idx);
    }
    setReminders(next);
  };

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Tide Schedule</h2>
        <button
          onClick={fetchTides}
          disabled={state === "loading"}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-cyan-400 transition-colors disabled:opacity-50"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${state === "loading" ? "animate-spin" : ""}`}
          />
          Refresh
        </button>
      </div>

      {/* Source badge */}
      <div className="flex items-center gap-1.5 text-xs text-slate-400">
        <MapPin className="w-3 h-3 flex-shrink-0 text-cyan-500" />
        <span>
          NOAA Station {STATION_ID} —{" "}
          <a
            href={`${STATION_URL}/stationhome.html?id=${STATION_ID}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-400 hover:underline"
          >
            {STATION_NAME}
          </a>
          {" · "}Datum: MLLW · Local time
        </span>
      </div>

      {/* Loading */}
      {state === "loading" && (
        <div className="flex items-center justify-center py-10 gap-3 text-slate-400">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Loading tides from NOAA…</span>
        </div>
      )}

      {/* Error */}
      {state === "error" && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-400">
          <strong>Failed to load tides:</strong> {error}
          <br />
          <button onClick={fetchTides} className="mt-2 underline text-xs">
            Try again
          </button>
        </div>
      )}

      {/* Next Tide */}
      {state === "ok" && nextTide && (
        <div className="bg-gradient-to-br from-blue-500/20 to-cyan-600/20 rounded-xl p-4 border border-blue-500/30">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-blue-400 font-medium mb-1">Next Tide</div>
              <div className="text-3xl font-bold text-white">
                {nextTide.type === "H" ? "High" : "Low"} Tide
              </div>
              <div className="text-lg text-slate-300">
                {formatTime(nextTide.time)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-4xl font-bold text-cyan-400">
                {nextTide.height}
              </div>
              <div className="text-sm text-slate-400">feet</div>
            </div>
          </div>
        </div>
      )}

      {/* Tide List */}
      {state === "ok" && tides.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-semibold text-slate-300">Today&#39;s Tides</h3>
          {tides.map((t, i) => (
            <div
              key={i}
              className="bg-slate-800 rounded-xl p-3 border border-slate-700 flex items-center gap-2 sm:gap-3"
            >
              <div
                className={`w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  t.type === "H" ? "bg-blue-500" : "bg-slate-700"
                }`}
              >
                {t.type === "H" ? (
                  <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                ) : (
                  <TrendingDown className="w-4 h-4 sm:w-5 sm:h-5 text-slate-300" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-white text-sm sm:text-base">
                  {t.type === "H" ? "High" : "Low"} Tide
                </div>
                <div className="text-xs text-slate-400">
                  {formatTime(t.time)}
                </div>
              </div>
              <div className="text-base sm:text-lg font-bold text-white whitespace-nowrap">
                {t.height} ft
              </div>
              <button
                onClick={() => toggleReminder(i)}
                className={`p-2 rounded-lg transition-colors flex-shrink-0 min-w-[36px] min-h-[36px] flex items-center justify-center ${
                  reminders.has(i)
                    ? "bg-cyan-500 text-white"
                    : "bg-slate-700 text-slate-400"
                }`}
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
      )}

      {state === "ok" && tides.length === 0 && (
        <div className="text-slate-400 text-sm text-center py-6">
          No tide predictions returned for today.
        </div>
      )}
    </div>
  );
}
