import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { importArenaFile, parseArenaJson } from "./importArena";
import { EXAMPLE_MAPS, loadExampleMap } from "../examples";
import { exportArena } from "../export/exportArena";
import { arenaSchema, type ArenaConfigInput } from "../schema/arena";

const validArena: ArenaConfigInput = {
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
    { id: "b1", team: 1, position: { x: 95, y: -8, z: 95 }, heading: 3.93, pitch: 0.1 }
  ],
  render: {
    skybox: {
      texture: "skyboxes/test-map.webp",
      intensity: 0.9,
      sun: { dir: [0.5, 0.3, -0.812], color: "#ffe9d0", intensity: 1.0 }
    }
  }
};

describe("parseArenaJson — malformed input", () => {
  it("reports a friendly error instead of a raw SyntaxError", () => {
    let thrown: unknown;
    try {
      parseArenaJson('{"id": "arena.oops",');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    // A SyntaxError escaping here would mean the raw parser message reached the
    // author, which is the exact failure this wrapper exists to prevent.
    expect(thrown).not.toBeInstanceOf(SyntaxError);
    expect((thrown as Error).message).toMatch(/not valid JSON/i);
    expect((thrown as Error).message).toMatch(/arena \.json/i);
  });

  it("rejects an empty file with the same friendly error", () => {
    expect(() => parseArenaJson("")).toThrow(/not valid JSON/i);
  });

  it("rejects binary-ish content (a panorama picked by mistake)", () => {
    expect(() => parseArenaJson("RIFF\u0000\u0000WEBPVP8 ")).toThrow(/not valid JSON/i);
  });
});

describe("parseArenaJson — export/import round trip", () => {
  // Generated with exportArena rather than a hand-written fixture so the test
  // pins export → import compatibility: if either side drifts, this breaks.
  it("reproduces the exported model exactly", () => {
    const { json } = exportArena(validArena);
    const { arena } = parseArenaJson(json);
    expect(arena).toEqual(arenaSchema.parse(validArena));
  });

  it("re-exports byte-identical JSON, so import is not a lossy step", () => {
    const first = exportArena(validArena);
    const { arena } = parseArenaJson(first.json);
    expect(exportArena(arena)).toEqual(first);
  });

  it("applies schema defaults, so a terse file loads as a full model", () => {
    const terse = JSON.stringify({
      id: "arena.terse",
      type: "arena",
      version: 1,
      name: "Terse",
      bounds: { shape: "sphere", radius: 100 },
      // no asteroidPlacements, and a spawn position with no y
      spawnPoints: [{ id: "a1", team: 0, position: { x: 0, z: 10 }, heading: 0 }]
    });
    const { arena } = parseArenaJson(terse);
    expect(arena.asteroidPlacements).toEqual([]);
    expect(arena.spawnPoints[0]?.position.y).toBe(0);
  });

  it("keeps a zones array the builder does not edit", () => {
    const withZones = JSON.stringify({ ...validArena, zones: [{ kind: "hazard", radius: 12 }] });
    const { arena } = parseArenaJson(withZones);
    expect(arena.zones).toEqual([{ kind: "hazard", radius: 12 }]);
  });
});

describe("parseArenaJson — schema violations", () => {
  it("throws ZodError for a coordinate past the ±327.67 wire limit", () => {
    const bad = JSON.stringify({
      ...validArena,
      asteroidPlacements: [
        { asteroidId: "asteroid.colossal-a", position: { x: 400, y: 0, z: 0 } }
      ]
    });
    expect(() => parseArenaJson(bad)).toThrow(ZodError);
    expect(() => parseArenaJson(bad)).toThrow(/327\.67/);
  });

  it("throws ZodError for a spawn point outside the bounds", () => {
    const bad = JSON.stringify({
      ...validArena,
      spawnPoints: [{ id: "far", team: 0, position: { x: 200, y: 0, z: 200 }, heading: 0 }]
    });
    expect(() => parseArenaJson(bad)).toThrow(ZodError);
    expect(() => parseArenaJson(bad)).toThrow(/outside the arena bounds/);
  });

  it("throws ZodError for well-formed JSON that is not an arena at all", () => {
    expect(() => parseArenaJson('{"hello": "world"}')).toThrow(ZodError);
    expect(() => parseArenaJson("[1, 2, 3]")).toThrow(ZodError);
  });

  it("surfaces the offending field path so the UI can point at it", () => {
    const bad = JSON.stringify({ ...validArena, id: "test-map" });
    try {
      parseArenaJson(bad);
      expect.unreachable("expected a ZodError");
    } catch (err) {
      expect(err).toBeInstanceOf(ZodError);
      expect((err as ZodError).issues[0]?.path).toEqual(["id"]);
    }
  });
});

describe("parseArenaJson — warnings", () => {
  it("stays silent on a clean arena", () => {
    const { warnings } = parseArenaJson(exportArena(validArena).json);
    expect(warnings).toEqual([]);
  });

  it("does not warn about an empty zones array, which is normal", () => {
    const { warnings } = parseArenaJson(JSON.stringify({ ...validArena, zones: [] }));
    expect(warnings).toEqual([]);
  });

  it("warns that zones are passed through untouched", () => {
    const { warnings } = parseArenaJson(
      JSON.stringify({ ...validArena, zones: [{ kind: "hazard" }, { kind: "heal" }] })
    );
    expect(warnings).toContainEqual(expect.stringMatching(/2 zones/));
  });

  it("warns when there is no render.skybox", () => {
    const { render: _render, ...noSky } = validArena;
    const { warnings } = parseArenaJson(JSON.stringify(noSky));
    expect(warnings).toContainEqual(expect.stringMatching(/render\.skybox/));
  });

  it("warns about fields the schema drops, naming the path", () => {
    const { warnings } = parseArenaJson(
      JSON.stringify({ ...validArena, bounds: { shape: "sphere", radius: 150, floorY: 0 } })
    );
    expect(warnings).toContainEqual(expect.stringMatching(/bounds\.floorY/));
  });

  it("names a dropped key that collides with Object.prototype", () => {
    // `key in parsed` is true for `constructor`/`toString`/`__proto__` even
    // after z.object() strips them, so an own-key check is the only thing that
    // makes these visible. Without it the import loses them in total silence.
    const { warnings } = parseArenaJson(
      JSON.stringify({ ...validArena, constructor: 1, toString: 2, valueOf: 3 })
    );
    expect(warnings).toContainEqual(expect.stringMatching(/constructor/));
    expect(warnings).toContainEqual(expect.stringMatching(/toString/));
    expect(warnings).toContainEqual(expect.stringMatching(/valueOf/));
  });

  it("caps the named paths and counts the rest", () => {
    const { warnings } = parseArenaJson(
      JSON.stringify({ ...validArena, k1: 1, k2: 2, k3: 3, k4: 4, k5: 5, k6: 6 })
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("k1, k2, k3, k4 and 2 more fields");
    expect(warnings[0]).not.toContain("k5");
  });

  it("accepts a file saved with a UTF-8 BOM", () => {
    const { warnings, arena } = parseArenaJson("﻿" + exportArena(validArena).json);
    expect(arena.id).toBe("arena.test-map");
    expect(warnings).toEqual([]);
  });

  it("collapses a dropped key repeated across an array into one warning", () => {
    const { warnings } = parseArenaJson(
      JSON.stringify({
        ...validArena,
        asteroidPlacements: [
          { asteroidId: "asteroid.small-rock", position: { x: 10, y: 0, z: 0 }, spin: 1 },
          { asteroidId: "asteroid.small-rock", position: { x: -10, y: 0, z: 0 }, spin: 2 }
        ]
      })
    );
    const dropped = warnings.filter((w) => w.includes("asteroidPlacements[].spin"));
    expect(dropped).toHaveLength(1);
  });
});

describe("importArenaFile", () => {
  it("imports a browser File the same way as raw text", async () => {
    const { json } = exportArena(validArena);
    const file = new File([json], "test-map.json", { type: "application/json" });
    const result = await importArenaFile(file);
    expect(result).toEqual(parseArenaJson(json));
  });

  it("rejects a File that is not JSON with the friendly error", async () => {
    const file = new File(["not json at all"], "panorama.webp");
    await expect(importArenaFile(file)).rejects.toThrow(/not valid JSON/i);
  });
});

describe("EXAMPLE_MAPS", () => {
  it("ships all five maps with unique ids and a description each", () => {
    expect(EXAMPLE_MAPS).toHaveLength(5);
    expect(new Set(EXAMPLE_MAPS.map((m) => m.id)).size).toBe(5);
    // The ids double as dropdown values and as export filenames, so they are
    // part of the contract, not incidental — pin them, order included.
    expect(EXAMPLE_MAPS.map((m) => m.id)).toEqual([
      "twin-titans",
      "core-orbit",
      "broken-halo",
      "lunar-crater",
      "lunar-crater-3d"
    ]);
    for (const map of EXAMPLE_MAPS) {
      expect(map.description.length).toBeGreaterThan(20);
    }
  });

  // The key test: every bundled example goes through the real importer, so a
  // corrupt or schema-violating example fails here rather than in the editor.
  for (const map of EXAMPLE_MAPS) {
    it(`loads ${map.id} through the importer`, () => {
      const { arena } = loadExampleMap(map.id);
      expect(arena.id).toBe(`arena.${map.id}`);
      expect(arena.name).toBe(map.name);
      // A loaded example must be immediately re-exportable, and must land back
      // on its own filename — that is what makes "open an example, tweak,
      // export" a closed loop, and it pins ExampleMap.id as the arena slug.
      const exported = exportArena(arena);
      expect(exported.filename).toBe(`${map.id}.json`);
      // Idempotent on real data, not just on the hand-written fixture above:
      // a second trip through the importer must not shift a single field.
      expect(parseArenaJson(exported.json).arena).toEqual(arena);
    });
  }

  // The report on this module claims four of the five load silently and only
  // lunar-crater warns. Nothing pinned that, so an unmodelled key or a dropped
  // skybox sneaking into an example JSON would have gone unnoticed.
  it("imports every example except lunar-crater with no warnings at all", () => {
    for (const map of EXAMPLE_MAPS) {
      const { warnings } = loadExampleMap(map.id);
      if (map.id === "lunar-crater") {
        expect(warnings).toHaveLength(1);
      } else {
        expect(warnings, `${map.id} should import cleanly`).toEqual([]);
      }
    }
  });

  it("throws a helpful error for an unknown id", () => {
    expect(() => loadExampleMap("no-such-map")).toThrow(/Unknown example map/);
    expect(() => loadExampleMap("no-such-map")).toThrow(/twin-titans/);
  });

  // arenaSchema carries flagBases as of this commit, so this asserts on the
  // real values unconditionally: were the key ever dropped from the schema
  // again, z.object() would strip the bases and this test would fail loudly —
  // which is the point (see the flagBases note in src/schema/arena.ts).
  it("preserves the flag bases of a CTF example", () => {
    const { arena } = loadExampleMap("lunar-crater");
    expect(arena.flagBases).toEqual([
      { id: "flag-base-blue", team: 0, position: { x: -134, y: 8, z: 0 }, radius: 16 },
      { id: "flag-base-red", team: 1, position: { x: 134, y: 8, z: 0 }, radius: 16 }
    ]);
    expect(JSON.parse(exportArena(arena).json).flagBases).toHaveLength(2);
  });

  it("does not invent flag bases on the deathmatch examples", () => {
    for (const id of ["twin-titans", "core-orbit"]) {
      expect(loadExampleMap(id).arena.flagBases).toBeUndefined();
    }
  });

  it("reports the crater's unmodelled bounds.floorY rather than losing it silently", () => {
    const { warnings } = loadExampleMap("lunar-crater");
    expect(warnings).toContainEqual(expect.stringMatching(/bounds\.floorY/));
  });
});
