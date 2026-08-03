/**
 * Procedural equirectangular skybox generation.
 *
 * Output is a 2:1 lat-long panorama (the game maps it onto an inward-facing
 * sphere). Conventions follow Babylon's left-handed Y-up space
 * (docs/space-arena-import-reference.md §1, §6.1):
 *
 *   u = 0.5 + atan2(z, x) / 2π      (azimuth around +Y)
 *   v = 0.5 - asin(y) / π           (v = 0 straight up, v = 1 straight down)
 *
 * The same direction placed in the panorama is returned as `sunDir` so the
 * arena export can emit it verbatim as render.skybox.sun.dir — the unit
 * vector pointing FROM the arena TOWARD the painted star.
 */

export type Vec3Tuple = [number, number, number];

export interface SkyboxOptions {
  /** panorama width in px; height is always width / 2 */
  width?: number;
  /** direction from the arena toward the sun; normalized internally */
  sunDir?: Vec3Tuple;
  /** #rrggbb color of the sun disc */
  sunColor?: string;
  /** angular radius of the sun's core disc, radians */
  sunAngularRadius?: number;
  starCount?: number;
  /** deterministic output for a given seed */
  seed?: number;
}

export interface GeneratedSkybox {
  blob: Blob;
  width: number;
  height: number;
  /** normalized sun direction — emit as render.skybox.sun.dir */
  sunDir: Vec3Tuple;
}

export function normalize(v: Vec3Tuple): Vec3Tuple {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len === 0) throw new Error("cannot normalize a zero vector");
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** Map a unit direction to equirectangular UV in [0,1). */
export function dirToEquirect(dir: Vec3Tuple): { u: number; v: number } {
  const [x, y, z] = normalize(dir);
  const u = 0.5 + Math.atan2(z, x) / (2 * Math.PI);
  const v = 0.5 - Math.asin(Math.min(1, Math.max(-1, y))) / Math.PI;
  return { u: (u + 1) % 1, v };
}

/** Inverse of dirToEquirect. */
export function equirectToDir(u: number, v: number): Vec3Tuple {
  const phi = (u - 0.5) * 2 * Math.PI;
  const theta = (0.5 - v) * Math.PI;
  const cos = Math.cos(theta);
  return [cos * Math.cos(phi), Math.sin(theta), cos * Math.sin(phi)];
}

/** mulberry32 — small deterministic PRNG. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform random direction on the unit sphere (Marsaglia via gaussians). */
function randomDir(rng: () => number): Vec3Tuple {
  const gauss = () => {
    const r = Math.sqrt(-2 * Math.log(1 - rng() || Number.MIN_VALUE));
    return r * Math.cos(2 * Math.PI * rng());
  };
  return normalize([gauss(), gauss(), gauss()]);
}

function createCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

/**
 * Encode preferring webp; Safari can't encode webp and silently falls back to
 * PNG (spec behavior), which is fine for previewing. The blob's `type` tells
 * callers what was actually produced.
 */
function canvasToWebp(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Blob> {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({ type: "image/webp", quality: 0.9 });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob returned null"))),
      "image/webp",
      0.9
    );
  });
}

export async function generateSkybox(options: SkyboxOptions = {}): Promise<GeneratedSkybox> {
  const width = options.width ?? 4096;
  const height = width / 2;
  const sunDir = normalize(options.sunDir ?? [0.5, 0.3, -0.812]);
  const sunColor = options.sunColor ?? "#ffe9d0";
  const sunAngularRadius = options.sunAngularRadius ?? 0.035;
  const starCount = options.starCount ?? 2200;
  const rng = makeRng(options.seed ?? 1);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("2d canvas context unavailable");

  // Deep-space background with a faint band of nebula color.
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "#04050c");
  bg.addColorStop(0.5, "#0a0f22");
  bg.addColorStop(1, "#04050c");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Stars: sample uniform directions on the sphere and project, so density
  // stays even despite equirectangular pole stretching.
  for (let i = 0; i < starCount; i++) {
    const { u, v } = dirToEquirect(randomDir(rng));
    const px = u * width;
    const py = v * height;
    const r = 0.4 + rng() * 1.4;
    const alpha = 0.35 + rng() * 0.65;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, 2 * Math.PI);
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
    ctx.fill();
  }

  // Sun: soft radial disc at the panorama position of sunDir. Drawn three
  // times (u - W, u, u + W) so it wraps cleanly across the seam.
  const { u, v } = dirToEquirect(sunDir);
  const sunPx = u * width;
  const sunPy = v * height;
  const coreRadius = (sunAngularRadius / (2 * Math.PI)) * width;
  const haloRadius = coreRadius * 6;
  for (const cx of [sunPx - width, sunPx, sunPx + width]) {
    const g = ctx.createRadialGradient(cx, sunPy, 0, cx, sunPy, haloRadius);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(coreRadius / haloRadius, sunColor);
    g.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - haloRadius, sunPy - haloRadius, haloRadius * 2, haloRadius * 2);
  }

  const blob = await canvasToWebp(canvas);
  return { blob, width, height, sunDir };
}
