# BabylonPlanets — tech stack design

A standalone, browser-based Babylon.js builder for **Space Arena** maps: arena
layout (bounds, asteroids, spawn points), procedural skybox panoramas, and a
one-click export that matches the game's import format exactly. The authoritative
description of that format is [docs/space-arena-import-reference.md](docs/space-arena-import-reference.md);
every decision below is anchored to it.

The guiding principle: **the game treats a map as pure data** (bounds + rocks +
spawns + sky + boundary look), so the builder's job is to be a comfortable editor
over exactly that data, and to refuse to produce anything the game would reject.

## Decisions

### Language & build tooling — TypeScript + Vite (Node 22)

- Vite gives instant-start dev serving with HMR and a production build in one
  dependency, with zero config for a single-page tool like this. The alternative
  (webpack/rollup by hand) buys nothing for an internal editor.
- TypeScript in `strict` mode, because the whole point of the tool is emitting
  schema-correct data — static types on the arena model catch a large class of
  export bugs before the zod layer does.
- ES2022 target: the tool is desktop-browser-only (it's an authoring tool, not
  the game client), so no legacy transpilation budget is spent.

### Rendering — `@babylonjs/core` ES6 packages

- The scoped ES6 packages are tree-shakeable; importing from deep paths
  (`@babylonjs/core/Cameras/arcRotateCamera`) keeps the editor bundle from
  swallowing the entire engine. The legacy `babylonjs` UMD package is a single
  monolith and is explicitly avoided.
- Using Babylon (rather than three.js) is deliberate: the game renders with
  Babylon, so the builder inherits the same handedness (left-handed, Y-up),
  units, and material behavior for free. What you see in the builder is what
  the game shows — including the skybox shader recipe from the reference doc
  (emissive-channel panorama on a BACKSIDE sphere), which the preview module
  can reproduce verbatim.

### UI layer — plain TypeScript + DOM panels

- The editor chrome is a handful of side panels (arena properties, placement
  list, skybox controls, export). Plain DOM with small hand-rolled components
  keeps the dependency surface at zero and avoids a framework's render loop
  fighting Babylon's.
- Considered: React (heavyweight for this panel count, and reconciliation adds
  nothing to a canvas-first app), Tweakpane/lil-gui (great for prototyping —
  acceptable as an interim control surface, but custom panels win once the
  placement list needs drag/reorder). If panel complexity grows materially,
  Preact is the earmarked escape hatch; the scaffold stays plain TS-DOM.

### Schema & validation — zod, mirroring the game's arena schema

- `src/schema/arena.ts` mirrors `shared/src/schemas/arena.ts` from the game:
  the `id`/`type`/`version`/`name` envelope (`id` must start with `arena.`),
  sphere/rect bounds discriminated union, placements, spawn points, lighting,
  and the `render` block (skybox + boundary shield).
- The two constraints that are painful to discover at game import are enforced
  here, in the builder, so exports fail fast:
  - **±327.67 coordinate limit** (int16 centi-unit replication), tightened to
    `extent + 20 ≤ 327.67` to account for the game's default
    `projectileBoundsMargin` — the builder refuses to export past it rather
    than letting positions silently clamp.
  - **`|sun.dir| = 1 ± 0.02`** — a non-unit sun direction is otherwise very
    hard to spot visually.
- Additional cross-field checks (spawn points inside bounds) live in a
  `superRefine`, matching what the game's schema enforces.
- zod over hand-rolled validation: the inferred types double as the editor's
  model types, so the schema is the single source of truth on our side too.

### Procedural skybox generation — canvas → equirectangular WebP

- Output is a **2:1 equirectangular panorama** (default 4096×2048) — the
  layout the game expects, not a cubemap cross.
- The scaffold implementation (`src/skybox/generateSkybox.ts`) renders on an
  `OffscreenCanvas` 2D context: gradient deep-space background, a starfield
  sampled *uniformly on the sphere* then projected (so density stays even
  despite pole stretching), and a soft radial sun disc drawn with seam
  wrapping. A WebGL/shader-based generator (nebula noise, planets) can replace
  the 2D pass later behind the same function signature.
- **Sun direction is carried, not guessed**: the generator takes a unit vector
  (Babylon left-handed Y-up), places the sun in the panorama via the
  documented equirect mapping (`u = 0.5 + atan2(z,x)/2π`,
  `v = 0.5 − asin(y)/π`), and returns that same vector for the export to emit
  as `render.skybox.sun.dir`. That single hand-off is what makes the game's
  key light match the painted star.
- Export format is WebP (what the game ships), at quality ~0.9; the game's CI
  budget wants panoramas under a few MB.

### Export pipeline

- `exportArena()` validates through the zod schema and produces
  `<slug>.json` (slug = id minus the `arena.` prefix), pretty-printed to match
  the shipped configs. A browser-download helper wraps it.
- Planned full export: a folder/zip laid out exactly like the game's
  `content/` tree — `arenas/<slug>.json`, `skyboxes/<slug>.webp`, plus any new
  `asteroids/*.json` the map invents — together with a generated snippet of
  `manifest.json` entries, because *a config not listed in the manifest does
  not exist* (the reference doc calls this the single most common integration
  mistake).
- The importer's checklist (§8 of the reference doc) is embedded in doc
  comments at the export call site so it travels with the code.

### State management — a single plain model object

- One in-memory `ArenaConfigInput` model plus a tiny pub/sub (`onChange`
  listeners) is enough; panels write to the model, the scene re-syncs from it.
  No Redux/MobX/signals library — the model *is* the export payload, which
  keeps "what you edit" and "what you ship" structurally identical.

### Testing — vitest

- Schema tests: valid arena passes; over-limit coordinates, non-unit
  `sun.dir`, out-of-bounds spawns, bad id prefixes all fail.
- Export round-trip: parse(export(model)) equals parse(model).
- Equirect math: `dirToEquirect` ∘ `equirectToDir` round-trips, and axis
  conventions are pinned (+X → panorama center, +Y → top edge) so a mapping
  regression can't slip in silently.
- vitest over jest: native ESM/TS via the same Vite pipeline, zero extra config.

## Module architecture

```
src/
  main.ts                  bootstraps the editor
  scene/EditorScene.ts     Babylon viewport: camera, lights, bounds bubble
  scene/placements.ts      (planned) asteroid/spawn gizmos, drag placement
  schema/arena.ts          zod schemas + constants (limits, tolerances)
  export/exportArena.ts    validate → serialize → download; manifest snippet
  skybox/generateSkybox.ts procedural panorama + sun-direction hand-off
  preview/                 (planned) in-builder skybox preview using the
                           game's exact material recipe (emissive panorama,
                           BACKSIDE sphere, black emissiveColor)
  ui/                      (planned) DOM panels: properties, placements,
                           skybox controls, export
```

## Hard constraints the builder enforces (recap)

| Constraint | Where |
| --- | --- |
| No coordinate beyond ±327.67; extent + 20 margin within limit | `schema/arena.ts` |
| `sun.dir` unit vector ± 0.02 | `schema/arena.ts` |
| ≥ 1 spawn point, all inside bounds, pitch ∈ (−π/2, π/2) | `schema/arena.ts` |
| `id` prefixes (`arena.`, `asteroid.`, `notification.`) | `schema/arena.ts` |
| Panorama 2:1 equirectangular, WebP | `skybox/generateSkybox.ts` |
| Radians + left-handed Y-up everywhere | all modules |
