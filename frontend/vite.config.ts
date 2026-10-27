import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, /api is proxied to the FastAPI backend (override with API_PROXY, e.g. in docker-compose).
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: { output: { manualChunks: { charts: ["recharts"] } } },
  },
  server: {
    host: true,
    port: 5173,
    proxy: { "/api": process.env.API_PROXY ?? "http://localhost:8000" },
  },
});
