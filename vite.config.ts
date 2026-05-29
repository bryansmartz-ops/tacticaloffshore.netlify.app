import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      // In local dev (vite), forward Netlify function calls to netlify dev (port 8888).
      // If you run only `vite` without `netlify dev`, the function won't be reachable
      // locally — but production (Netlify) always works correctly.
      "/.netlify/functions": {
        target: "http://localhost:8888",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
