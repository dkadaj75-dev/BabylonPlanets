import { arenaSchema, type ArenaConfigInput } from "../schema/arena";

export interface ArenaExport {
  filename: string;
  json: string;
}

/**
 * Validate an in-memory arena model and serialize it for the game.
 *
 * Import checklist on the game side (docs/space-arena-import-reference.md §8):
 * drop the JSON into content/arenas/, the panorama into content/skyboxes/,
 * add the config path to content/manifest.json — a config not listed in the
 * manifest does not exist as far as the game's loader is concerned — then run
 * `npm run validate:content`.
 *
 * Throws ZodError if the model violates the arena schema.
 */
export function exportArena(input: ArenaConfigInput): ArenaExport {
  const arena = arenaSchema.parse(input);
  const slug = arena.id.slice("arena.".length);
  return {
    filename: `${slug}.json`,
    json: JSON.stringify(arena, null, 2)
  };
}

/** Trigger a browser download of the exported arena JSON. */
export function downloadArena(input: ArenaConfigInput): void {
  const { filename, json } = exportArena(input);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
