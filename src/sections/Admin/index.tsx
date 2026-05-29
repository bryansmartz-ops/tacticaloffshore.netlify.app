import { useState } from "react";
import {
  ShieldCheck,
  KeyRound,
  Copy,
  Trash2,
  RefreshCw,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  Activity,
  Fish,
  Zap,
} from "lucide-react";
import { useQuery, useMutation } from "@animaapp/playground-react-sdk";
import type {
  ActivationCode,
  HotspotLog,
} from "@animaapp/playground-react-sdk";

const ADMIN_PASSWORD = "offshore2024!";

function generateCode(): string {
  const seg = () => Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${seg()}-${seg()}-${seg()}`;
}

function formatDate(d: Date | string) {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminPanel() {
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState("");
  const [pwErr, setPwErr] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [activeTab, setActiveTab] = useState<"codes" | "scans">("codes");

  const [note, setNote] = useState("");
  const [expires, setExpires] = useState("");
  const [qty, setQty] = useState(1);
  const [copied, setCopied] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "unused" | "used">("all");

  const {
    data: codes,
    isPending,
    error: loadError,
  } = useQuery("ActivationCode", {
    orderBy: { createdAt: "desc" },
  });

  const {
    create,
    remove,
    isPending: isMutating,
    error: mutationError,
  } = useMutation("ActivationCode");

  const {
    data: scanLogs,
    isPending: scansLoading,
    error: scansError,
  } = useQuery("HotspotLog", {
    orderBy: { timestamp: "desc" },
    limit: 50,
  });

  // ── auth gate ────────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center gap-3 mb-8">
            <div className="w-16 h-16 rounded-2xl bg-cyan-500/20 flex items-center justify-center">
              <ShieldCheck className="w-8 h-8 text-cyan-400" />
            </div>
            <h1 className="text-2xl font-bold text-white">Admin Console</h1>
            <p className="text-slate-400 text-sm text-center">
              Tactical Offshore access-code management
            </p>
          </div>

          <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 space-y-4">
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type={showPw ? "text" : "password"}
                placeholder="Admin password"
                value={pw}
                onChange={(e) => {
                  setPw(e.target.value);
                  setPwErr(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (pw === ADMIN_PASSWORD) setAuthed(true);
                    else setPwErr(true);
                  }
                }}
                className={`w-full bg-slate-700 border rounded-xl pl-10 pr-10 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 ${pwErr ? "border-red-500 focus:ring-red-500" : "border-slate-600 focus:ring-cyan-500"}`}
              />
              <button
                onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                {showPw ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
            {pwErr && (
              <p className="text-red-400 text-xs">Incorrect password</p>
            )}
            <button
              onClick={() => {
                if (pw === ADMIN_PASSWORD) setAuthed(true);
                else setPwErr(true);
              }}
              className="w-full bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-bold py-3 rounded-xl transition-colors"
            >
              Enter
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── scan history helpers ─────────────────────────────────────────────────
  function breakIntensity(breaks: number, grid: number): string {
    if (grid === 0) return "none";
    const pct = breaks / grid;
    if (pct >= 0.4) return "strong";
    if (pct >= 0.2) return "moderate";
    return "weak";
  }

  function intensityStyle(level: string) {
    if (level === "strong")
      return {
        badge: "bg-emerald-500/20 text-emerald-400 border-emerald-500/40",
        dot: "bg-emerald-400",
      };
    if (level === "moderate")
      return {
        badge: "bg-amber-500/20 text-amber-400 border-amber-500/40",
        dot: "bg-amber-400",
      };
    return {
      badge: "bg-slate-600/40 text-slate-400 border-slate-600",
      dot: "bg-slate-500",
    };
  }

  // ── generate ─────────────────────────────────────────────────────────────
  async function handleGenerate() {
    for (let i = 0; i < qty; i++) {
      await create({
        code: generateCode(),
        status: "active",
        note: note.trim() || undefined,
        expires: expires ? new Date(expires) : undefined,
      });
    }
    setNote("");
    setExpires("");
    setQty(1);
  }

  async function handleDelete(id: string) {
    await remove(id);
  }

  function handleCopy(code: string) {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  }

  function handleCopyAll() {
    const unused = (codes ?? []).filter((c) => !c.usedBy).map((c) => c.code);
    navigator.clipboard.writeText(unused.join("\n")).catch(() => {});
    setCopied("__all__");
    setTimeout(() => setCopied(null), 2000);
  }

  const allScans: HotspotLog[] = scanLogs ?? [];
  const allCodes: ActivationCode[] = codes ?? [];

  const filtered = allCodes.filter((c) => {
    if (filter === "unused") return !c.usedBy;
    if (filter === "used") return !!c.usedBy;
    return true;
  });

  const unusedCount = allCodes.filter((c) => !c.usedBy).length;
  const usedCount = allCodes.filter((c) => c.usedBy).length;

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 pb-20">
      {/* header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Admin Console</h1>
            <p className="text-xs text-slate-400">
              Tactical Offshore management
            </p>
          </div>
        </div>
        <button
          onClick={() => setAuthed(false)}
          className="text-xs text-slate-500 hover:text-red-400 transition-colors"
        >
          Sign out
        </button>
      </div>

      {/* tab bar */}
      <div className="flex gap-1 bg-slate-800 rounded-xl p-1 border border-slate-700 mb-5">
        <button
          onClick={() => setActiveTab("codes")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-colors ${activeTab === "codes" ? "bg-cyan-500 text-slate-900" : "text-slate-400 hover:text-white"}`}
        >
          <KeyRound className="w-4 h-4" /> Access Codes
        </button>
        <button
          onClick={() => setActiveTab("scans")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-colors ${activeTab === "scans" ? "bg-cyan-500 text-slate-900" : "text-slate-400 hover:text-white"}`}
        >
          <Activity className="w-4 h-4" /> Scan History
          {allScans.length > 0 && (
            <span className="ml-1 bg-slate-700 text-slate-300 text-xs px-1.5 rounded-full">
              {allScans.length}
            </span>
          )}
        </button>
      </div>

      {/* ── SCAN HISTORY TAB ─────────────────────────────────────────── */}
      {activeTab === "scans" && (
        <div>
          {scansLoading && (
            <div className="text-slate-400 text-sm text-center py-10">
              Loading scan history…
            </div>
          )}
          {scansError && (
            <div className="text-red-400 text-sm text-center py-4">
              Error: {scansError.message}
            </div>
          )}
          {!scansLoading && allScans.length === 0 && (
            <div className="text-center text-slate-500 py-16 text-sm space-y-2">
              <Activity className="w-10 h-10 mx-auto text-slate-600 mb-3" />
              <p>No scan logs yet.</p>
              <p className="text-xs text-slate-600">
                Logs appear here after the scheduled ERDDAP scan runs (twice
                daily).
              </p>
            </div>
          )}
          {!scansLoading && allScans.length > 0 && (
            <>
              {/* summary stats */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  {
                    label: "Total Scans",
                    value: allScans.length,
                    color: "text-white",
                  },
                  {
                    label: "Avg Hotspots",
                    value: Math.round(
                      allScans.reduce((a, s) => a + s.hotspotsCount, 0) /
                        allScans.length,
                    ),
                    color: "text-emerald-400",
                  },
                  {
                    label: "Avg Breaks",
                    value: Math.round(
                      allScans.reduce((a, s) => a + s.breaksFound, 0) /
                        allScans.length,
                    ),
                    color: "text-amber-400",
                  },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="bg-slate-800 rounded-xl p-3 border border-slate-700 text-center"
                  >
                    <div className={`text-2xl font-bold ${s.color}`}>
                      {s.value}
                    </div>
                    <div className="text-xs text-slate-400">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* scan list */}
              <div className="space-y-2">
                {allScans.map((scan) => {
                  const intensity = breakIntensity(
                    scan.breaksFound,
                    scan.gridPoints,
                  );
                  const style = intensityStyle(intensity);
                  return (
                    <div
                      key={scan.id}
                      className="bg-slate-800 rounded-xl p-3 border border-slate-700"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${style.badge}`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${style.dot}`}
                              />
                              {intensity} break
                            </span>
                            <span className="text-xs bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                              <Fish className="w-3 h-3" />
                              {scan.targetSpecies}
                            </span>
                            {scan.source && (
                              <span className="text-[10px] text-slate-500">
                                {scan.source}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-400">
                            <span className="flex items-center gap-1">
                              <Zap className="w-3 h-3 text-amber-400" />
                              {scan.breaksFound} breaks / {scan.gridPoints} pts
                            </span>
                            <span className="flex items-center gap-1">
                              <Target className="w-3 h-3 text-orange-400" />
                              {scan.hotspotsCount} hotspots
                            </span>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-xs text-slate-300">
                            {formatDate(scan.timestamp)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── CODES TAB ────────────────────────────────────────────────── */}
      {activeTab === "codes" && (
        <>
          {/* loading / error */}
          {isPending && (
            <div className="text-slate-400 text-sm text-center py-6">
              Loading codes…
            </div>
          )}
          {loadError && (
            <div className="text-red-400 text-sm text-center py-4">
              Error loading codes: {loadError.message}
            </div>
          )}
          {mutationError && (
            <div className="text-red-400 text-xs text-center mb-3">
              {mutationError.message}
            </div>
          )}

          {/* stats */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            {[
              { label: "Total", value: allCodes.length, color: "text-white" },
              {
                label: "Unused",
                value: unusedCount,
                color: "text-emerald-400",
              },
              { label: "Used", value: usedCount, color: "text-amber-400" },
            ].map((s) => (
              <div
                key={s.label}
                className="bg-slate-800 rounded-xl p-3 border border-slate-700 text-center"
              >
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-slate-400">{s.label}</div>
              </div>
            ))}
          </div>

          {/* generator */}
          <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700 mb-6 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <KeyRound className="w-4 h-4 text-cyan-400" />
              <span className="font-semibold text-sm">Generate Codes</span>
            </div>

            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-slate-400 mb-1 block">
                  Note (optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Beta tester batch 1"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>
              <div className="w-20">
                <label className="text-xs text-slate-400 mb-1 block">Qty</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={qty}
                  onChange={(e) =>
                    setQty(Math.min(50, Math.max(1, Number(e.target.value))))
                  }
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-400 mb-1 block">
                Expires (optional)
              </label>
              <input
                type="date"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
                className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>

            <button
              onClick={handleGenerate}
              disabled={isMutating}
              className="w-full flex items-center justify-center gap-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-60 text-slate-900 font-bold py-3 rounded-xl transition-colors"
            >
              <RefreshCw
                className={`w-4 h-4 ${isMutating ? "animate-spin" : ""}`}
              />
              Generate {qty > 1 ? `${qty} Codes` : "Code"}
            </button>
          </div>

          {/* filter + copy all */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex gap-1 bg-slate-800 rounded-lg p-1 border border-slate-700">
              {(["all", "unused", "used"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors capitalize ${filter === f ? "bg-cyan-500 text-slate-900" : "text-slate-400 hover:text-white"}`}
                >
                  {f}
                </button>
              ))}
            </div>
            {unusedCount > 0 && (
              <button
                onClick={handleCopyAll}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-cyan-400 transition-colors"
              >
                {copied === "__all__" ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                Copy unused
              </button>
            )}
          </div>

          {/* code list */}
          <div className="space-y-2">
            {!isPending && filtered.length === 0 && (
              <div className="text-center text-slate-500 py-10 text-sm">
                No codes yet — generate some above
              </div>
            )}
            {filtered.map((c) => (
              <div
                key={c.id}
                className={`bg-slate-800 rounded-xl p-3 border ${c.usedBy ? "border-slate-700 opacity-60" : "border-slate-600"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-cyan-300 tracking-widest text-sm">
                        {c.code}
                      </span>
                      {c.usedBy ? (
                        <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">
                          Used
                        </span>
                      ) : (
                        <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">
                          Active
                        </span>
                      )}
                    </div>
                    {c.note && (
                      <div className="text-xs text-slate-400 mt-0.5">
                        {c.note}
                      </div>
                    )}
                    <div className="text-xs text-slate-500 mt-0.5">
                      Created {formatDate(c.createdAt)}
                      {c.expires && ` · Expires ${formatDate(c.expires)}`}
                    </div>
                    {c.usedBy && (
                      <div className="text-xs text-amber-400 mt-0.5">
                        Used by {c.usedBy}
                        {c.usedAt ? ` on ${formatDate(c.usedAt)}` : ""}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    {!c.usedBy && (
                      <button
                        onClick={() => handleCopy(c.code)}
                        className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-cyan-500/20 flex items-center justify-center transition-colors"
                        title="Copy code"
                      >
                        {copied === c.code ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Copy className="w-4 h-4 text-slate-400" />
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(c.id)}
                      disabled={isMutating}
                      className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-red-500/20 flex items-center justify-center transition-colors disabled:opacity-50"
                      title="Delete code"
                    >
                      <Trash2 className="w-4 h-4 text-slate-400 hover:text-red-400" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
