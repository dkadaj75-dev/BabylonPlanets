import { z } from "zod";

/**
 * Zod schemas mirroring Space Arena's arena config schema
 * (see docs/space-arena-import-reference.md).
 *
 * Coordinate system: Babylon default — left-handed, Y up, radians everywhere.
 *
 * Positions are replicated by the game as signed int16 in centi-units, so no
 * coordinate component may exceed ±327.67. Pack validation in the game
 * additionally requires extent + projectileBoundsMargin ≤ 327.67 (margin
 * defaults to 20) because ordnance flies past the rim before being culled.
 * The builder enforces the stricter bound up front so exports fail here, not
 * at game import.
 */

export const COORD_LIMIT = 327.67;
export const PROJECTILE_BOUNDS_MARGIN = 20;
export const MAX_ARENA_EXTENT = COORD_LIMIT - PROJECTILE_BOUNDS_MARGIN;
export const SUN_DIR_TOLERANCE = 0.02;

const coord = z
  .number()
  .min(-COORD_LIMIT, `coordinate below -${COORD_LIMIT}`)
  .max(COORD_LIMIT, `coordinate above ${COORD_LIMIT}`);

export const vec3Schema = z.object({
  x: coord,
  y: coord.default(0),
  z: coord
});

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected #rrggbb hex color");

export const sphereBoundsSchema = z.object({
  shape: z.literal("sphere"),
  radius: z
    .number()
    .positive()
    .max(
      MAX_ARENA_EXTENT,
      `radius + projectile bounds margin (${PROJECTILE_BOUNDS_MARGIN}) must stay within ±${COORD_LIMIT}`
    )
});

const rectExtent = z
  .number()
  .positive()
  .max(
    MAX_ARENA_EXTENT * 2,
    `half-extent + projectile bounds margin (${PROJECTILE_BOUNDS_MARGIN}) must stay within ±${COORD_LIMIT}`
  );

export const rectBoundsSchema = z.object({
  shape: z.literal("rect"),
  /** x extent */
  width: rectExtent,
  /** z extent — depth, not vertical (legacy name) */
  height: rectExtent,
  /** y extent */
  verticalExtent: rectExtent
});

export const boundsSchema = z.discriminatedUnion("shape", [
  sphereBoundsSchema,
  rectBoundsSchema
]);

export const asteroidPlacementSchema = z.object({
  asteroidId: z.string().startsWith("asteroid."),
  position: vec3Schema,
  /** optional yaw in radians */
  rotation: z.number().optional(),
  /** optional uniform scale; multiplies the asteroid's collider radius too */
  scale: z.number().positive().optional()
});

export const spawnPointSchema = z.object({
  id: z.string().min(1),
  team: z.number().int().min(0),
  position: vec3Schema,
  /** rotation about +Y; 0 faces +X, increasing toward +Z. Radians. */
  heading: z.number(),
  /** nose elevation, positive = climbing. Constrained to (-π/2, +π/2). */
  pitch: z
    .number()
    .gt(-Math.PI / 2)
    .lt(Math.PI / 2)
    .optional()
});

export const lightingSchema = z.object({
  ambientColor: hexColor.optional(),
  ambientIntensity: z.number().min(0).optional(),
  directionalIntensity: z.number().min(0).optional()
});

export const sunSchema = z.object({
  /**
   * Unit vector pointing FROM the arena TOWARD the star painted in the
   * panorama. The game builds a DirectionalLight travelling along -dir.
   */
  dir: z
    .tuple([z.number(), z.number(), z.number()])
    .refine(
      ([x, y, z_]) => Math.abs(Math.hypot(x, y, z_) - 1) <= SUN_DIR_TOLERANCE,
      { message: `sun.dir must be a unit vector (|dir| = 1 ± ${SUN_DIR_TOLERANCE})` }
    ),
  color: hexColor,
  intensity: z.number().min(0)
});

export const skyboxSchema = z.object({
  /** path relative to the game's content/ dir, e.g. "skyboxes/my-map.webp" */
  texture: z.string().min(1),
  /** emissive multiplier (the texture's level) */
  intensity: z.number().min(0).optional(),
  /** RGB tint multiplied into the panorama */
  tint: hexColor.optional(),
  sun: sunSchema.optional()
});

export const boundaryShieldSchema = z.object({
  baseOpacity: z.number().min(0).max(1).optional(),
  glowStartDistance: z.number().positive().optional(),
  redTransitionDistance: z.number().positive().optional(),
  warnDistance: z.number().positive().optional(),
  blueColor: hexColor.optional(),
  redColor: hexColor.optional(),
  hexDensity: z.number().int().positive().optional(),
  warningNotification: z.string().startsWith("notification.").optional()
});

export const renderSchema = z.object({
  skybox: skyboxSchema.optional(),
  boundaryShield: boundaryShieldSchema.optional()
});

type Vec3 = z.infer<typeof vec3Schema>;
type Bounds = z.infer<typeof boundsSchema>;

export function isInsideBounds(p: Vec3, bounds: Bounds): boolean {
  if (bounds.shape === "sphere") {
    return Math.hypot(p.x, p.y, p.z) <= bounds.radius;
  }
  return (
    Math.abs(p.x) <= bounds.width / 2 &&
    Math.abs(p.z) <= bounds.height / 2 &&
    Math.abs(p.y) <= bounds.verticalExtent / 2
  );
}

export const arenaSchema = z
  .object({
    id: z.string().startsWith("arena."),
    type: z.literal("arena"),
    version: z.number().int().positive(),
    name: z.string().min(1),
    bounds: boundsSchema,
    asteroidPlacements: z.array(asteroidPlacementSchema).default([]),
    spawnPoints: z.array(spawnPointSchema).min(1),
    lighting: lightingSchema.optional(),
    render: renderSchema.optional(),
    zones: z.array(z.unknown()).optional()
  })
  .superRefine((arena, ctx) => {
    arena.spawnPoints.forEach((sp, i) => {
      if (!isInsideBounds(sp.position, arena.bounds)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["spawnPoints", i, "position"],
          message: `spawn point "${sp.id}" lies outside the arena bounds`
        });
      }
    });
  });

export type ArenaConfig = z.infer<typeof arenaSchema>;
export type ArenaConfigInput = z.input<typeof arenaSchema>;
export type AsteroidPlacement = z.infer<typeof asteroidPlacementSchema>;
export type SpawnPoint = z.infer<typeof spawnPointSchema>;
