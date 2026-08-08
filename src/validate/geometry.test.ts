import { describe, expect, it } from "vitest";
import {
  ASTEROID_COLLIDER_RADII,
  MIN_CORRIDOR_CLEARANCE,
  validateGeometry,
  type Diagnostic,
  type GeometryReport
} from "./geometry";
import { arenaSchema } from "../schema/arena";
import type { EditorArena } from "../state/editorState";

/**
 * This repo carries no @types/node (it is a browser tool), so `node:fs` cannot
 * be imported by literal specifier without failing `tsc --noEmit`. Routing the
 * import through a widened string keeps the type checker out of it while
 * vitest, which runs on Node, resolves it normally at runtime.
 */
interface NodeFs {
  readFileSync(path: URL | string, encoding: "utf8"): string;
}
const NODE_FS: string = "node:fs";

async function readExample(name: string): Promise<EditorArena> {
  const fs = (await import(NODE_FS)) as unknown as NodeFs;
  const url = new URL(`../../examples/${name}.json`, import.meta.url);
  return JSON.parse(fs.readFileSync(url, "utf8")) as EditorArena;
}

type Placement = EditorArena["asteroidPlacements"][number];
type Spawn = EditorArena["spawnPoints"][number];

function rock(
  asteroidId: string,
  x: number,
  y: number,
  z: number,
  scale?: number
): Placement {
  return scale === undefined
    ? { asteroidId, position: { x, y, z } }
    : { asteroidId, position: { x, y, z }, scale };
}

/**
 * A deliberately clean arena: every hard rule passes with margin, and the four
 * rocks are mirror twins so the advisory rule is silent too. Each test below
 * perturbs exactly one thing, so an assertion failure names the rule that
 * broke rather than "the fixture drifted".
 *
 * Spawn centroids land on (-100, 0, 0) and (+100, 0, 0), i.e. the corridor is
 * the x axis; rocks sit 40 units off it in both y and z.
 */
function baseArena(): EditorArena {
  return {
    id: "arena.fixture",
    type: "arena",
    version: 1,
    name: "Fixture",
    bounds: { shape: "sphere", radius: 150 },
    asteroidPlacements: [
      rock("asteroid.large-hazard", 40, 40, 40),
      rock("asteroid.large-hazard-b", -40, 40, 40),
      rock("asteroid.large-hazard-b", 40, -40, -40),
      rock("asteroid.large-hazard", -40, -40, -40)
    ],
    spawnPoints: [
      { id: "a1", team: 0, position: { x: -100, y: 0, z: -8 }, heading: 0 },
      { id: "a2", team: 0, position: { x: -100, y: 0, z: 0 }, heading: 0 },
      { id: "a3", team: 0, position: { x: -100, y: 0, z: 8 }, heading: 0 },
      { id: "b1", team: 1, position: { x: 100, y: 0, z: -8 }, heading: Math.PI },
      { id: "b2", team: 1, position: { x: 100, y: 0, z: 0 }, heading: Math.PI },
      { id: "b3", team: 1, position: { x: 100, y: 0, z: 8 }, heading: Math.PI }
    ]
  };
}

function errors(report: GeometryReport, rule?: string): Diagnostic[] {
  return report.diagnostics.filter(
    (d) => d.severity === "error" && (rule === undefined || d.rule === rule)
  );
}

function ofRule(report: GeometryReport, rule: string): Diagnostic[] {
  return report.diagnostics.filter((d) => d.rule === rule);
}

describe("validateGeometry — the clean baseline", () => {
  it("passes every rule with no diagnostics at all", () => {
    const report = validateGeometry(baseArena());
    expect(report.diagnostics).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("reports useful stats", () => {
    const { stats } = validateGeometry(baseArena());
    expect(stats.rockCount).toBe(4);
    expect(stats.centrepieceCount).toBe(0);
    expect(stats.unknownAsteroidCount).toBe(0);
    expect(stats.teamCount).toBe(2);
    expect(stats.boundsRadius).toBe(150);
    expect(stats.yMin).toBe(-40);
    expect(stats.yMax).toBe(40);
    // |P| = sqrt(3) * 40 = 69.28, plus the large-hazard collider radius 8.
    expect(stats.maxExtent).toBeCloseTo(Math.hypot(40, 40, 40) + 8, 6);
    // Nearest pair is the mirrored pair 80 apart, minus two radii of 8.
    expect(stats.minSurfaceGap).toBeCloseTo(64, 6);
  });

  it("does not mutate the arena it is handed", () => {
    const arena = baseArena();
    const before = JSON.stringify(arena);
    validateGeometry(arena);
    expect(JSON.stringify(arena)).toBe(before);
  });
});

describe("rule 1 — extent", () => {
  it("passes when |P| + r fits inside the bounds radius", () => {
    const arena = baseArena();
    // hypot(130, 40, 40) + 8 = 142.7 <= 150
    arena.asteroidPlacements[0] = rock("asteroid.large-hazard", 130, 40, 40);
    expect(errors(validateGeometry(arena), "extent")).toHaveLength(0);
  });

  it("fails when the collider pokes through the bounds", () => {
    const arena = baseArena();
    // hypot(140, 40, 40) + 8 = 159 > 150
    arena.asteroidPlacements[0] = rock("asteroid.large-hazard", 140, 40, 40);
    const report = validateGeometry(arena);
    const found = errors(report, "extent");
    expect(found).toHaveLength(1);
    expect(report.ok).toBe(false);
    expect(found[0]?.placementIndices).toEqual([0]);
    expect(found[0]?.message).toContain("159");
    expect(found[0]?.message).toContain("150");
  });

  it("counts the scale multiplier into the radius", () => {
    const arena = baseArena();
    // colossal at scale 2 => r = 36; 120 + 36 = 156 > 150.
    arena.asteroidPlacements = [rock("asteroid.colossal-a", 120, 0, 0, 2)];
    expect(errors(validateGeometry(arena), "extent")).toHaveLength(1);
  });

  it("skips the rule for rect bounds and says so", () => {
    const arena = baseArena();
    arena.bounds = { shape: "rect", width: 400, height: 400, verticalExtent: 200 };
    const report = validateGeometry(arena);
    const info = ofRule(report, "extent");
    expect(info).toHaveLength(1);
    expect(info[0]?.severity).toBe("info");
    expect(info[0]?.message).toContain("sphere-only");
    expect(report.ok).toBe(true);
    expect(report.stats.boundsRadius).toBeNull();
  });
});

describe("rule 2 — corridor", () => {
  it("passes when rocks stay clear of the spawn-to-spawn segment", () => {
    // Baseline rocks sit hypot(40, 40) = 56.6 off the axis; 56.6 - 8 = 48.6.
    expect(errors(validateGeometry(baseArena()), "corridor")).toHaveLength(0);
  });

  it("fails when a rock crowds the segment", () => {
    const arena = baseArena();
    // 12 units off the axis, radius 8 => 4 units of surface clearance.
    arena.asteroidPlacements.push(rock("asteroid.large-hazard", 0, 12, 0));
    const report = validateGeometry(arena);
    const found = errors(report, "corridor");
    expect(found).toHaveLength(1);
    expect(report.ok).toBe(false);
    expect(found[0]?.placementIndices).toEqual([4]);
    expect(found[0]?.message).toContain("surface clearance 4 ");
    expect(found[0]?.message).toContain(`>= ${MIN_CORRIDOR_CLEARANCE}`);
    expect(found[0]?.spawnIds).toEqual(["a1", "a2", "a3", "b1", "b2", "b3"]);
  });

  it("measures the segment, not the infinite line through it", () => {
    const arena = baseArena();
    // Dead on the corridor's axis but 40 units BEYOND the +x spawn centroid:
    // point-to-line distance is 0, point-to-segment distance is 40.
    arena.asteroidPlacements.push(rock("asteroid.large-hazard", 140, 0, 0));
    const beyond = validateGeometry(arena);
    expect(errors(beyond, "corridor")).toHaveLength(0);
    expect(beyond.ok).toBe(true);

    // The same rock slid back onto the segment must fail, proving the check is
    // live and the pass above came from the clamp rather than from apathy.
    arena.asteroidPlacements[4] = rock("asteroid.large-hazard", 60, 0, 0);
    expect(errors(validateGeometry(arena), "corridor")).toHaveLength(1);
  });

  it("skips the rule when fewer than two teams have spawn points", () => {
    const arena = baseArena();
    arena.spawnPoints = arena.spawnPoints.map((sp: Spawn) => ({ ...sp, team: 0 }));
    // A rock that would violate the corridor if there were one.
    arena.asteroidPlacements.push(rock("asteroid.large-hazard", 0, 12, 0));
    const report = validateGeometry(arena);
    expect(errors(report, "corridor")).toHaveLength(0);
    const info = ofRule(report, "corridor");
    expect(info).toHaveLength(1);
    expect(info[0]?.severity).toBe("info");
    expect(report.ok).toBe(true);
    expect(report.stats.teamCount).toBe(1);
  });

  it("skips ONLY the corridor rule on a one-team map, not rule 3 as well", () => {
    const arena = baseArena();
    // One team, and a spawn pad buried inside the centrepiece's collider.
    arena.spawnPoints = [{ id: "solo", team: 0, position: { x: 2, y: 0, z: 0 }, heading: 0 }];
    arena.asteroidPlacements.push(rock("asteroid.colossal-a", 0, 0, 0, 1.5));
    const report = validateGeometry(arena);
    expect(report.stats.teamCount).toBe(1);
    // Rule 2 genuinely needs two teams; rule 3 does not, and must still fire.
    expect(ofRule(report, "corridor")[0]?.severity).toBe("info");
    const found = errors(report, "centrepiece-clearance");
    expect(found).toHaveLength(1);
    expect(found[0]?.spawnIds).toEqual(["solo"]);
    expect(report.ok).toBe(false);
  });
});

describe("rule 2 — the centrepiece exemption", () => {
  /** colossal-a at scale 1.5 => r = 27, so it swallows the origin. */
  const CENTREPIECE_SCALE = 1.5;

  it("exempts a rock whose collider overlaps the origin", () => {
    const arena = baseArena();
    arena.asteroidPlacements.push(
      rock("asteroid.colossal-a", 0, 0, 0, CENTREPIECE_SCALE)
    );
    const report = validateGeometry(arena);
    expect(errors(report, "corridor")).toHaveLength(0);
    expect(report.ok).toBe(true);
    expect(report.stats.centrepieceCount).toBe(1);
  });

  it("stops exempting it once it no longer overlaps the origin", () => {
    const arena = baseArena();
    // |P| = 30 > r = 27, so this is an ordinary rock parked in the lane.
    arena.asteroidPlacements.push(
      rock("asteroid.colossal-a", 30, 0, 0, CENTREPIECE_SCALE)
    );
    const report = validateGeometry(arena);
    const found = errors(report, "corridor");
    expect(found).toHaveLength(1);
    expect(found[0]?.placementIndices).toEqual([4]);
    expect(report.ok).toBe(false);
    expect(report.stats.centrepieceCount).toBe(0);
  });
});

describe("rule 3 — centrepiece clearance", () => {
  it("passes when the centrepiece keeps 30 units of surface off every spawn", () => {
    const arena = baseArena();
    // r = 27, nearest spawn 100.3 away => 73.3 of surface clearance.
    arena.asteroidPlacements.push(rock("asteroid.colossal-a", 0, 0, 0, 1.5));
    expect(errors(validateGeometry(arena), "centrepiece-clearance")).toHaveLength(0);
  });

  it("fails when a spawn sits inside the centrepiece's clearance shell", () => {
    const arena = baseArena();
    arena.asteroidPlacements.push(rock("asteroid.colossal-a", 0, 0, 0, 1.5));
    // 30 units out from a 27-radius rock leaves 3 units of surface clearance.
    arena.spawnPoints.push({
      id: "b-close",
      team: 1,
      position: { x: 30, y: 0, z: 0 },
      heading: Math.PI
    });
    const report = validateGeometry(arena);
    const found = errors(report, "centrepiece-clearance");
    expect(found).toHaveLength(1);
    expect(report.ok).toBe(false);
    expect(found[0]?.spawnIds).toEqual(["b-close"]);
    expect(found[0]?.placementIndices).toEqual([4]);
    expect(found[0]?.message).toContain("surface distance 3 ");
    expect(found[0]?.message).toContain(">= 30 (colossal-class)");
  });

  /**
   * The gate is class-dependent — 25 for an ordinary rock, 30 only for
   * colossal-class. Charging 30 to everything would make the builder reject
   * maps the game's CI accepts, so the band between the two numbers must be a
   * warning for a non-colossal centrepiece and an error for a colossal one.
   */
  describe("the 25 / 30 class split", () => {
    /** large-hazard r = 8 at the origin: a centrepiece, but not colossal-class. */
    function withSmallCentrepiece(spawnX: number): EditorArena {
      const arena = baseArena();
      arena.asteroidPlacements.push(rock("asteroid.large-hazard", 0, 0, 0));
      arena.spawnPoints.push({
        id: "near",
        team: 1,
        position: { x: spawnX, y: 0, z: 0 },
        heading: Math.PI
      });
      return arena;
    }

    it("errors below 25 for a non-colossal centrepiece", () => {
      // 32 out from an r = 8 rock => 24 units of surface clearance.
      const report = validateGeometry(withSmallCentrepiece(32));
      const found = errors(report, "centrepiece-clearance");
      expect(found).toHaveLength(1);
      expect(found[0]?.message).toContain(">= 25");
      expect(found[0]?.message).not.toContain("colossal-class");
      expect(report.ok).toBe(false);
    });

    it("warns but does not fail between 25 and 30 for a non-colossal centrepiece", () => {
      // 34 out from an r = 8 rock => 26 units: legal per rule 3, under the guide.
      const report = validateGeometry(withSmallCentrepiece(34));
      expect(errors(report, "centrepiece-clearance")).toHaveLength(0);
      const found = ofRule(report, "centrepiece-clearance");
      expect(found).toHaveLength(1);
      expect(found[0]?.severity).toBe("warning");
      expect(found[0]?.spawnIds).toEqual(["near"]);
      expect(found[0]?.message).toContain("recommends 30");
      // Advisory only: the game's CI takes this map.
      expect(report.ok).toBe(true);
    });

    it("is silent at 30 and beyond", () => {
      const report = validateGeometry(withSmallCentrepiece(38));
      expect(ofRule(report, "centrepiece-clearance")).toHaveLength(0);
    });

    it("still errors in that same band when the centrepiece IS colossal", () => {
      const arena = baseArena();
      // colossal-a scale 1.5 => r = 27; spawn 53 out => 26 units of surface.
      arena.asteroidPlacements.push(rock("asteroid.colossal-a", 0, 0, 0, 1.5));
      arena.spawnPoints.push({
        id: "near",
        team: 1,
        position: { x: 53, y: 0, z: 0 },
        heading: Math.PI
      });
      const report = validateGeometry(arena);
      const found = errors(report, "centrepiece-clearance");
      expect(found).toHaveLength(1);
      expect(found[0]?.message).toContain(">= 30 (colossal-class)");
      expect(report.ok).toBe(false);
    });
  });
});

describe("rule 4 — separation", () => {
  it("passes at exactly the minimum gap", () => {
    const arena = baseArena();
    // Two large hazards (r = 8) 28 apart => surface gap 12.
    arena.asteroidPlacements = [
      rock("asteroid.large-hazard", 0, 40, 60),
      rock("asteroid.large-hazard", 0, 40, 88),
      rock("asteroid.large-hazard", 0, -40, 60)
    ];
    const report = validateGeometry(arena);
    expect(errors(report, "separation")).toHaveLength(0);
    expect(report.stats.minSurfaceGap).toBeCloseTo(12, 6);
  });

  it("fails when two colliders come within 12 units of each other", () => {
    const arena = baseArena();
    // 20 apart, radii 8 and 3.5 => surface gap 8.5.
    arena.asteroidPlacements.push(rock("asteroid.small-rock", 40, 40, 60));
    const report = validateGeometry(arena);
    const found = errors(report, "separation");
    expect(found).toHaveLength(1);
    expect(report.ok).toBe(false);
    expect(found[0]?.placementIndices).toEqual([0, 4]);
    expect(found[0]?.message).toContain("8.5");
    expect(found[0]?.message).toContain(">= 12");
    expect(report.stats.minSurfaceGap).toBeCloseTo(8.5, 6);
  });
});

describe("rule 5 — volumetric", () => {
  it("passes when rocks reach above, below and 35 off the equator", () => {
    expect(errors(validateGeometry(baseArena()), "volumetric")).toHaveLength(0);
  });

  it("fails a flat map", () => {
    const arena = baseArena();
    arena.asteroidPlacements = arena.asteroidPlacements.map((p: Placement) =>
      rock(p.asteroidId, p.position.x, 0, p.position.z)
    );
    const report = validateGeometry(arena);
    const found = errors(report, "volumetric");
    expect(found).toHaveLength(1);
    expect(report.ok).toBe(false);
    expect(found[0]?.message).toContain("min y is 0");
    expect(found[0]?.message).toContain("max y is 0");
    expect(found[0]?.message).toContain("largest |y| is 0");
  });

  it("fails a map that only uses one side of the equator", () => {
    const arena = baseArena();
    arena.asteroidPlacements = arena.asteroidPlacements.map((p: Placement) =>
      rock(p.asteroidId, p.position.x, Math.abs(p.position.y ?? 0), p.position.z)
    );
    const found = errors(validateGeometry(arena), "volumetric");
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("min y is 40");
  });

  it("fails a map whose vertical spread never reaches the 35 peak", () => {
    const arena = baseArena();
    arena.asteroidPlacements = arena.asteroidPlacements.map((p: Placement) =>
      rock(p.asteroidId, p.position.x, (p.position.y ?? 0) < 0 ? -30 : 30, p.position.z)
    );
    const found = errors(validateGeometry(arena), "volumetric");
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("largest |y| is 30");
  });

  it("swaps in the one-sided test for a floored arena, and still catches flatness", () => {
    const arena = baseArena();
    // A floor makes the "min y < -25" half unsatisfiable by construction.
    arena.bounds = { shape: "sphere", radius: 150, floorY: 0 } as EditorArena["bounds"];
    arena.asteroidPlacements = [
      rock("asteroid.large-hazard", 40, 4, 40),
      rock("asteroid.large-hazard-b", -40, 4, 40),
      rock("asteroid.large-hazard-b", 40, 50, -40),
      rock("asteroid.large-hazard", -40, 50, -40)
    ];
    const tall = validateGeometry(arena);
    expect(errors(tall, "volumetric")).toHaveLength(0);
    expect(ofRule(tall, "volumetric")[0]?.severity).toBe("info");
    expect(ofRule(tall, "volumetric")[0]?.message).toContain("floor");

    // Drop the tall pair and the floored map is flat again.
    arena.asteroidPlacements = arena.asteroidPlacements.map((p: Placement) =>
      rock(p.asteroidId, p.position.x, 4, p.position.z)
    );
    const flat = validateGeometry(arena);
    expect(errors(flat, "volumetric")).toHaveLength(1);
    expect(flat.ok).toBe(false);
  });
});

describe("rule 6 — spawns in bounds", () => {
  it("passes for spawns inside the bubble", () => {
    expect(errors(validateGeometry(baseArena()), "spawn-bounds")).toHaveLength(0);
  });

  it("fails for a spawn outside the bubble", () => {
    const arena = baseArena();
    arena.spawnPoints.push({
      id: "stray",
      team: 1,
      position: { x: 200, y: 0, z: 0 },
      heading: 0
    });
    const report = validateGeometry(arena);
    const found = errors(report, "spawn-bounds");
    expect(found).toHaveLength(1);
    expect(report.ok).toBe(false);
    expect(found[0]?.spawnIds).toEqual(["stray"]);
    expect(found[0]?.message).toContain("200");
    expect(found[0]?.message).toContain("150");
  });

  it("fails for a spawn outside rect bounds too", () => {
    const arena = baseArena();
    arena.bounds = { shape: "rect", width: 400, height: 400, verticalExtent: 40 };
    arena.spawnPoints.push({
      id: "high",
      team: 1,
      position: { x: 0, y: 60, z: 0 },
      heading: 0
    });
    expect(errors(validateGeometry(arena), "spawn-bounds")).toHaveLength(1);
  });
});

describe("rule 7 — wire limit", () => {
  it("passes a radius that leaves room for the projectile margin", () => {
    const arena = baseArena();
    arena.bounds = { shape: "sphere", radius: 307.67 };
    expect(errors(validateGeometry(arena), "wire-limit")).toHaveLength(0);
  });

  it("fails a radius that pushes the projectile margin past the int16 limit", () => {
    const arena = baseArena();
    arena.bounds = { shape: "sphere", radius: 320 };
    const report = validateGeometry(arena);
    const found = errors(report, "wire-limit");
    expect(found).toHaveLength(1);
    expect(report.ok).toBe(false);
    expect(found[0]?.message).toContain("340");
    expect(found[0]?.message).toContain("327.67");
  });

  it("measures rect bounds by their largest half-extent", () => {
    const arena = baseArena();
    arena.bounds = { shape: "rect", width: 400, height: 400, verticalExtent: 640 };
    expect(errors(validateGeometry(arena), "wire-limit")).toHaveLength(1);
  });
});

describe("unknown asteroid ids", () => {
  it("reports a distinct diagnostic instead of throwing or guessing", () => {
    const arena = baseArena();
    // Parked right on the corridor: with a known radius this would be a
    // corridor error, so a silent radius guess would show up here.
    arena.asteroidPlacements.push(rock("asteroid.mystery", 0, 5, 0));
    const run = (): GeometryReport => validateGeometry(arena);
    expect(run).not.toThrow();

    const report = run();
    const found = ofRule(report, "unknown-asteroid");
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("warning");
    expect(found[0]?.message).toContain("asteroid.mystery");
    expect(found[0]?.placementIndices).toEqual([4]);

    expect(report.ok).toBe(true);
    expect(errors(report)).toHaveLength(0);
    expect(report.stats.unknownAsteroidCount).toBe(1);
    // The unsized rock is excluded from radius-based rules but still counted.
    expect(report.stats.rockCount).toBe(5);
  });

  it("groups every placement sharing an unknown id into one diagnostic", () => {
    const arena = baseArena();
    arena.asteroidPlacements.push(rock("asteroid.mystery", 0, 60, 60));
    arena.asteroidPlacements.push(rock("asteroid.mystery", 0, -60, 60));
    const found = ofRule(validateGeometry(arena), "unknown-asteroid");
    expect(found).toHaveLength(1);
    expect(found[0]?.placementIndices).toEqual([4, 5]);
  });

  it("still checks the rules that do not need a radius", () => {
    const arena = baseArena();
    arena.asteroidPlacements = [rock("asteroid.mystery", 0, 0, 0)];
    const report = validateGeometry(arena);
    // Volumetric works off positions alone, so it still fires.
    expect(errors(report, "volumetric")).toHaveLength(1);
  });
});

describe("mirror symmetry (advisory)", () => {
  it("is silent when every rock has a twin, including rocks on the x = 0 plane", () => {
    const arena = baseArena();
    arena.asteroidPlacements.push(rock("asteroid.small-rock", 0, 55, 0));
    expect(ofRule(validateGeometry(arena), "mirror-symmetry")).toHaveLength(0);
  });

  it("warns per rock when a mostly symmetric map has a stray", () => {
    const arena = baseArena();
    arena.asteroidPlacements.push(rock("asteroid.small-rock", 55, 0, 55));
    const report = validateGeometry(arena);
    const found = ofRule(report, "mirror-symmetry");
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("warning");
    expect(found[0]?.placementIndices).toEqual([4]);
    expect(found[0]?.message).toContain("(-55, 0, 55)");
    // Advisory only — the map still ships.
    expect(report.ok).toBe(true);
  });

  it("treats a same-position twin of a different size as no twin", () => {
    const arena = baseArena();
    arena.asteroidPlacements = [
      rock("asteroid.large-hazard", 40, 40, 40),
      rock("asteroid.small-rock", -40, 40, 40),
      rock("asteroid.large-hazard", 40, -40, -40),
      rock("asteroid.large-hazard", -40, -40, -40)
    ];
    const found = ofRule(validateGeometry(arena), "mirror-symmetry");
    expect(found).toHaveLength(2);
    expect(found.flatMap((d) => d.placementIndices ?? [])).toEqual([0, 1]);
  });

  it("emits one summary instead of a warning per rock when most rocks lack twins", () => {
    const arena = baseArena();
    arena.asteroidPlacements = [
      rock("asteroid.large-hazard", 40, 40, 40),
      rock("asteroid.large-hazard", 60, -40, -20),
      rock("asteroid.large-hazard", 80, 36, -50)
    ];
    const report = validateGeometry(arena);
    const found = ofRule(report, "mirror-symmetry");
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("not mirror-symmetric");
    expect(found[0]?.placementIndices).toEqual([0, 1, 2]);
    expect(report.ok).toBe(true);
  });
});

describe("report shape", () => {
  it("orders diagnostics errors first, then warnings, then info", () => {
    const arena = baseArena();
    arena.bounds = { shape: "rect", width: 400, height: 400, verticalExtent: 200 };
    arena.asteroidPlacements.push(rock("asteroid.mystery", 90, 0, 0));
    arena.asteroidPlacements.push(rock("asteroid.large-hazard", 0, 10, 0));
    const report = validateGeometry(arena);
    const severities = report.diagnostics.map((d) => d.severity);
    expect(severities).toContain("error");
    expect(severities).toContain("warning");
    expect(severities).toContain("info");
    const rank = { error: 0, warning: 1, info: 2 } as const;
    const ranks = severities.map((s) => rank[s]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(report.ok).toBe(false);
  });

  it("skips every rock rule, loudly, for a map with no placements", () => {
    const arena = baseArena();
    arena.asteroidPlacements = [];
    const report = validateGeometry(arena);
    expect(report.ok).toBe(true);
    expect(ofRule(report, "placements")[0]?.severity).toBe("info");
    expect(report.stats.rockCount).toBe(0);
    expect(report.stats.minSurfaceGap).toBeNull();
    expect(report.stats.maxExtent).toBeNull();
    expect(report.stats.yMin).toBeNull();
  });

  it("defaults an omitted y to 0, matching the schema", () => {
    const arena = baseArena();
    arena.asteroidPlacements = [{ asteroidId: "asteroid.small-rock", position: { x: 0, z: 0 } }];
    const report = validateGeometry(arena);
    expect(report.stats.yMin).toBe(0);
    expect(report.stats.yMax).toBe(0);
  });

  it("exposes the shipped collider palette", () => {
    expect(ASTEROID_COLLIDER_RADII["asteroid.colossal-a"]).toBe(18);
    expect(ASTEROID_COLLIDER_RADII["asteroid.large-hazard-b"]).toBe(8);
    expect(ASTEROID_COLLIDER_RADII["asteroid.small-rock"]).toBe(3.5);
  });
});

/**
 * The examples/ directory holds maps that are green in the game's own CI, so
 * any error reported against them is a bug here, not in the map.
 */
describe("shipped example arenas", () => {
  const EXAMPLES = [
    "broken-halo",
    "core-orbit",
    "lunar-crater",
    "lunar-crater-3d",
    "twin-titans"
  ];

  for (const name of EXAMPLES) {
    it(`${name} reports ok with zero errors`, async () => {
      const arena = await readExample(name);
      const report = validateGeometry(arena);
      expect(errors(report)).toEqual([]);
      expect(report.ok).toBe(true);
    });
  }

  it("finds a centrepiece and full mirror symmetry in core-orbit", async () => {
    const report = validateGeometry(await readExample("core-orbit"));
    expect(report.stats.centrepieceCount).toBe(1);
    expect(report.stats.rockCount).toBe(27);
    expect(ofRule(report, "mirror-symmetry")).toEqual([]);
  });

  it("recognises lunar-crater as a floored arena", async () => {
    const report = validateGeometry(await readExample("lunar-crater"));
    const volumetric = ofRule(report, "volumetric");
    expect(volumetric).toHaveLength(1);
    expect(volumetric[0]?.severity).toBe("info");
    expect(report.stats.yMin).toBe(3);
    expect(report.stats.yMax).toBe(55);
  });

  /**
   * `readExample` above JSON.parses the file straight into the model. The app
   * does NOT: every arena reaching the editor from disk goes through
   * `arenaSchema.parse` (src/state/importArena.ts), and `sphereBoundsSchema` is
   * a plain z.object, so it silently strips `bounds.floorY` — importArena.ts
   * even warns the author that it did. These tests run the examples through
   * that real path so the two cannot drift apart unnoticed.
   */
  describe("through the schema the app actually imports with", () => {
    for (const name of ["broken-halo", "core-orbit", "lunar-crater-3d", "twin-titans"]) {
      it(`${name} still reports ok after arenaSchema.parse`, async () => {
        const parsed = arenaSchema.parse(await readExample(name)) as EditorArena;
        expect(errors(validateGeometry(parsed))).toEqual([]);
      });
    }

    /**
     * OPEN ISSUE for the integrator, pinned rather than papered over.
     *
     * lunar-crater.json is the one example whose y values are entirely above
     * the equator (3 … 55), so it fails rule 5's `min(y) < -25` half as that
     * rule is literally written. `checkVolumetric` excuses it via `bounds.floorY`
     * — but that key does not survive `arenaSchema.parse`, so the excuse only
     * applies to raw JSON and the verdict flips depending on how the arena
     * reached the validator. Two coherent resolutions, both of which turn this
     * test red so whoever picks one has to come back here:
     *   a) model `floorY` in sphereBoundsSchema, making the excuse reachable in
     *      the app (then both halves below become `true`), or
     *   b) drop the floored branch and let rule 5 fail the map honestly (then
     *      both become `false`).
     */
    it("lunar-crater's verdict currently depends on whether floorY survived", async () => {
      const raw = await readExample("lunar-crater");
      expect(validateGeometry(raw).ok).toBe(true);

      const parsed = arenaSchema.parse(raw) as EditorArena;
      expect((parsed.bounds as { floorY?: number }).floorY).toBeUndefined();
      const report = validateGeometry(parsed);
      expect(report.ok).toBe(false);
      expect(errors(report, "volumetric")[0]?.message).toContain("min y is 3");
    });
  });
});
