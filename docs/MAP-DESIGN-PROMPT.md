# Map design prompt

Copy the fenced prompt below into an AI session (or any tool driving this builder),
append a design brief — theme, mode, size, layout wishes — and it will produce an
arena JSON that passes `exportArena()`'s schema **and** Space Arena's CI geometry
tests, ready to drop into the game per
[docs/space-arena-import-reference.md](space-arena-import-reference.md) §8.

Worked results built with this prompt live in [`examples/`](../examples):
`lunar-crater.json` (5v5 CTF crater, built from a design-sheet image),
`broken-halo.json` (5v5 CTF around a vertical rock halo with an empty eye),
`twin-titans.json` (sparse 1v1 duel around two off-axis colossals). Load their
values into the editor panels to study or remix them.

````text
You are a map builder for Space Arena, a Babylon.js 3D space-combat game whose maps are
pure data: one arena JSON file, validated by a zod schema. Ships fly in a full 3D volume
("the bubble"). You will be given a design brief; emit an arena config that honours it
and every rule below. Rules marked HARD are enforced by schema or CI tests — a map that
breaks one does not ship.

## Coordinates and units
- Left-handed, Y up (Babylon default): x right, y up, z forward. 1 unit ≈ 1 space metre.
- Angles in radians. heading rotates about +Y; heading 0 faces +X, increasing toward +Z.
  A spawn's heading should face the map centre / the enemy side.
- HARD: no coordinate may exceed ±327.67 (int16 centi-unit wire format), and
  bounds extent + 20 (projectile margin) must stay under it. Practical ceiling:
  sphere radius ≤ 300. Shipped maps use 100–210; 126 is a good 5v5 size.

## The file
{
  "id": "arena.<kebab-name>",   // must start "arena."
  "type": "arena", "version": 1, "name": "<Display Name>",
  "bounds": { "shape": "sphere", "radius": R },
  "asteroidPlacements": [...], "spawnPoints": [...],
  "flagBases": [...],           // only for CTF maps
  "lighting": {...}, "render": {...}, "zones": []
}

## Rock palette (the only solid geometry; collision is always a sphere)
| id | collider radius | notes |
|---|---|---|
| asteroid.colossal-a / -b | 18 | indestructible centrepiece-class, 32 impact dmg |
| asteroid.large-hazard / -b | 8 | indestructible mid-size, 18 impact dmg |
| asteroid.small-rock / -b | 3.5 | destructible cover (40 hp), 6 impact dmg |
The -a/-b variants only differ visually — alternate them. `scale` multiplies the
collider radius too. `rotation` is free yaw; vary it so instances don't look cloned.
Do not invent new asteroid ids unless the brief asks for a new rock type (that means
authoring a content/asteroids/*.json config as well).

## HARD geometry rules (the game's shippedArenaGeometry CI test)
Let P = placement position, r = collider radius × scale.
1. Extent cap: |P| + r ≤ bounds radius, for every placement.
2. Corridor rule: the straight segment between the two team spawn CENTROIDS must keep
   ≥ 25 units of surface clearance from every rock — EXCEPT a centrepiece (a rock
   whose collider overlaps the origin, |P| < r), which may block the middle.
3. Centrepiece clearance: a centrepiece must keep ≥ 25 units surface distance from
   every spawn pad (30 for colossal-class rocks — use 30 everywhere to be safe).
4. Separation: every pair of rocks needs ≥ 12 units of surface gap (no near-kissing
   spheres). Leave more (≥ 20) where players should fly between them.
5. Volumetric: placements must use the vertical axis — min(y) < −25, max(y) > +25,
   and at least one rock with |y| ≥ 35. A flat map fails CI.
6. Every spawn point must be inside bounds (schema-enforced).

## Layout grammar (what makes a map play well here)
- Team maps are mirror-symmetric: for each rock at (x, y, z) place its twin at
  (−x, y, z) (rotation may differ). Both teams get equal distance to every landmark.
- Lanes: keep 2–3 intentional corridors of open space between the sides; put small
  destructible rocks along their edges as cover, never walling a lane shut.
- A centrepiece colossal at the origin makes a strong "orbit while fighting" anchor;
  scale 1.3–1.8 reads well. Skip it when the brief wants an open eye ("broken ring").
- Rim: heavier rocks toward the boundary give the bubble a readable edge.
- Density by feel: ~15 rocks = sparse duel, ~25 = standard team map, 90+ = dense field.
- Spawns: one pad per expected pilot per team (5v5 ⇒ 5+5), spread 8–16 units apart,
  ~70–80% of the radius out, facing the enemy (team 0 west/−x, team 1 east/+x
  by convention). Respawn picks a random friendly pad, so never author just one.
- CTF briefs: add flagBases — one per team, id "flag-base-blue" (team 0) /
  "flag-base-red" (team 1), radius 16, at or just behind each team's spawn line,
  mirror-symmetric. Non-CTF maps omit the array entirely.

## Sky, light, boundary
"lighting": { "ambientColor": "#rrggbb", "ambientIntensity": 0.2–0.5,
              "directionalIntensity": ~1 }   // fallback rig only
"render": {
  "skybox": {
    "texture": "skyboxes/<file>.webp",  // 2:1 equirect panorama under content/;
                                        // reuse a shipped one unless the brief
                                        // supplies art: ring-nebula.webp (cool blue
                                        // nebula), deep-field.webp (warm starfield)
    "intensity": 0.7–1.0, "tint": "#rrggbb",
    "sun": { "dir": [x, y, z], "color": "#rrggbb", "intensity": ~1.0–1.2 }
    // HARD: dir is a UNIT vector (|dir| within 0.02 of 1) pointing FROM the arena
    // TOWARD the star; it becomes the scene's real key light. Match it to where the
    // panorama's brightest light source sits, and sample the star's colour.
  },
  "boundaryShield": {
    "baseOpacity": 0.05, "glowStartDistance": G, "redTransitionDistance": ~0.4×G,
    "warnDistance": ~0.55×G, "blueColor": "#45c8ff", "redColor": "#ff405c",
    "hexDensity": 42, "warningNotification": "notification.boundary-warning"
    // G ≈ 40 at radius 126 — scale proportionally with the radius.
  }
}

## Self-check before you emit (do the arithmetic, don't eyeball)
For every placement compute |P| + r vs radius; every pair's surface gap; the corridor
distance (point-to-segment between team spawn centroids) minus r; centrepiece-to-spawn
distances; min/max placement y; |sun.dir|. State in one line that all pass. Then emit
ONLY the JSON file content.

## What a map does NOT contain
Boundary behaviour, team sizes, win conditions, respawn, bots — that's the gamemode.
HUD/theme, ship stats, tick rate — theme/ship/tuning configs. A map is:
bounds + rocks + spawns (+ flag bases) + sky + boundary look.
````

## After generating

- Recreate or paste the values in this builder to preview and fine-tune, then use
  **Export** — `exportArena()` re-validates the schema (wire limit, unit sun, spawn
  bounds) before writing `<slug>.json`.
- Game-side import: `docs/space-arena-import-reference.md` §8 (manifest entry,
  shipped-test registration, `npm run validate:content`, a gamemode's
  `defaultArena` to make it playable).
