import { Outlet, NavLink } from "react-router-dom";
import {
  Home,
  Map,
  Fish,
  Sun,
  Waves,
  Cloud,
  Target,
  Settings,
} from "lucide-react";

const navItems = [
  { to: "/", icon: Home, label: "Home" },
  { to: "/map", icon: Map, label: "Map" },
  { to: "/hotspots", icon: Target, label: "Hotspots" },
  { to: "/catches", icon: Fish, label: "Catches" },
  { to: "/solunar", icon: Sun, label: "Solunar" },
  { to: "/tides", icon: Waves, label: "Tides" },
  { to: "/weather", icon: Cloud, label: "Weather" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export default function Layout() {
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      <header className="bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center">
          <Fish className="w-5 h-5 text-white" />
        </div>
        <h1 className="text-lg font-bold text-white">Tactical Offshore</h1>
      </header>

      <main className="flex-1 overflow-y-auto pb-20">
        <Outlet />
      </main>

      <nav
        className="fixed bottom-0 left-0 right-0 bg-slate-800 border-t border-slate-700 px-1 py-1"
        style={{ paddingBottom: "max(4px, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-center max-w-lg mx-auto overflow-x-auto scrollbar-none">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-lg transition-colors flex-1 min-w-[52px] ${
                  isActive
                    ? "text-cyan-400 bg-cyan-400/10"
                    : "text-slate-400 hover:text-slate-200"
                }`
              }
            >
              <Icon className="w-5 h-5" />
              <span className="text-[9px] font-medium leading-none">
                {label}
              </span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
