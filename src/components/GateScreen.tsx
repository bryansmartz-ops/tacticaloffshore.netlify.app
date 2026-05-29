import { useState } from "react";
import {
  Shield,
  KeyRound,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { useLazyQuery, useMutation } from "@animaapp/playground-react-sdk";

const ACCESS_KEY = "tactical_access_granted";

interface Props {
  onGranted: () => void;
}

export default function GateScreen({ onGranted }: Props) {
  const [input, setInput] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [status, setStatus] = useState<
    "idle" | "success" | "invalid" | "expired" | "used" | "checking"
  >("idle");
  const [shaking, setShaking] = useState(false);

  const { query } = useLazyQuery("ActivationCode");
  const { update } = useMutation("ActivationCode");

  function shake() {
    setShaking(true);
    setTimeout(() => setShaking(false), 500);
  }

  async function handleSubmit() {
    const entered = input.trim().toUpperCase().replace(/\s/g, "");
    if (!entered) return;

    // Dev / preview master bypass — always grants access without consuming a code
    if (
      entered === "DEV-ACCESS" ||
      entered === "DEVACCESS" ||
      entered === "DEV"
    ) {
      localStorage.setItem(ACCESS_KEY, "1");
      setStatus("success");
      setTimeout(onGranted, 900);
      return;
    }

    setStatus("checking");

    try {
      const results = await query({ where: { code: entered } });

      if (!results || results.length === 0) {
        setStatus("invalid");
        shake();
        return;
      }

      const code = results[0];

      if (code.usedBy) {
        setStatus("used");
        shake();
        return;
      }

      if (code.expires && new Date(code.expires) < new Date()) {
        setStatus("expired");
        shake();
        return;
      }

      // Mark code as used
      await update(code.id, {
        usedBy: "device",
        usedAt: new Date(),
        status: "used",
      });

      // Grant access
      localStorage.setItem(ACCESS_KEY, "1");
      setStatus("success");
      setTimeout(onGranted, 900);
    } catch {
      setStatus("invalid");
      shake();
    }
  }

  const errorMsg = {
    invalid: "Code not recognised — check your entry and try again.",
    expired: "That code has expired. Contact the fleet captain for a new one.",
    used: "That code has already been activated on another device.",
    checking: "",
    idle: "",
    success: "",
  }[status];

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        {/* Logo / branding */}
        <div className="flex flex-col items-center gap-3 mb-10">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-cyan-500/30 to-blue-600/30 border border-cyan-500/40 flex items-center justify-center shadow-xl">
            <Shield className="w-10 h-10 text-cyan-400" />
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">
            Tactical Offshore
          </h1>
          <p className="text-slate-400 text-sm text-center leading-relaxed">
            Enter your activation code to
            <br />
            access the fleet dashboard.
          </p>
        </div>

        {/* Code entry card */}
        <div
          className={`bg-slate-900 rounded-2xl p-6 border shadow-2xl space-y-4 transition-all duration-100 ${
            shaking
              ? "border-red-500 animate-shake"
              : status === "success"
                ? "border-emerald-500"
                : "border-slate-700"
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <KeyRound className="w-4 h-4 text-cyan-400" />
            <span className="text-sm font-semibold text-slate-300">
              Activation Code
            </span>
          </div>

          <div className="relative">
            <input
              type={showCode ? "text" : "password"}
              placeholder="XXXX-XXXX-XXXX"
              value={input}
              onChange={(e) => {
                setInput(e.target.value.toUpperCase());
                setStatus("idle");
              }}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              maxLength={14}
              disabled={status === "checking" || status === "success"}
              className={`w-full font-mono tracking-widest text-lg bg-slate-800 border rounded-xl pl-4 pr-11 py-3 text-white placeholder-slate-600 focus:outline-none focus:ring-2 transition-all ${
                status === "invalid" ||
                status === "used" ||
                status === "expired"
                  ? "border-red-500 focus:ring-red-500"
                  : status === "success"
                    ? "border-emerald-500 focus:ring-emerald-500"
                    : "border-slate-600 focus:ring-cyan-500"
              }`}
            />
            <button
              onClick={() => setShowCode(!showCode)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
            >
              {showCode ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* Error / success feedback */}
          {errorMsg && (
            <div className="flex items-start gap-2 text-red-400 text-xs bg-red-500/10 rounded-lg px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
          {status === "success" && (
            <div className="flex items-center gap-2 text-emerald-400 text-xs bg-emerald-500/10 rounded-lg px-3 py-2">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>Access granted — loading dashboard…</span>
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={status === "success" || status === "checking"}
            className="w-full bg-cyan-500 hover:bg-cyan-400 disabled:opacity-60 disabled:cursor-not-allowed text-slate-900 font-bold py-3 rounded-xl transition-all text-sm tracking-wide"
          >
            {status === "success"
              ? "Activating…"
              : status === "checking"
                ? "Checking…"
                : "Activate"}
          </button>
        </div>

        <p className="text-slate-600 text-xs text-center mt-6">
          Need a code? Contact your fleet administrator.
        </p>
        <p className="text-slate-700 text-xs text-center mt-2 select-none">
          Preview access: type{" "}
          <span className="font-mono text-slate-500">DEV-ACCESS</span> and tap
          Activate
        </p>
      </div>

      {/* Shake animation */}
      <style>{`
        @keyframes shake {
          0%,100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-5px); }
          80% { transform: translateX(5px); }
        }
        .animate-shake { animation: shake 0.5s ease; }
      `}</style>
    </div>
  );
}
