import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "leaflet/dist/leaflet.css";
import "./index.css";

// ── SW killer ────────────────────────────────────────────────────────────────
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((reg) => reg.unregister());
  });
  caches.keys().then((keys) => {
    keys.forEach((key) => caches.delete(key));
  });
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
// ─────────────────────────────────────────────────────────────────────────────

function Root() {
  const [granted, setGranted] = React.useState<boolean>(() => {
    try {
      return (
        localStorage.getItem("tactical_access_granted") === "true" ||
        localStorage.getItem("tactical_unlocked") === "true" ||
        localStorage.getItem("isLoggedIn") === "true"
      );
    } catch {
      return false;
    }
  });

  // Dynamic state listener eliminates race conditions across browser environments
  React.useEffect(() => {
    const checkAccessKeys = () => {
      try {
        const isAccessGranted =
          localStorage.getItem("tactical_access_granted") === "true" ||
          localStorage.getItem("tactical_unlocked") === "true" ||
          localStorage.getItem("isLoggedIn") === "true";

        if (isAccessGranted) {
          setGranted(true);
        }
      } catch (err) {
        console.error("Storage observer warning:", err);
      }
    };

    // Run absolute evaluation instantly upon component mounting
    checkAccessKeys();

    // Catch immediate event fires from matching framework routing updates
    window.addEventListener("storage", checkAccessKeys);
    
    // Polyfill safety net interval loop to catch immediate local commits
    const intervalCheck = setInterval(checkAccessKeys, 300);

    return () => {
      window.removeEventListener("storage", checkAccessKeys);
      clearInterval(intervalCheck);
    };
  }, []);

  // Structural loading shield if storage is initializing
  if (!granted) {
    return (
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
