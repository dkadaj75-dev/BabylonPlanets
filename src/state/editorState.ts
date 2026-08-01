import type { ArenaConfigInput } from "../schema/arena";

type Placements = NonNullable<ArenaConfigInput["asteroidPlacements"]>;

/** The editable model — structurally identical to the export payload. */
export interface EditorArena extends Omit<ArenaConfigInput, "asteroidPlacements"> {
  asteroidPlacements: Placements;
}

export function defaultArena(): EditorArena {
  return {
    id: "arena.new-map",
    type: "arena",
    version: 1,
    name: "New Map",
    bounds: { shape: "sphere", radius: 150 },
    asteroidPlacements: [
      { asteroidId: "asteroid.colossal-a", position: { x: 0, y: 0, z: 0 }, scale: 1.5 }
    ],
    spawnPoints: [
      { id: "a1", team: 0, position: { x: -95, y: 8, z: -95 }, heading: 0.79 },
      { id: "a2", team: 0, position: { x: -105, y: -8, z: -80 }, heading: 0.79 },
      { id: "b1", team: 1, position: { x: 95, y: -8, z: 95 }, heading: 3.93 },
      { id: "b2", team: 1, position: { x: 105, y: 8, z: 80 }, heading: 3.93 }
    ],
    lighting: { ambientColor: "#141d2e", ambientIntensity: 0.4, directionalIntensity: 0.9 }
  };
}

/**
 * Single in-memory arena model plus a tiny pub/sub. Panels and the scene both
 * subscribe; mutate `arena` then call `notify()`.
 */
export class EditorState {
  arena: EditorArena = defaultArena();
  private listeners = new Set<() => void>();

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(): void {
    for (const fn of this.listeners) fn();
  }
}

export function arenaSlug(id: string): string {
  return id.startsWith("arena.") ? id.slice("arena.".length) : id;
}
