import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AnimaProvider } from "@animaapp/playground-react-sdk";
import App from "./App";
import GateScreen from "./components/GateScreen";
import "leaflet/dist/leaflet.css";
import "./index.css";

function Root() {
  // GateScreen now uses the SDK internally to look up activation codes.
  // It calls onGranted() only after a valid code is confirmed, and we persist
  // the granted flag in localStorage for subsequent page loads.
  const [granted, setGranted] = React.useState(
    () => !!localStorage.getItem("tactical_access_granted"),
  );

  if (!granted) {
    return <GateScreen onGranted={() => setGranted(true)} />;
  }

  return (
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AnimaProvider>
      <Root />
    </AnimaProvider>
  </React.StrictMode>,
);
