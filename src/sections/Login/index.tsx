import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { Anchor, KeyRound, ShieldAlert, CheckCircle2, RefreshCw } from "lucide-react";

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

export default function Login() {
  const navigate = useNavigate();
  const [accessCode, setAccessCode] = useState("");
  const [userName, setUserName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleActivation(e: React.FormEvent) {
    e.preventDefault();
    if (!accessCode.trim()) {
      setError("Please enter a valid access authorization code.");
      return;
    }

    setLoading(true);
    setError(null);

    // Normalize string input format (strip whitespaces, force uppercase)
    const normalizedCode = accessCode.trim().toUpperCase();
    const targetKey = `code:${normalizedCode}`;

    try {
      // 1. Interrogate the PostgreSQL KV store for the matching key
      const { data, error: sbError } = await supabase
        .from(KV_TABLE)
        .select("value")
        .eq("key", targetKey)
        .single();

      if (sbError || !data) {
        throw new Error("Access code not recognized. Check characters and try again.");
      }

      const payload = data.value as ActivationCodePayload;

      // 2. Structural Rule Evaluations
      if (!payload.isActive) {
        throw new Error("This tactical access authorization code has been deactivated.");
      }

      // 3. Commit activation timestamp and bind device signature if first time use
      let updatedPayload = { ...payload };
      const rightNow = new Date().toISOString();

      if (!payload.firstUsed) {
        // Generate a localized structural token footprint to stand-in for device tracking
        const simulatedDeviceId = "DEV-" + Math.random().toString(36).substring(2, 10).toUpperCase();
        
        updatedPayload.firstUsed = rightNow;
        updatedPayload.lastUsed = rightNow;
        updatedPayload.deviceId = simulatedDeviceId;
        if (userName.trim()) updatedPayload.userName = userName.trim();

        const { error: updateError } = await supabase
          .from(KV_TABLE)
          .update({ value: updatedPayload })
          .eq("key", targetKey);

        if (updateError) throw new Error("Failed to commit device binding signature.");
      } else {
        // Code is already registered, track standard telemetry update milestone
        updatedPayload.lastUsed = rightNow;

        const { error: updateError } = await supabase
          .from(KV_TABLE)
          .update({ value: updatedPayload })
          .eq("key", targetKey);

        if (updateError) throw new Error("Failed to update access logs.");
      }

      // 4. Set persistent session indicators locally to bypass the main security guard hooks
      localStorage.setItem("tactical_access_granted", "true");
      localStorage.setItem("tactical_unlocked", "true");
      localStorage.setItem("isLoggedIn", "true");
      localStorage.setItem("active_vessel_user", updatedPayload.userName);

      // Trigger success animation states before rerouting to dashboard canvas
      setSuccess(true);
      setTimeout(() => {
        navigate("/", { replace: true });
      }, 1500);

    } catch (err: any) {
      console.error("[Authentication Engine Failure]:", err);
      setError(err.message || "An unhandled security exception occurred.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 selection:bg-cyan-500 selection:text-slate-950">
      <div className="w-full max-w-sm space-y-6">
        
        {/* Top Identity Header */}
        <div className="text-center space-y-2">
          <div className="mx-auto w-14 h-14 bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/40 rounded-2xl flex items-center justify-center shadow-xl shadow-cyan-950/30">
            <Anchor className="w-6 h-6 text-cyan-400" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white uppercase">Tactical Offshore</h1>
          <p className="text-xs text-slate-400 max-w-[280px] mx-auto leading-relaxed">
            Telemetry, SST breaks, and predictive charts require security clearance verify.
          </p>
        </div>

        {/* Security Processing Card container */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4 relative overflow-hidden">
          {success && (
            <div className="absolute inset-0 bg-slate-900/95 flex flex-col items-center justify-center space-y-2 z-10 animate-fade-in">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 animate-scale-up" />
              <span className="text-xs font-mono font-bold uppercase tracking-widest text-slate-200">
                Credentials Approved
              </span>
            </div>
          )}

          <form onSubmit={handleActivation} className="space-y-4">
            
            {/* Input field 1: Username / Identity */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Captain / Operator Name
              </label>
              <input
                type="text"
                disabled={loading}
                placeholder="e.g. Bryan Martz"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/20 transition-all font-medium"
              />
            </div>

            {/* Input field 2: Access Code string */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Access Authorization Code
              </label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                <input
                  type="text"
                  required
                  disabled={loading}
                  placeholder="OCMD-XXXX-XXXX"
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-3 py-2.5 text-sm font-mono font-bold tracking-widest text-cyan-300 placeholder-slate-700 uppercase focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/20 transition-all"
                />
              </div>
            </div>

            {/* Dynamic Error Messaging Output */}
            {error && (
              <div className="bg-red-950/30 border border-red-900/50 text-red-400 text-xs rounded-xl p-3 flex items-start gap-2.5 leading-relaxed">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Verification Fire trigger button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-40 disabled:pointer-events-none text-slate-950 font-black text-sm uppercase tracking-wider py-3 rounded-xl shadow-lg shadow-cyan-950/20 transition-all"
            >
              {loading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                "Authenticate Terminal"
              )}
            </button>
          </form>
        </div>

        {/* Footer info text */}
        <div className="text-center text-[10px] text-slate-600 font-mono">
          System Signature Latency Layer V2.6
        </div>
      </div>
    </div>
  );
}
