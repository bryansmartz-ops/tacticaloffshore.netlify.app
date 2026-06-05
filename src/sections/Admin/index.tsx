// src/sections/Admin/index.tsx
// Pure Self-Contained Admin Code Terminal (Post-Anima Engine)
// ─────────────────────────────────────────────────────────────────────

import { useState, useEffect } from "react";
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
  Zap
} from "lucide-react";

const ADMIN_PASSWORD = "offshore2024!";

interface LocalActivationCode {
  id: string;
  code: string;
  status: "active" | "used";
  note?: string;
  createdAt: string;
  expires?: string;
  usedBy?: string;
  usedAt?: string;
}

function generateCode(): string {
  const seg = () => Math.random().toString(36).substring(2, 6).toUpperCase();
  return `OCMD-${seg()}-${seg()}`;
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

  // Local Key Database State
  const [codes, setCodes] = useState<LocalActivationCode[]>([]);

  // Load existing keys from browser storage on boot
  useEffect(() => {
    const saved = localStorage.getItem("tactical_generated_codes");
    if (saved) {
      try { setCodes(JSON.parse(saved)); } catch (e) { console.error(e); }
    } else {
      // Seed initial code so the bank isn't empty
      const masterSeed: LocalActivationCode = {
        id: "seed-1",
        code: "OCMD-7742-9921",
        status: "active",
        note: "Master Control Key",
        createdAt: new Date().toISOString()
      };
      setCodes([masterSeed]);
      localStorage.setItem("tactical_generated_codes", JSON.stringify([masterSeed]));
    }
  }, []);

  // Save changes helper
  const saveCodesToStorage = (updated: LocalActivationCode[]) => {
    setCodes(updated);
    localStorage.setItem("tactical_generated_codes", JSON.stringify(updated));
  };

  // ── Auth Gate ────────────────────────────────────────────────────────────
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
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {pwErr && <p className="text-red-400 text-xs">Incorrect password</p>}
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

  // ── Actions ─────────────────────────────────────────────────────────────
  function handleGenerate() {
    const newBatch: LocalActivationCode[] = [...codes];
    for (let i = 0; i < qty; i++) {
      newBatch.unshift({
        id: Math.random().toString(36).substring(2, 9),
        code: generateCode(),
        status: "active",
        note: note.trim() || undefined,
        expires: expires ? expires : undefined,
        createdAt: new Date().toISOString(),
      });
    }
    saveCodesToStorage(newBatch);
    setNote("");
    setExpires("");
    setQty(1);
  }

  function handleDelete(id: string) {
    const updated = codes.filter((c) => c.id !== id);
    saveCodesToStorage(updated);
  }

  function handleCopy(code: string) {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  }

  function handleCopyAll() {
    const unused = codes.filter((c) => c.status === "active").map((c) => c.code);
    navigator.clipboard.writeText(unused.join("\n")).catch(() => {});
    setCopied("__all__");
    setTimeout(() => setCopied(null), 2000);
  }

  const filtered = codes.filter((c) => {
    if (filter === "unused") return c.status === "active";
    if (filter === "used") return c.status === "used";
    return true;
  });

  const unusedCount = codes.filter((c) => c.status === "active").length;
  const usedCount = codes.filter((c) => c.status === "used").length;

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Admin Console</h1>
            <p className="text-xs text-slate-400">Tactical Offshore local management</p>
          </div>
        </div>
        <button
          onClick={() => setAuthed(false)}
          className="text-xs text-slate-500 hover:text-red-400 transition-colors"
        >
          Sign out
        </button>
      </div>

      {/* Tab bar */}
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
        </button>
      </div>

      {activeTab === "scans" && (
        <div className="text-center text-slate-500 py-16 text-sm space-y-2">
          <Activity className="w-10 h-10 mx-auto text-slate-600 mb-3" />
          <p>Local ERDDAP stream active.</p>
          <p className="text-xs text-slate-600">Row matrix rendering natively on chart maps.</p>
        </div>
      )}

      {activeTab === "codes" && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            {[
              { label: "Total", value: codes.length, color: "text-white" },
              { label: "Unused", value: unusedCount, color: "text-emerald-400" },
              { label: "Used", value: usedCount, color: "text-amber-400" },
            ].map((s) => (
              <div key={s.label} className="bg-slate-800 rounded-xl p-3 border border-slate-700 text-center">
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-slate-400">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Generator Input Frame */}
          <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700 mb-6 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <KeyRound className="w-4 h-4 text-cyan-400" />
              <span className="font-semibold text-sm">Generate Codes</span>
            </div>

            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-slate-400 mb-1 block">Note (optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Boat locker key card"
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
                  onChange={(e) => setQty(Math.min(50, Math.max(1, Number(e.target.value))))}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-400 mb-1 block">Expires (optional)</label>
              <input
                type="date"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
                className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>

            <button
              onClick={handleGenerate}
              className="w-full flex items-center justify-center gap-2 bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-bold py-3 rounded-xl transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Generate {qty > 1 ? `${qty} Codes` : "Code"}
            </button>
          </div>

          {/* Filters */}
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
                {copied === "__all__" ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                Copy unused
              </button>
            )}
          </div>

          {/* Codes List Data Presentation Grid */}
          <div className="space-y-2">
            {filtered.length === 0 && (
              <div className="text-center text-slate-500 py-10 text-sm">No codes generated yet.</div>
            )}
            {filtered.map((c) => (
              <div
                key={c.id}
                className={`bg-slate-800 rounded-xl p-3 border ${c.status === "used" ? "border-slate-700 opacity-60" : "border-slate-600"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-cyan-300 tracking-widest text-sm">{c.code}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${c.status === "used" ? "bg-amber-500/20 text-amber-400" : "bg-emerald-500/20 text-emerald-400"}`}>
                        {c.status === "used" ? "Used" : "Active"}
                      </span>
                    </div>
                    {c.note && <div className="text-xs text-slate-400 mt-0.5">{c.note}</div>}
                    <div className="text-xs text-slate-500 mt-0.5">
                      Created {formatDate(c.createdAt)}
                      {c.expires && ` · Expires ${c.expires}`}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    {c.status === "active" && (
                      <button
                        onClick={() => handleCopy(c.code)}
                        className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-cyan-500/20 flex items-center justify-center transition-colors"
                      >
                        {copied === c.code ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-400" />}
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-red-500/20 flex items-center justify-center transition-colors"
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
