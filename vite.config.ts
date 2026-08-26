import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { pwaPathPatterns } from "./pwa-paths.js";

const configuredBase = process.env.VITE_BASE_PATH || "/";
const { base, privatePathPattern, privateUrlPattern, recoveryPathPattern } = pwaPathPatterns(configuredBase);

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: null,
      manifest: {
        id: base,
        name: "Echo",
        short_name: "Echo",
        description: "Personal sentence practice for English, Latvian, and Vietnamese",
        start_url: base,
        scope: base,
        display: "standalone",
        background_color: "rgb(237 232 224)",
        theme_color: "rgb(205 165 109)",
        icons: [
          { src: "icons/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{html,js,css,woff2,png,svg}"],
        globIgnores: ["icons/pwa-*.png"],
        navigateFallbackDenylist: [privatePathPattern, recoveryPathPattern],
        runtimeCaching: [{
          urlPattern: privateUrlPattern,
          handler: "NetworkOnly",
          options: { cacheName: "private-network-only" },
        }],
      },
    }),
  ],
  server: {
    port: Number(process.env.VITE_DEV_PORT || 4173),
    strictPort: true,
    proxy: {
      "/api": process.env.VITE_API_TARGET || "http://127.0.0.1:8787",
      "/health": process.env.VITE_API_TARGET || "http://127.0.0.1:8787",
    },
  },
});
