import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// GitHub Pages base path. Override via ATLAS_BASE_PATH env or vite --base.
const base = process.env.ATLAS_BASE_PATH || "/";

export default defineConfig({
  plugins: [react()],
  base,
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
        },
      },
    },
  },
  server: { port: 5173, open: false },
});
