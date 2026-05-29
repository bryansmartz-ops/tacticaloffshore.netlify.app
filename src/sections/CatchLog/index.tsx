import { useState, useRef } from "react";
import {
  Plus,
  Fish,
  Ruler,
  Scale,
  MapPin,
  Calendar,
  Trash2,
  BarChart3,
  Trophy,
  Navigation,
  Loader2,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { useQuery, useMutation } from "@animaapp/playground-react-sdk";
import type { CatchEntry } from "@animaapp/playground-react-sdk";

const SPECIES = [
  "Yellowfin Tuna",
  "Bluefin Tuna",
  "Mahi Mahi",
  "Wahoo",
  "White Marlin",
  "Blue Marlin",
  "Swordfish",
  "Bigeye Tuna",
  "Striped Bass",
  "Other",
];
const COLORS = [
  "#f59e0b",
  "#3b82f6",
  "#10b981",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
  "#f97316",
  "#6366f1",
  "#64748b",
];

export default function CatchLog() {
  const [showForm, setShowForm] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [form, setForm] = useState({
    species: SPECIES[0],
    weight: "",
    length: "",
    notes: "",
  });
  const [gpsState, setGpsState] = useState<"idle" | "loading" | "ok" | "err">(
    "idle",
  );
  const gpsRef = useRef<{ lat: number; lng: number } | null>(null);

  const {
    data: catches,
    isPending,
    error: loadError,
  } = useQuery("CatchEntry", {
    orderBy: { date: "desc" },
  });

  const {
    create,
    remove,
    isPending: isMutating,
    error: mutationError,
  } = useMutation("CatchEntry");

  const grabGPS = () => {
    if (!navigator.geolocation) {
      setGpsState("err");
      return;
    }
    setGpsState("loading");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        gpsRef.current = {
          lat: parseFloat(pos.coords.latitude.toFixed(5)),
          lng: parseFloat(pos.coords.longitude.toFixed(5)),
        };
        setGpsState("ok");
      },
      () => setGpsState("err"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const saveCatch = async () => {
    try {
      await create({
        species: form.species,
        weight: form.weight ? parseFloat(form.weight) : undefined,
        length: form.length ? parseFloat(form.length) : undefined,
        lat: gpsRef.current?.lat,
        lng: gpsRef.current?.lng,
        date: new Date(),
        notes: form.notes || undefined,
      });
      setForm({ species: SPECIES[0], weight: "", length: "", notes: "" });
      gpsRef.current = null;
      setGpsState("idle");
      setShowForm(false);
    } catch {
      // mutationError state handled below
    }
  };

  const deleteCatch = async (id: string) => {
    await remove(id);
  };

  const allCatches: CatchEntry[] = catches ?? [];

  // Stats calculations
  const speciesCount = allCatches.reduce(
    (acc, c) => {
      acc[c.species] = (acc[c.species] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const chartData = Object.entries(speciesCount).map(([species, count]) => ({
    species: species.split(" ")[0],
    count,
    color: COLORS[SPECIES.indexOf(species)] || COLORS[9],
  }));

  const heaviest = allCatches
    .filter((c) => c.weight)
    .sort((a, b) => (b.weight || 0) - (a.weight || 0))[0];
  const longest = allCatches
    .filter((c) => c.length)
    .sort((a, b) => (b.length || 0) - (a.length || 0))[0];

  if (isPending) {
    return (
      <div className="p-4 flex items-center justify-center h-40">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-4 text-red-400 text-sm">
        Error loading catches: {loadError.message}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Catch Log</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowStats(!showStats)}
            className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700"
          >
            <BarChart3 className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="p-2 rounded-lg bg-cyan-600 text-white hover:bg-cyan-500"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
      </div>

      {mutationError && (
        <div className="text-red-400 text-xs bg-red-500/10 rounded-lg px-3 py-2">
          {mutationError.message}
        </div>
      )}

      {/* Stats Panel */}
      {showStats && allCatches.length > 0 && (
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 space-y-4">
          <h3 className="font-semibold text-white flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-400" /> Stats
          </h3>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <XAxis
                  dataKey="species"
                  tick={{ fill: "#94a3b8", fontSize: 10 }}
                />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {heaviest && (
              <div className="bg-slate-700/50 rounded-lg p-2">
                <div className="text-slate-400 text-xs">Heaviest</div>
                <div className="font-semibold text-white">
                  {heaviest.weight} lbs
                </div>
                <div className="text-xs text-cyan-400">{heaviest.species}</div>
              </div>
            )}
            {longest && (
              <div className="bg-slate-700/50 rounded-lg p-2">
                <div className="text-slate-400 text-xs">Longest</div>
                <div className="font-semibold text-white">
                  {longest.length}&quot;
                </div>
                <div className="text-xs text-cyan-400">{longest.species}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Form */}
      {showForm && (
        <div className="bg-slate-800 rounded-xl p-4 border border-cyan-500/50 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="font-semibold text-white">Log a Catch</h3>
            <button
              type="button"
              onClick={grabGPS}
              className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition-all flex-shrink-0 ${
                gpsState === "ok"
                  ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400"
                  : gpsState === "err"
                    ? "bg-red-500/20 border-red-500/50 text-red-400"
                    : gpsState === "loading"
                      ? "bg-slate-700 border-slate-600 text-slate-400"
                      : "bg-slate-700 border-slate-600 text-slate-300 hover:border-cyan-500 hover:text-cyan-400"
              }`}
            >
              {gpsState === "loading" ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Navigation className="w-3 h-3" />
              )}
              {gpsState === "ok" && gpsRef.current
                ? `${gpsRef.current.lat.toFixed(3)}°N`
                : gpsState === "err"
                  ? "GPS error"
                  : gpsState === "loading"
                    ? "Locating…"
                    : "Stamp GPS"}
            </button>
          </div>
          <select
            value={form.species}
            onChange={(e) => setForm({ ...form, species: e.target.value })}
            className="w-full p-2 rounded-lg bg-slate-700 border border-slate-600 text-white text-sm"
          >
            {SPECIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <input
              type="number"
              placeholder="Weight (lbs)"
              value={form.weight}
              onChange={(e) => setForm({ ...form, weight: e.target.value })}
              className="p-2 rounded-lg bg-slate-700 border border-slate-600 text-white placeholder-slate-400"
            />
            <input
              type="number"
              placeholder="Length (in)"
              value={form.length}
              onChange={(e) => setForm({ ...form, length: e.target.value })}
              className="p-2 rounded-lg bg-slate-700 border border-slate-600 text-white placeholder-slate-400"
            />
          </div>
          <textarea
            placeholder="Notes..."
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="w-full p-2 rounded-lg bg-slate-700 border border-slate-600 text-white placeholder-slate-400 resize-none"
            rows={2}
          />
          <div className="flex gap-2">
            <button
              onClick={() => setShowForm(false)}
              className="flex-1 p-2 rounded-lg bg-slate-700 text-slate-300"
            >
              Cancel
            </button>
            <button
              onClick={saveCatch}
              disabled={isMutating}
              className="flex-1 p-2 rounded-lg bg-cyan-600 text-white font-semibold disabled:opacity-60"
            >
              {isMutating ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      {/* Catch List */}
      {allCatches.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Fish className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p>No catches logged yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {allCatches.map((c) => (
            <div
              key={c.id}
              className="bg-slate-800 rounded-xl p-3 border border-slate-700 flex items-center gap-3"
            >
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
                <Fish className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-white truncate">
                  {c.species}
                </div>
                <div className="text-xs text-slate-400 flex items-center gap-2 flex-wrap">
                  {c.weight && (
                    <span className="flex items-center gap-0.5">
                      <Scale className="w-3 h-3" />
                      {c.weight} lbs
                    </span>
                  )}
                  {c.length && (
                    <span className="flex items-center gap-0.5">
                      <Ruler className="w-3 h-3" />
                      {c.length}&quot;
                    </span>
                  )}
                  {c.lat != null && c.lng != null && (
                    <span className="flex items-center gap-0.5 text-cyan-400">
                      <MapPin className="w-3 h-3" />
                      {(c.lat as number).toFixed(3)}°N{" "}
                      {Math.abs(c.lng as number).toFixed(3)}°W
                    </span>
                  )}
                  <span className="flex items-center gap-0.5">
                    <Calendar className="w-3 h-3" />
                    {new Date(c.date).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <button
                onClick={() => deleteCatch(c.id)}
                disabled={isMutating}
                className="p-2 text-slate-500 hover:text-red-400 disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
