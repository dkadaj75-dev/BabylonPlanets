import { arenaSchema } from "../schema/arena";
import type { EditorArena } from "./editorState";

/**
 * Loading an arena config back into the builder.
 *
 * WHY this exists: the builder could only ever emit. An author who wanted to
 * inspect, tweak or remix a shipped map in examples/ — or reopen something they
 * exported five minutes earlier — had to retype every field by hand.
 *
 * WHY it goes through `arenaSchema.parse` and returns the *parsed* result
 * rather than the raw JSON: parsing applies the same defaults and coercions an
 * export does (vec3 `y` defaults to 0, `asteroidPlacements` defaults to []), so
 * an imported model is byte-for-byte what the same map would export as. Import
 * → export is therefore a no-op, and the round-trip cannot quietly reshape a
 * map the game already ships.
 *
 * WHY nothing here names individual arena fields: the schema is the single
 * source of truth for what an arena contains, so every field — including ones
 * added after this file was written — flows through automatically. Hand-rolled
 * field copying is exactly how `flagBases` got silently dropped on export once
 * already (see the note on `flagBases` in src/schema/arena.ts).
 *
 * ZodError is deliberately NOT caught: the export panel already renders
 * field-level zod issues, and the import path wants the identical treatment —
 * "spawnPoints.3.position: coordinate above 327.67" beats "bad file".
 */

export interface ImportResult {
  /** The parsed, normalised model — assign straight onto EditorState.arena. */
  arena: EditorArena;
  /**
   * Non-fatal observations for the author. These are things the import
   * *succeeded* despite, so they belong next to the result rather than in an
   * exception; the UI can render them as a dismissible list.
   */
  warnings: string[];
}

/** How many dropped-key paths to name before collapsing into a count. */
const MAX_LISTED_DROPPED_KEYS = 4;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Own-property test, deliberately not `key in parsed`.
 *
 * `in` walks the prototype chain, so a config carrying a key that happens to
 * collide with Object.prototype — `constructor`, `toString`, `valueOf`,
 * `__proto__` — would answer "still there" after z.object() had stripped it,
 * and the drop would go unreported. That is precisely the silent loss this
 * module exists to surface, so the check has to be own-keys only.
 */
function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Paths present in the file but absent from the parsed model.
 *
 * z.object() strips unknown keys silently, which is the right parsing
 * behaviour but a nasty surprise for an author: `bounds.floorY` (shipped by the
 * crater maps, not yet modelled by our zod mirror) survives a load and then
 * vanishes on the next export. Diffing raw against parsed catches every such
 * key without this module needing to know which keys exist — the same reason
 * the rest of the file is schema-driven.
 *
 * Array indices collapse to `[]` so an unknown key on all 27 placements reads
 * as one `asteroidPlacements[].spin` rather than 27 near-identical lines.
 */
function collectDroppedPaths(
  raw: unknown,
  parsed: unknown,
  path: string,
  out: Set<string>
): void {
  if (Array.isArray(raw) && Array.isArray(parsed)) {
    const shared = Math.min(raw.length, parsed.length);
    for (let i = 0; i < shared; i++) {
      collectDroppedPaths(raw[i], parsed[i], `${path}[]`, out);
    }
    return;
  }
  if (!isPlainObject(raw) || !isPlainObject(parsed)) return;
  for (const key of Object.keys(raw)) {
    const child = path === "" ? key : `${path}.${key}`;
    if (!hasOwn(parsed, key)) {
      out.add(child);
      continue;
    }
    collectDroppedPaths(raw[key], parsed[key], child, out);
  }
}

/**
 * Observations worth surfacing, kept deliberately sparse: a warning list an
 * author learns to ignore is worse than no warning list, so nothing that is
 * simply normal for a valid arena gets a line (an empty `zones` array, an
 * absent `flagBases` on a deathmatch map, a missing optional tint).
 */
function collectWarnings(raw: unknown, arena: EditorArena): string[] {
  const warnings: string[] = [];

  const dropped = new Set<string>();
  collectDroppedPaths(raw, arena, "", dropped);
  if (dropped.size > 0) {
    const listed = [...dropped].slice(0, MAX_LISTED_DROPPED_KEYS);
    const rest = dropped.size - listed.length;
    warnings.push(
      `The builder does not model ${listed.join(", ")}${rest > 0 ? ` and ${rest} more field${rest > 1 ? "s" : ""}` : ""} — ` +
        `${dropped.size > 1 ? "they were" : "it was"} dropped on load and will not be in the next export. ` +
        `Keep the original file if you need ${dropped.size > 1 ? "them" : "it"}.`
    );
  }

  // `zones` is typed as z.array(z.unknown()), so it survives untouched — but
  // the builder gives an author no way to see or edit what is in there, and
  // editing a map blind to part of its content is worth knowing about.
  const zoneCount = arena.zones?.length ?? 0;
  if (zoneCount > 0) {
    warnings.push(
      `This arena declares ${zoneCount} zone${zoneCount > 1 ? "s" : ""}, which the builder cannot edit. ` +
        `They are passed through to the export unchanged.`
    );
  }

  if (!arena.render?.skybox) {
    warnings.push(
      "No render.skybox in this file, so the viewport shows the default preview sky. " +
        "Generate a panorama before exporting if the map is meant to ship one."
    );
  }

  return warnings;
}

/**
 * Parse and validate arena JSON text into an editable model.
 *
 * Throws a plain Error when the text is not JSON at all (a raw
 * `SyntaxError: Unexpected token } in JSON at position 812` tells an author
 * nothing about what they did wrong — usually picking the panorama, a zip, or
 * a truncated file), and lets ZodError propagate when the JSON is well-formed
 * but not a valid arena, so callers can render per-field issues.
 */
export function parseArenaJson(text: string): ImportResult {
  let raw: unknown;
  try {
    // Strip a leading UTF-8 BOM. Blob.text() removes it, but text arriving any
    // other way (a paste box, a drag-and-drop string, fs.readFileSync in a
    // script) keeps it, and JSON.parse rejects it — telling an author their
    // complete, valid file is "not valid JSON ... check the file is complete"
    // is the worst possible diagnosis of a byte they cannot even see.
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown;
  } catch (err) {
    const detail = err instanceof Error ? ` (${err.message})` : "";
    throw new Error(
      `This file is not valid JSON, so it could not be imported${detail}. ` +
        `Pick the arena .json config — not the .webp panorama or an export zip — ` +
        `and check the file is complete.`
    );
  }

  // The parsed result IS the model: same shape as the export payload, with
  // schema defaults applied. Nothing is copied field by field on purpose.
  const arena: EditorArena = arenaSchema.parse(raw);
  return { arena, warnings: collectWarnings(raw, arena) };
}

/**
 * Read a browser File and import it. Thin on purpose — the file input and the
 * drag-and-drop handler both need it, and neither should own parsing rules.
 */
export async function importArenaFile(file: File): Promise<ImportResult> {
  return parseArenaJson(await file.text());
}
