import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset URLs so the build works at any mount path (e.g. GitHub
  // Pages serving from /BabylonPlanets/).
  base: "./",
  build: {
    // safari12 keeps the bundle parseable on old iPads — es2022 emitted
    // syntax that older WebKit rejects at parse time, which killed the whole
    // module (black screen, empty sidebar). safari12 also transpiles
    // optional chaining / nullish coalescing for pre-13.1 WebKit.
    target: ["es2018", "safari12"],
    chunkSizeWarningLimit: 4096
  }
});
