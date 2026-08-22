import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const configuredBase = process.env.VITE_BASE_PATH || "/";
const base = configuredBase.endsWith("/") ? configuredBase : `${configuredBase}/`;
const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const privatePathPattern = new RegExp(`^${escapedBase}(?:api(?:/|$)|health$)`);
const privateUrlPattern = new RegExp(`^https?://[^/]+${escapedBase}(?:api(?:/|$)|health(?:[?#]|$))`);

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
        background_color: "#ece7df",
        theme_color: "#a4573b",
        icons: [
          { src: "icons/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{html,js,css,woff2,png,svg}"],
        navigateFallbackDenylist: [privatePathPattern],
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
