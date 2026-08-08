import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { buildArenaBundle } from "./exportBundle";
import { exportArena } from "./exportArena";
import type { EditorArena } from "../state/editorState";

const decoder = new TextDecoder();

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const END_OF_CENTRAL_DIRECTORY_SIZE = 22;

const arena: EditorArena = {
  id: "arena.test-map",
  type: "arena",
  version: 1,
  name: "Test Map",
  bounds: { shape: "sphere", radius: 150 },
  asteroidPlacements: [
    { asteroidId: "asteroid.colossal-a", position: { x: 0, y: 0, z: 0 }, scale: 1.5 }
  ],
  spawnPoints: [
    { id: "a1", team: 0, position: { x: -95, y: 8, z: -95 }, heading: 0.79 },
    { id: "b1", team: 1, position: { x: 95, y: -8, z: 95 }, heading: 3.93 }
  ],
  render: {
    skybox: {
      texture: "skyboxes/test-map.webp",
      sun: { dir: [0.5, 0.3, -0.812], color: "#ffe9d0", intensity: 1 }
    }
  }
};

/** Stand-in panorama bytes — the writer stores them verbatim, so any bytes do. */
function fakePanorama(type: string): Blob {
  const bytes = new Uint8Array(512);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 0xff;
  return new Blob([bytes], { type });
}

/** Minimal central-directory walk, mirroring what an unzip tool does. */
async function readArchive(blob: Blob): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const eocd = bytes.length - END_OF_CENTRAL_DIRECTORY_SIZE;
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);

  const files = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    const size = view.getUint32(p + 20, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const path = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength));

    expect(view.getUint32(localOffset, true)).toBe(LOCAL_FILE_HEADER_SIGNATURE);
    const dataStart =
      localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    files.set(path, bytes.slice(dataStart, dataStart + size));

    p += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

async function readText(blob: Blob, path: string): Promise<string> {
  const files = await readArchive(blob);
  const data = files.get(path);
  if (data === undefined) throw new Error(`archive has no "${path}"`);
  return decoder.decode(data);
}

describe("buildArenaBundle layout", () => {
  it("names the download after the slug and lists the archive contents", async () => {
    const bundle = await buildArenaBundle({ arena });
    expect(bundle.filename).toBe("test-map-content.zip");
    expect(bundle.contents).toEqual(["arenas/test-map.json", "manifest-snippet.json"]);
    expect(bundle.blob.type).toBe("application/zip");
  });

  it("writes arenas/<slug>.json with exactly the single-file export's JSON", async () => {
    const bundle = await buildArenaBundle({ arena });
    const inArchive = await readText(bundle.blob, "arenas/test-map.json");
    expect(inArchive).toBe(exportArena(arena).json);
    expect(JSON.parse(inArchive)).toEqual(JSON.parse(exportArena(arena).json));
  });

  it("omits skyboxes/ entirely when no panorama was generated", async () => {
    for (const skybox of [undefined, null]) {
      const bundle = await buildArenaBundle({ arena, skybox });
      const files = await readArchive(bundle.blob);
      expect([...files.keys()]).toEqual(["arenas/test-map.json", "manifest-snippet.json"]);
      expect(bundle.manifestEntries).toEqual(["arenas/test-map.json"]);
    }
  });

  it("includes the panorama byte-for-byte when one is supplied", async () => {
    const skybox = fakePanorama("image/webp");
    const bundle = await buildArenaBundle({ arena, skybox });
    expect(bundle.contents).toEqual([
      "arenas/test-map.json",
      "skyboxes/test-map.webp",
      "manifest-snippet.json"
    ]);
    const files = await readArchive(bundle.blob);
    const expected = new Uint8Array(await skybox.arrayBuffer());
    expect(Array.from(files.get("skyboxes/test-map.webp") ?? [])).toEqual(Array.from(expected));
  });
});

describe("buildArenaBundle skybox extension", () => {
  // Safari falls back to PNG when asked to encode WebP; shipping those bytes as
  // .webp would be a file whose name lies about its contents.
  it("names a non-webp panorama .png, in the archive and the manifest", async () => {
    const bundle = await buildArenaBundle({ arena, skybox: fakePanorama("image/png") });
    expect(bundle.contents).toContain("skyboxes/test-map.png");
    expect(bundle.contents).not.toContain("skyboxes/test-map.webp");
    expect(bundle.manifestEntries).toEqual(["arenas/test-map.json", "skyboxes/test-map.png"]);
    const files = await readArchive(bundle.blob);
    expect(files.has("skyboxes/test-map.png")).toBe(true);
  });

  it("treats an unknown or missing blob type as the PNG fallback", async () => {
    const bundle = await buildArenaBundle({ arena, skybox: new Blob([new Uint8Array([1, 2, 3])]) });
    expect(bundle.contents).toContain("skyboxes/test-map.png");
  });
});

describe("buildArenaBundle manifest snippet", () => {
  it("lists exactly the archive's game-content paths", async () => {
    const bundle = await buildArenaBundle({ arena, skybox: fakePanorama("image/webp") });
    const snippet = JSON.parse(await readText(bundle.blob, "manifest-snippet.json"));

    expect(snippet.files).toEqual(bundle.manifestEntries);
    expect(snippet.files).toEqual(["arenas/test-map.json", "skyboxes/test-map.webp"]);
    // Every manifest entry is really in the archive, and manifest-snippet.json
    // itself is not (it is instructions, not game content).
    const files = await readArchive(bundle.blob);
    for (const entry of bundle.manifestEntries) expect(files.has(entry)).toBe(true);
    expect(snippet.files).not.toContain("manifest-snippet.json");
  });

  it("explains that the lines must be merged into the existing manifest", async () => {
    const bundle = await buildArenaBundle({ arena });
    const snippet = JSON.parse(await readText(bundle.blob, "manifest-snippet.json"));
    expect(typeof snippet._comment).toBe("string");
    expect(snippet._comment).toMatch(/merge/i);
    expect(snippet._comment).toMatch(/manifest\.json/);
    expect(snippet._comment).toMatch(/does not exist/i);
  });
});

describe("buildArenaBundle validation", () => {
  it("rejects with a ZodError instead of bundling an invalid arena", async () => {
    await expect(buildArenaBundle({ arena: { ...arena, spawnPoints: [] } })).rejects.toBeInstanceOf(
      ZodError
    );
  });

  it("propagates the schema's own message for an out-of-bounds coordinate", async () => {
    const bad: EditorArena = {
      ...arena,
      asteroidPlacements: [{ asteroidId: "asteroid.colossal-a", position: { x: 400, y: 0, z: 0 } }]
    };
    await expect(buildArenaBundle({ arena: bad })).rejects.toThrow(/327\.67/);
  });

  it("rejects an id without the arena. prefix", async () => {
    await expect(buildArenaBundle({ arena: { ...arena, id: "test-map" } })).rejects.toBeInstanceOf(
      ZodError
    );
  });
});

describe("buildArenaBundle determinism", () => {
  it("produces identical archive bytes for identical input", async () => {
    const skybox = fakePanorama("image/webp");
    const first = new Uint8Array(await (await buildArenaBundle({ arena, skybox })).blob.arrayBuffer());
    const second = new Uint8Array(
      await (await buildArenaBundle({ arena, skybox })).blob.arrayBuffer()
    );
    expect(Array.from(first)).toEqual(Array.from(second));
  });
});
