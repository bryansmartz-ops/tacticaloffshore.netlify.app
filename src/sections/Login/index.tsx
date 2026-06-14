import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { Anchor, KeyRound, ShieldAlert, CheckCircle2, RefreshCw } from "lucide-react";

const KV_TABLE = "kv_store_8db09b0a";

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

    // Normalize input string sequence cleanly
    const cleanCode = accessCode.trim().toUpperCase();

    try {
      // 1. Bulletproof wild-card search targets both 'code:OCMD-...' and loose 'OCMD-...' keys cleanly
      const { data, error: sbError } = await supabase
        .from(KV_TABLE)
        .select("key, value")
        .ilike("key", `%${cleanCode}%`);

      if (sbError || !data || data.length === 0) {
        throw new Error("Access code not recognized. Check characters and try again.");
      }

      // Extract the row match parameters from the loose selection list array
      const matchedRow = data[0];
      const payload = matchedRow.value as any;
      const actualKey = matchedRow.key;

      // 2. Flexible property evaluation path maps handles both camelCase and snake_case column data
      const codeActive = payload.isActive !== undefined ? payload.isActive : payload.is_active;
      const firstUsedTime = payload.firstUsed !== undefined ? payload.firstUsed : payload.first_used;

      if (codeActive === false) {
        throw new Error("This tactical access authorization code has been deactivated.");
      }

      let updatedPayload = { ...payload };
      const rightNow = new Date().toISOString();

      // 3. Process structural binding logic safely regardless of database property headers
      if (!firstUsedTime) {
        const simulatedDeviceId = "DEV-" + Math.random().toString(36).substring(2, 10).toUpperCase();
        
        if (updatedPayload.firstUsed !== undefined) {
          updatedPayload.firstUsed = rightNow;
          updatedPayload.lastUsed = rightNow;
          updatedPayload.deviceId = simulatedDeviceId;
          if (userName.trim()) updatedPayload.userName = userName.trim();
        } else {
          updatedPayload.first_used = rightNow;
          updatedPayload.last_used = rightNow;
          updatedPayload.device_id = simulatedDeviceId;
          if (userName.trim()) updatedPayload.user_name = userName.trim();
        }
      } else {
        if (updatedPayload.lastUsed !== undefined) {
          updatedPayload.lastUsed = rightNow;
        } else {
          updatedPayload.last_used = rightNow;
        }
      }

      // Commit the payload updates back using the strict key row index resolved by the selection search
      const { error: updateError } = await supabase
        .from(KV_TABLE)
        .update({ value: updatedPayload })
        .eq("key", actualKey);

      if (updateError) throw new Error("Failed to commit security database signatures.");

      // 4. Force persistent access indicators natively across browser environments
      localStorage.setItem("tactical_access_granted", "true");
      localStorage.setItem("tactical_unlocked", "true");
      localStorage.setItem("isLoggedIn", "true");
      localStorage.setItem("active_vessel_user", userName.trim() || "Charter Guest");

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
        
        {/* Identity Branding Header */}
        <div className="text-center space-y-2">
          <div className="mx-auto w-14 h-14 bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/40 rounded-2xl flex items-center justify-center shadow-xl shadow-cyan-950/30">
            <Anchor className="w-6 h-6 text-cyan-400" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white uppercase">Tactical Offshore</h1>
          <p className="text-xs text-slate-400 max-w-[280px] mx-auto leading-relaxed">
            Telemetry, SST breaks, and predictive charts require security clearance verify.
          </p>
        </div>

        {/* Input Card Container */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4 relative overflow-hidden">
          {success && (
            <div className="absolute inset-0 bg-slate-900/95 flex flex-col items-center justify-center space-y-2 z-10">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 animate-pulse" />
              <span className="text-xs font-mono font-bold uppercase tracking-widest text-slate-200">
                Credentials Approved
              </span>
            </div>
          )}

          <form onSubmit={handleActivation} className="space-y-4">
            
            {/* Operator Identifier Field */}
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
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500/60 transition-all font-medium"
              />
            </div>

            {/* Access Code Input Field */}
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
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-3 py-2.5 text-sm font-mono font-bold tracking-widest text-cyan-300 placeholder-slate-700 uppercase focus:outline-none focus:border-cyan-500/60 transition-all"
                />
              </div>
            </div>

            {/* Alert Banner System */}
            {error && (
              <div className="bg-red-950/30 border border-red-900/50 text-red-400 text-xs rounded-xl p-3 flex items-start gap-2.5 leading-relaxed">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Fire Action Control */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-40 text-slate-950 font-black text-sm uppercase tracking-wider py-3 rounded-xl shadow-lg transition-all"
            >
              {loading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                "Authenticate Terminal"
              )}
            </button>
          </form>
        </div>

        <div className="text-center text-[10px] text-slate-600 font-mono">
          System Signature Latency Layer V2.6
        </div>
      </div>
    </div>
  );
}
