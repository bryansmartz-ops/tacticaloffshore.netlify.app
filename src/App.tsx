import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./sections/Dashboard";
import TacticalMap from "./sections/TacticalMap";
import CatchLog from "./sections/CatchLog";
import Settings from "./sections/Settings";
import Solunar from "./sections/Solunar";
import Tides from "./sections/Tides";
import Weather from "./sections/Weather";
import Hotspots from "./sections/Hotspots";
import AdminPanel from "./sections/Admin";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="map" element={<TacticalMap />} />
        <Route path="catches" element={<CatchLog />} />
        <Route path="solunar" element={<Solunar />} />
        <Route path="tides" element={<Tides />} />
        <Route path="weather" element={<Weather />} />
        <Route path="hotspots" element={<Hotspots />} />
        <Route path="settings" element={<Settings />} />
        <Route path="admin" element={<AdminPanel />} />
      </Route>
    </Routes>
  );
}
