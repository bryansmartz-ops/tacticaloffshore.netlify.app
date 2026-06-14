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
} from "lucide-react";
import { supabase } from "../../lib/supabase";

const ADMIN_PASSWORD = "offshore2024!";
const KV_TABLE = "kv_store_8db09b0a";

interface ActivationCodePayload {
  code: string;
  deviceId: string | null;
  isActive: boolean;
  lastUsed: string | null;
  userName: string;
  createdAt: string;
  firstUsed: string | null;
}

function generateCode(): string {
  const seg = () => Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${seg()}-${seg()}-${seg()}`;
}

function formatDate(d: Date | string | null) {
  if (!d) return "—";
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

  const [codes, setCodes] = useState<ActivationCodePayload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [note, setNote] = useState("");
  const [qty, setQty] = useState(1);
  const [copied, setCopied] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "unused" | "used">("all");
  const [processing, setProcessing] = useState(false);

  // ── Fetch Codes From Supabase KV Store ───────────────────────────────────
  async function fetchCodes() {
    setLoading(true);
    setError(null);
    try {
      // Pulling all keys that represent activation codes from the text/jsonb matrix
      const { data, error: sbError } = await supabase
        .from(KV_TABLE)
        .select("value")
        .like("key", "code:%");

      if (sbError) throw sbError;

      if (data) {
        const parsedCodes = data.map((row: any) => row.value as ActivationCodePayload);
        // Sort descending by creation date
        parsedCodes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setCodes(parsedCodes);
      }
    } catch (err: any) {
      console.error("[KV Store Sync Failure]:", err);
      setError(err.message || "Failed to synchronize environmental security keys.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authed) {
      fetchCodes();
    }
  }, [authed]);

  // ── Generate Code Payloads ───────────────────────────────────────────────
  async function handleGenerate() {
    setProcessing(true);
    try {
      for (let i = 0; i < qty; i++) {
        const newCodeStr = generateCode();
        const newPayload: ActivationCodePayload = {
          code: newCodeStr,
          deviceId: null,
          isActive: true,
          lastUsed: null,
          userName: note.trim() || "Test User",
          createdAt: new Date().toISOString(),
          firstUsed: null,
        };

        const { error: sbError } = await supabase
          .from(KV_TABLE)
          .insert([{ key: `code:${newCodeStr}`, value: newPayload }]);

        if (sbError) throw sbError;
      }

      setNote("");
      setQty(1);
      await fetchCodes();
    } catch (err: any) {
      console.error("[Insertion Intercepted]:", err);
      setError(err.message || "Failed to commit security records.");
    } finally {
      setProcessing(false);
    }
  }

  // ── Delete Code Payloads ─────────────────────────────────────────────────
  async function handleDelete(codeStr: string) {
    setProcessing(true);
    try {
      const { error: sbError } = await supabase
        .from(KV_TABLE)
        .delete()
        .eq("key", `code:${codeStr}`);

      if (sbError) throw sbError;
      await fetchCodes();
    } catch (err: any) {
      console.error("[Deletion Rejected]:", err);
      setError(err.message || "Failed to purge record safely.");
    } finally {
      setProcessing(false);
    }
  }

  function handleCopy(code: string) {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  }

  function handleCopyAll() {
    const unused = codes.filter((c) => !c.firstUsed).map((c) => c.code);
    navigator.clipboard.writeText(unused.join("\n")).catch(() => {});
    setCopied("__all__");
    setTimeout(() => setCopied(null), 2000);
  }

  const filtered = codes.filter((c) => {
    if (filter === "unused") return !c.firstUsed;
    if (filter === "used") return !!c.firstUsed;
    return true;
  });

  const unusedCount = codes.filter((c) => !c.firstUsed).length;
  const usedCount = codes.filter((c) => c.firstUsed).length;

  // ── Auth Gate View ────────────────────────────────────────────────────────
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

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Admin Console</h1>
            <p className="text-xs text-slate-400">Supabase KV Store Integration Active</p>
          </div>
        </div>
        <button
          onClick={() => setAuthed(false)}
          className="text-xs text-slate-500 hover:text-red-400 transition-colors"
        >
          Sign out
        </button>
      </div>

      {/* Error Output Banner */}
      {error && (
        <div className="bg-red-950/40 border border-red-900 text-red-400 text-xs rounded-xl p-3 mb-4">
          {error}
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "Total", value: codes.length, color: "text-white" },
          { label: "Unused", value: unusedCount, color: "text-emerald-400" },
          { label: "Used", value: usedCount, color: "text-amber-400" },
        ].map((s) => (
          <div key={s.label} className="bg-slate-800 rounded-xl p-3 border border-slate-700 text-center">
            <div className={`text-2xl font-bold ${s.color}`}>{loading ? "…" : s.value}</div>
            <div className="text-xs text-slate-400">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Generator Box */}
      <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700 mb-6 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <KeyRound className="w-4 h-4 text-cyan-400" />
          <span className="font-semibold text-sm">Generate Supabase Keys</span>
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-xs text-slate-400 mb-1 block">User Name / Note</label>
            <input
              type="text"
              placeholder="e.g. Captain John Doe"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none"
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
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
            />
          </div>
        </div>

        <button
          onClick={handleGenerate}
          disabled={processing || loading}
          className="w-full flex items-center justify-center gap-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-60 text-slate-900 font-bold py-3 rounded-xl transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${processing ? "animate-spin" : ""}`} />
          Commit {qty > 1 ? `${qty} Keys` : "Key"} to PostgreSQL
        </button>
      </div>

      {/* Filters + Action controls */}
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

      {/* Code Table Manifest */}
      <div className="space-y-2">
        {loading && <div className="text-slate-400 text-sm text-center py-10">Syncing with database matrix…</div>}
        
        {!loading && filtered.length === 0 && (
          <div className="text-center text-slate-500 py-10 text-sm">No activation metrics matches found.</div>
        )}

        {!loading && filtered.map((c) => (
          <div
            key={c.code}
            className={`bg-slate-800 rounded-xl p-3 border ${c.firstUsed ? "border-slate-700/60 opacity-60" : "border-slate-600"}`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-cyan-300 tracking-widest text-sm">
                    {c.code}
                  </span>
                  {c.firstUsed ? (
                    <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full font-bold uppercase">
                      Activated
                    </span>
                  ) : (
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-bold uppercase">
                      Ready
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  Owner/Note: <span className="text-slate-200 font-medium">{c.userName}</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Issued: {formatDate(c.createdAt)}
                </div>
                {c.firstUsed && (
                  <div className="text-[11px] text-amber-400 mt-1 font-mono">
                    Device Bind: {c.deviceId || "Registered Mobile Terminal"}
                    <span className="block text-slate-500">First Bound: {formatDate(c.firstUsed)}</span>
                  </div>
                )}
              </div>

              <div className="flex gap-2 flex-shrink-0">
                {!c.firstUsed && (
                  <button
                    onClick={() => handleCopy(c.code)}
                    className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-cyan-500/20 flex items-center justify-center transition-colors"
                  >
                    {copied === c.code ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Copy className="w-4 h-4 text-slate-400" />
                    )}
                  </button>
                )}
                <button
                  onClick={() => handleDelete(c.code)}
                  disabled={processing}
                  className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-red-500/20 flex items-center justify-center transition-colors"
                >
                  <Trash2 className="w-4 h-4 text-slate-400 hover:text-red-400" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
