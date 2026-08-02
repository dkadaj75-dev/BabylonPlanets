import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset URLs so the build works at any mount path (e.g. GitHub
  // Pages serving from /BabylonPlanets/).
  base: "./",
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 4096
  }
});
