import { exportArena } from "./exportArena";
import { createZip, type ZipEntry } from "./zip";
import type { EditorArena } from "../state/editorState";

/**
 * Full content-tree export: a .zip laid out exactly like the game's `content/`
 * folder, so importing a map is "unzip over content/" instead of a manual
 * file-by-file copy where one step gets skipped.
 *
 * The archive mirrors docs/space-arena-import-reference.md §7:
 *
 *   arenas/<slug>.json          the validated arena config
 *   skyboxes/<slug>.webp        the generated panorama (only if there is one)
 *   manifest-snippet.json       the lines to merge into content/manifest.json
 *
 * The manifest snippet is the whole point of shipping a bundle rather than two
 * loose files: *a config that is not listed in content/manifest.json does not
 * exist as far as the game's loader is concerned*, and the reference doc calls
 * forgetting it the single most common integration mistake (§7, §8 step 5).
 */

export interface BundleInput {
  arena: EditorArena;
  /** the generated panorama, if the author produced one */
  skybox?: Blob | null;
}

export interface ArenaBundle {
  /** suggested download name, `<slug>-content.zip` */
  filename: string;
  blob: Blob;
  /** paths to merge into content/manifest.json's `files` array */
  manifestEntries: string[];
  /** every path inside the archive, in order — for the export panel to list */
  contents: string[];
}

/** Fixed archive member holding the manifest lines; not part of the game's tree. */
const MANIFEST_SNIPPET_PATH = "manifest-snippet.json";

const MANIFEST_SNIPPET_COMMENT =
  "Merge these paths into the `files` array of the game's content/manifest.json — " +
  "do not replace that file, its existing entries must stay. A config that is not " +
  "listed in the manifest does not exist as far as the loader is concerned. Then run " +
  "`npm run validate:content` on the game side.";

/**
 * Pick the panorama's file extension from the blob's real MIME type.
 *
 * Safari cannot encode WebP, and the canvas spec says an unsupported type
 * silently falls back to PNG — so `generateSkybox()` can hand us PNG bytes even
 * though it asked for WebP. Naming those bytes `.webp` would ship a file whose
 * extension lies about its contents, which the game's texture loader and the
 * content gate both have every right to reject. Trust the blob, not the intent.
 */
function skyboxExtension(mimeType: string): string {
  return mimeType === "image/webp" ? "webp" : "png";
}

function manifestSnippetJson(files: string[]): string {
  // Two-space pretty printing, matching exportArena() and the shipped configs.
  return JSON.stringify({ _comment: MANIFEST_SNIPPET_COMMENT, files }, null, 2);
}

/**
 * Validate the arena and assemble the content-tree archive.
 *
 * Validation goes through exportArena() rather than re-parsing here, so the
 * JSON inside the bundle is byte-identical to the single-file export and schema
 * errors surface the same way in both paths. ZodError is deliberately allowed
 * to propagate (as a rejection) — the caller renders it; swallowing it would
 * hand the author an archive the game refuses to load.
 *
 * Pure and DOM-free on purpose, so it is unit-testable; downloadArenaBundle()
 * is the thin browser wrapper.
 */
export async function buildArenaBundle(input: BundleInput): Promise<ArenaBundle> {
  const { filename: arenaFilename, json } = exportArena(input.arena);
  // Derived from exportArena()'s own filename rather than re-deriving from the
  // id, so the bundle's slug can never drift from the single-file export's.
  const slug = arenaFilename.replace(/\.json$/, "");
  const encoder = new TextEncoder();

  const arenaPath = `arenas/${arenaFilename}`;
  const entries: ZipEntry[] = [{ path: arenaPath, data: encoder.encode(json) }];
  const manifestEntries: string[] = [arenaPath];

  if (input.skybox) {
    const skyboxPath = `skyboxes/${slug}.${skyboxExtension(input.skybox.type)}`;
    entries.push({
      path: skyboxPath,
      data: new Uint8Array(await input.skybox.arrayBuffer())
    });
    manifestEntries.push(skyboxPath);
  }

  entries.push({
    path: MANIFEST_SNIPPET_PATH,
    data: encoder.encode(manifestSnippetJson(manifestEntries))
  });

  return {
    filename: `${slug}-content.zip`,
    blob: createZip(entries),
    manifestEntries,
    contents: entries.map((entry) => entry.path)
  };
}

/**
 * Trigger a browser download of the content bundle.
 *
 * Mirrors downloadArena(): build, hand the blob to an anchor, revoke. Returns
 * the bundle so the export panel can list `contents` / `manifestEntries`
 * without paying to build the archive a second time.
 */
export async function downloadArenaBundle(input: BundleInput): Promise<ArenaBundle> {
  const bundle = await buildArenaBundle(input);
  const url = URL.createObjectURL(bundle.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = bundle.filename;
  a.click();
  URL.revokeObjectURL(url);
  return bundle;
}
