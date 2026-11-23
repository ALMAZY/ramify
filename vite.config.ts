import { defineConfig } from "vite";
import pkg from "./package.json";

// Tauri expects a fixed port and no screen clearing.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  define: { "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version) },
  build: {
    target: "es2022",
    sourcemap: false,
  },
  test: { environment: "node" },
} as any);
