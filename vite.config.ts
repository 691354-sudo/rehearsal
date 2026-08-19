import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react()],
  server: {
    port: Number(process.env.VITE_DEV_PORT || 4173),
    strictPort: true,
    proxy: {
      "/api": process.env.VITE_API_TARGET || "http://127.0.0.1:8787",
      "/health": process.env.VITE_API_TARGET || "http://127.0.0.1:8787",
    },
  },
});
