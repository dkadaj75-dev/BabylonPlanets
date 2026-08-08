import brokenHalo from "../../examples/broken-halo.json";
import coreOrbit from "../../examples/core-orbit.json";
import lunarCrater from "../../examples/lunar-crater.json";
import lunarCrater3d from "../../examples/lunar-crater-3d.json";
import twinTitans from "../../examples/twin-titans.json";
import { parseArenaJson, type ImportResult } from "../state/importArena";

/**
 * The shipped example maps, bundled into the app.
 *
 * WHY bundle rather than fetch: the editor is a static build served from any
 * mount path (GitHub Pages under /BabylonPlanets/, a file:// copy, a dev
 * server). A runtime fetch of ../examples/*.json would need a base-aware URL
 * and would fail entirely offline; a plain JSON import lets Vite inline the
 * five configs, so "open an example" is instant and cannot 404.
 *
 * WHY explicit imports rather than import.meta.glob: five files, listed once,
 * and every one of them is statically checked. A glob returns
 * `Record<string, unknown>` that TypeScript cannot narrow, which trades the
 * compiler's help for a saving of four lines.
 */

export interface ExampleMap {
  /** Arena id minus the `arena.` prefix — the dropdown value and the slug. */
  id: string;
  /** Display name, matching the arena's own `name` field. */
  name: string;
  /** One line an author can pick a starting point from, not marketing copy. */
  description: string;
  /**
   * The raw config, deliberately `unknown`: callers must go through
   * `loadExampleMap` (and therefore the schema) rather than treating the
   * bundled literal as a trusted model.
   */
  json: unknown;
}

/**
 * Ordered for a dropdown, simplest first, because the list doubles as a
 * learning path: deathmatch maps lead (no flag bases to reason about), then the
 * CTF maps by rock count — the count is what actually makes a map fiddly to
 * read and re-balance, far more than its radius.
 */
export const EXAMPLE_MAPS: ExampleMap[] = [
  {
    id: "twin-titans",
    name: "Twin Titans",
    description:
      "3v3 deathmatch in a 100-radius bubble; two colossal rocks tilted above and below the equator make the whole fight diagonal.",
    json: twinTitans
  },
  {
    id: "core-orbit",
    name: "Core Orbit",
    description:
      "5v5 deathmatch at radius 126, built around a single scaled-up core rock with two colossal outriders and a ring of hazards orbiting it.",
    json: coreOrbit
  },
  {
    id: "broken-halo",
    name: "Broken Halo",
    description:
      "5v5 capture-the-flag at radius 150; the centre is empty and 14 rocks form a shattered ring tilted through ±69 in y, with the flag bases at x = ±124.",
    json: brokenHalo
  },
  {
    id: "lunar-crater",
    name: "Lunar Crater",
    description:
      "5v5 capture-the-flag over a floored crater bowl (radius 180, floorY 0) — everything sits above the ground plane, so it is the one shipped map that is not symmetric in y.",
    json: lunarCrater
  },
  {
    id: "lunar-crater-3d",
    name: "Lunar Crater 3D",
    description:
      "The crater re-cut as a full 3D arena: 5v5 capture-the-flag, radius 126, 35 rocks wrapping above and below a scale-1.8 centrepiece.",
    json: lunarCrater3d
  }
];

/**
 * Load a bundled example by id.
 *
 * Runs the config through `parseArenaJson` — the exact path a user's own file
 * takes, JSON text and all — rather than handing over the imported literal.
 * That costs a stringify per load and buys two things: an example can never
 * become a model the importer would have rejected, and the examples act as a
 * standing regression test of the importer against five real maps.
 *
 * Throws if `id` is unknown, or ZodError if an example ever stops validating.
 */
export function loadExampleMap(id: string): ImportResult {
  const example = EXAMPLE_MAPS.find((m) => m.id === id);
  if (!example) {
    throw new Error(
      `Unknown example map "${id}". Available: ${EXAMPLE_MAPS.map((m) => m.id).join(", ")}.`
    );
  }
  return parseArenaJson(JSON.stringify(example.json));
}
