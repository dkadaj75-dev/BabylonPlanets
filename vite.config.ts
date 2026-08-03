import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset URLs so the build works at any mount path (e.g. GitHub
  // Pages serving from /BabylonPlanets/).
  base: "./",
  build: {
    // safari15 keeps the bundle parseable on iPads that haven't reached
    // 16.4 — es2022 emitted syntax that older WebKit rejects at parse time,
    // which killed the whole module (black screen, empty sidebar).
    target: ["es2020", "safari15"],
    chunkSizeWarningLimit: 4096
  }
});
