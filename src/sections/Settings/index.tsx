import {
  User,
  Bell,
  MapPin,
  Palette,
  Database,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";

export default function Settings() {
  const [notifications, setNotifications] = useState(true);
  const [units, setUnits] = useState<"imperial" | "metric">("imperial");
  const [homePort, setHomePort] = useState("Ocean City, MD");

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-bold text-white">Settings</h2>

      <div className="space-y-2">
        {/* Home Port */}
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <MapPin className="w-5 h-5 text-blue-400" />
            </div>
            <div className="flex-1">
              <div className="font-semibold text-white">Home Port</div>
              <input
                type="text"
                value={homePort}
                onChange={(e) => setHomePort(e.target.value)}
                className="text-sm text-slate-400 bg-transparent border-none p-0 focus:outline-none focus:text-white w-full"
              />
            </div>
            <ChevronRight className="w-5 h-5 text-slate-500" />
          </div>
        </div>

        {/* Notifications */}
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
              <Bell className="w-5 h-5 text-amber-400" />
            </div>
            <div className="flex-1">
              <div className="font-semibold text-white">Push Notifications</div>
              <div className="text-sm text-slate-400">
                Tide & solunar alerts
              </div>
            </div>
            <button
              onClick={() => setNotifications(!notifications)}
              className={`w-12 h-7 rounded-full transition-colors ${
                notifications ? "bg-cyan-500" : "bg-slate-600"
              }`}
            >
              <div
                className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  notifications ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>

        {/* Units */}
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <Palette className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="flex-1">
              <div className="font-semibold text-white">Units</div>
              <div className="text-sm text-slate-400">
                {units === "imperial"
                  ? "Fahrenheit, feet, lbs"
                  : "Celsius, meters, kg"}
              </div>
            </div>
            <select
              value={units}
              onChange={(e) =>
                setUnits(e.target.value as "imperial" | "metric")
              }
              className="bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-sm text-white"
            >
              <option value="imperial">Imperial</option>
              <option value="metric">Metric</option>
            </select>
          </div>
        </div>

        {/* Data */}
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <Database className="w-5 h-5 text-purple-400" />
            </div>
            <div className="flex-1">
              <div className="font-semibold text-white">Data & Storage</div>
              <div className="text-sm text-slate-400">Manage cached data</div>
            </div>
            <ChevronRight className="w-5 h-5 text-slate-500" />
          </div>
        </div>
      </div>

      <div className="text-center text-xs text-slate-500 pt-4">
        Tactical Offshore v1.0.0
      </div>
    </div>
  );
}
