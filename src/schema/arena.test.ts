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
