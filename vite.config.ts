import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Tells Vite to copy the root manifest.json into the final build directory
  publicDir: "public"
});
