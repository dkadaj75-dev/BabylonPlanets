# BabylonPlanets

A standalone, browser-based **Babylon.js map / planet / skybox builder** for
Space Arena. Build an arena visually — bounds, asteroid placements, spawn
points, flag bases — generate an equirectangular skybox panorama, and export
game-ready data: an `arena.*` JSON config plus a `.webp` panorama that drop
straight into the game's `content/` tree.

- **Load** any of the shipped example maps from a dropdown, open an exported
  `.json`, or drop one onto the viewport.
- **Geometry check** runs the game's `shippedArenaGeometry` rules live as you
  edit — extent, spawn corridor, centrepiece clearance, rock separation,
  vertical spread — so a map that would fail the game's CI says so here first.
- **Export** either the single arena JSON or the whole `content/` tree as a
  zip, manifest snippet included.

- **Tech stack & architecture:** [TECH_STACK.md](TECH_STACK.md)
- **Export target format (authoritative):** [docs/space-arena-import-reference.md](docs/space-arena-import-reference.md)
- **AI map-design prompt + worked examples:** [docs/MAP-DESIGN-PROMPT.md](docs/MAP-DESIGN-PROMPT.md), [examples/](examples/)

## Getting started

```bash
npm install
npm run dev        # editor at http://localhost:5173
```

Other scripts:

```bash
npm run build      # production build to dist/
npm run test       # vitest — schema / export / equirect-math tests
npm run typecheck  # tsc --noEmit (strict)
```

## What exports look like

`exportArena()` validates the in-memory arena against a zod schema that mirrors
the game's — including the hard ±327.67 coordinate limit and the
`|sun.dir| = 1 ± 0.02` check — and produces `<slug>.json`. On the game side,
drop the JSON into `content/arenas/`, the panorama into `content/skyboxes/`,
add the config path to `content/manifest.json`, then run
`npm run validate:content` there. See §8 of the reference doc for the full
checklist.
