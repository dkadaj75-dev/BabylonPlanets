// Loaded through Vite's ?raw suffix rather than node:fs: the path is resolved
// relative to THIS file (so the test is cwd-independent) and the project has no
// @types/node, which would make a node:fs import fail `tsc --noEmit`.
import lunarCraterJson from "../../examples/lunar-crater.json?raw";
import lunarCrater3dJson from "../../examples/lunar-crater-3d.json?raw";
import brokenHaloJson from "../../examples/broken-halo.json?raw";
import { describe, expect, it } from "vitest";
import { arenaSchema, type ArenaConfigInput } from "./arena";
import { exportArena } from "../export/exportArena";
import { dirToEquirect, equirectToDir } from "../skybox/generateSkybox";

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

/** The same arena as a capture-the-flag map: one base per team, mirrored in x. */
const ctfArena: ArenaConfigInput = {
  ...validArena,
  id: "arena.test-ctf",
  flagBases: [
    { id: "flag-base-blue", team: 0, position: { x: -96, y: 0, z: 0 }, radius: 16 },
    { id: "flag-base-red", team: 1, position: { x: 96, y: 0, z: 0 }, radius: 16 }
  ]
};

describe("arenaSchema", () => {
  it("accepts a valid minimal arena", () => {
    expect(() => arenaSchema.parse(validArena)).not.toThrow();
  });

  it("rejects coordinates beyond ±327.67", () => {
    const bad: ArenaConfigInput = {
      ...validArena,
      asteroidPlacements: [
        { asteroidId: "asteroid.colossal-a", position: { x: 400, y: 0, z: 0 } }
      ]
    };
    expect(() => arenaSchema.parse(bad)).toThrow(/327\.67/);
  });

  it("rejects a non-unit sun.dir", () => {
    const bad: ArenaConfigInput = {
      ...validArena,
      render: {
        skybox: {
          texture: "skyboxes/test-map.webp",
          sun: { dir: [1, 1, 0], color: "#ffe9d0", intensity: 1 }
        }
      }
    };
    expect(() => arenaSchema.parse(bad)).toThrow(/unit vector/);
  });

  it("rejects a spawn point outside the bounds", () => {
    const bad: ArenaConfigInput = {
      ...validArena,
      spawnPoints: [{ id: "far", team: 0, position: { x: 200, y: 0, z: 200 }, heading: 0 }]
    };
    expect(() => arenaSchema.parse(bad)).toThrow(/outside the arena bounds/);
  });

  it("rejects an id without the arena. prefix", () => {
    expect(() => arenaSchema.parse({ ...validArena, id: "test-map" })).toThrow();
  });

  it("rejects a sphere radius that leaves no projectile margin", () => {
    const bad: ArenaConfigInput = {
      ...validArena,
      bounds: { shape: "sphere", radius: 320 },
      spawnPoints: validArena.spawnPoints
    };
    expect(() => arenaSchema.parse(bad)).toThrow();
  });
});

describe("arenaSchema flagBases", () => {
  /** Issue paths as dotted strings, so a test can pin where a failure is reported. */
  const issuePaths = (input: ArenaConfigInput): string[] => {
    const result = arenaSchema.safeParse(input);
    return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
  };

  const withBases = (
    flagBases: NonNullable<ArenaConfigInput["flagBases"]>
  ): ArenaConfigInput => ({ ...ctfArena, flagBases });

  // Regression: arenaSchema had no flagBases key, and z.object() strips unknown
  // keys, so parse()/exportArena() silently deleted the flag bases of every CTF
  // map — the builder could not round-trip the CTF examples in this repo.
  it("keeps flagBases in the parsed output instead of stripping them", () => {
    const parsed = arenaSchema.parse(ctfArena);
    expect(parsed.flagBases).toHaveLength(2);
    expect(parsed.flagBases?.[0]).toEqual({
      id: "flag-base-blue",
      team: 0,
      position: { x: -96, y: 0, z: 0 },
      radius: 16
    });
    expect(parsed.flagBases?.[1]?.id).toBe("flag-base-red");
  });

  it("rejects a flag base outside the bounds", () => {
    const bad: ArenaConfigInput = {
      ...ctfArena,
      flagBases: [
        { id: "flag-base-blue", team: 0, position: { x: 200, y: 0, z: 200 }, radius: 16 }
      ]
    };
    // The thrown ZodError stringifies its issues, so the quotes around the id
    // arrive escaped — match around them rather than on them.
    expect(() => arenaSchema.parse(bad)).toThrow(
      /flag base .*flag-base-blue.* lies outside the arena bounds/
    );
  });

  // Pins the issue PATH, not just the message. The export panel renders zod
  // issues by path, so a base flagged under the wrong path (or under index 0
  // regardless of which base is bad) is invisible to an author even though
  // validation "failed". The message-only test above cannot see that.
  it("reports the out-of-bounds issue at flagBases.<index>.position", () => {
    const paths = issuePaths(
      withBases([
        { id: "flag-base-blue", team: 0, position: { x: -96, y: 0, z: 0 }, radius: 16 },
        { id: "flag-base-red", team: 1, position: { x: 200, y: 0, z: 200 }, radius: 16 }
      ])
    );
    expect(paths).toContain("flagBases.1.position");
    expect(paths).not.toContain("flagBases.0.position");
  });

  // id/team carry the same constraints as spawnPointSchema; without these the
  // .min(1) and .int().min(0) could be deleted and every other test still pass.
  it("rejects an empty flag base id and a negative or fractional team", () => {
    const position = { x: -96, y: 0, z: 0 };
    expect(issuePaths(withBases([{ id: "", team: 0, position, radius: 16 }]))).toContain(
      "flagBases.0.id"
    );
    expect(
      issuePaths(withBases([{ id: "flag-base-blue", team: -1, position, radius: 16 }]))
    ).toContain("flagBases.0.team");
    expect(
      issuePaths(withBases([{ id: "flag-base-blue", team: 1.5, position, radius: 16 }]))
    ).toContain("flagBases.0.team");
  });

  it("rejects a non-positive flag base radius", () => {
    const bad: ArenaConfigInput = {
      ...ctfArena,
      flagBases: [{ id: "flag-base-blue", team: 0, position: { x: -96, y: 0, z: 0 }, radius: 0 }]
    };
    expect(() => arenaSchema.parse(bad)).toThrow();
  });

  // flagBases is .optional(), never .default([]) — a deathmatch export must not
  // grow an empty array it never had.
  it("does not add a flagBases key to an arena that omits it", () => {
    const parsed = arenaSchema.parse(validArena);
    expect(parsed.flagBases).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(parsed, "flagBases")).toBe(false);
    expect(JSON.parse(exportArena(validArena).json)).not.toHaveProperty("flagBases");
  });

  it("round-trips both flag bases through JSON", () => {
    const roundTripped = JSON.parse(JSON.stringify(arenaSchema.parse(ctfArena)));
    expect(roundTripped.flagBases).toHaveLength(2);
    expect(roundTripped.flagBases.map((fb: { id: string }) => fb.id)).toEqual([
      "flag-base-blue",
      "flag-base-red"
    ]);
    expect(arenaSchema.parse(roundTripped)).toEqual(arenaSchema.parse(ctfArena));
  });

  // Pins the schema to the actual shipped data rather than a hand-written
  // fixture: examples/lunar-crater.json is one of the CTF maps the stripping bug
  // corrupted on export.
  it("parses the shipped examples/lunar-crater.json with its flag bases intact", () => {
    const parsed = arenaSchema.parse(JSON.parse(lunarCraterJson));
    expect(parsed.id).toBe("arena.lunar-crater");
    expect(parsed.flagBases).toEqual([
      { id: "flag-base-blue", team: 0, position: { x: -134, y: 8, z: 0 }, radius: 16 },
      { id: "flag-base-red", team: 1, position: { x: 134, y: 8, z: 0 }, radius: 16 }
    ]);
    expect(JSON.parse(exportArena(parsed).json).flagBases).toHaveLength(2);
  });

  // The other two shipped CTF maps, so the whole set the bug corrupted is
  // covered — one base per team survives an export round-trip.
  for (const [name, raw] of [
    ["lunar-crater-3d.json", lunarCrater3dJson],
    ["broken-halo.json", brokenHaloJson]
  ] as const) {
    it(`exports the shipped examples/${name} without dropping its flag bases`, () => {
      const parsed = arenaSchema.parse(JSON.parse(raw));
      const exported = JSON.parse(exportArena(parsed).json);
      expect(exported.flagBases.map((fb: { team: number }) => fb.team)).toEqual([0, 1]);
    });
  }
});

describe("exportArena", () => {
  it("round-trips arena data through JSON", () => {
    const { filename, json } = exportArena(validArena);
    expect(filename).toBe("test-map.json");
    const reparsed = arenaSchema.parse(JSON.parse(json));
    expect(reparsed).toEqual(arenaSchema.parse(validArena));
  });

  it("throws on invalid input instead of exporting", () => {
    expect(() => exportArena({ ...validArena, spawnPoints: [] })).toThrow();
  });
});

describe("equirectangular mapping", () => {
  it("round-trips directions through UV space", () => {
    const dirs: [number, number, number][] = [
      [1, 0, 0],
      [0, 0, 1],
      [-1, 0, 0],
      [0.5, 0.3, -0.812],
      [0.267, -0.535, 0.802]
    ];
    for (const dir of dirs) {
      const { u, v } = dirToEquirect(dir);
      const back = equirectToDir(u, v);
      const len = Math.hypot(dir[0], dir[1], dir[2]);
      expect(back[0]).toBeCloseTo(dir[0] / len, 5);
      expect(back[1]).toBeCloseTo(dir[1] / len, 5);
      expect(back[2]).toBeCloseTo(dir[2] / len, 5);
    }
  });

  it("maps +X to the panorama center and +Y to the top edge", () => {
    expect(dirToEquirect([1, 0, 0])).toEqual({ u: 0.5, v: 0.5 });
    expect(dirToEquirect([0, 1, 0]).v).toBeCloseTo(0, 5);
  });
});
