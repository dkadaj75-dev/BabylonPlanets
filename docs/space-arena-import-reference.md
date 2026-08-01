Maps and skyboxes in Space Arena

A reference for building arenas (maps) and skyboxes outside this repo — e.g. in a
standalone Babylon.js map/planet/skybox builder — and importing the result.

Everything a map is, is data. There is no per-map code: the client reads an arena.*
JSON config plus its texture assets and builds the scene from them. So an external tool
only has to emit (a) one JSON file that validates against the schema below and (b) the
image assets it references.

• Schema (source of truth):shared/src/schemas/arena.ts
• Renderer:client/src/core/SceneBuilder.ts
• Shipped examples:content/arenas/ring-nebula.json, content/arenas/deep-field.json

───

1. Coordinate system and units


Property
Value

Handedness
Babylon default — left-handed, Y up

Axes
x right, y up, z forward

Unit
1 unit ≈ 1 "space metre" in sim terms. The HUD multiplies displayed distances by theme.hud.metersPerUnit (currently 2) for readability — that is display-only and never affects geometry

Angles
radians everywhere (heading, pitch, rotation)

Heading
rotation about +Y; heading: 0 faces +X, increasing toward +Z

Pitch
nose elevation; positive = climbing. Constrained to (-π/2, +π/2) on spawn points



Ships fly in a full 3D volume ("the bubble"), not on a plane. y is a real axis: a rock 20
units above the sight line does not block a shot, and an enemy overhead is genuinely
distant rather than co-located.

The hard size limit ⚠️

Positions are replicated as signed int16 in centi-units, so no coordinate may exceed
±327.67. The schema enforces it, and pack validation additionally enforces
extent + tuning.projectileBoundsMargin ≤ 327.67 (default margin 20), because ordnance
flies past the rim before being culled.

Practical ceiling for a generated map: a sphere of radius ~300, or a box whose half-extents
are ~300. A builder should treat this as a hard constraint and refuse to export past it —
otherwise positions silently clamp and remote clients see ships pinned to an invisible wall.

───

2. The arena config

jsonc
{
  "id": "arena.my-map",          // must start with "arena."
  "type": "arena",               // discriminator, always "arena"
  "version": 1,
  "name": "My Map",              // display name

  "bounds": { "shape": "sphere", "radius": 126 },

  "asteroidPlacements": [ /* see §3 */ ],
  "spawnPoints":        [ /* see §4 */ ],

  "lighting": { /* optional, see §5 */ },
  "render":   { /* optional but strongly recommended, see §6 */ },
  "zones":    [ /* optional, reserved */ ]
}


Every config in this project shares the id / type / version / name envelope
(shared/src/schemas/base.ts). The id prefix must match the type.

Bounds

Two shapes:

jsonc
{ "shape": "sphere", "radius": 126 }

{ "shape": "rect", "width": 400, "height": 400, "verticalExtent": 160 }


• sphere is the normal case — a bubble. Boundary checks use true 3D radial distance.
• rect is a bounded box: width = x extent, height = z extent, verticalExtent = y
extent. Note height is depth, not vertical — a legacy name.

What happens at the boundary is not a map property: it belongs to the gamemode
(gamemode.boundaryRule — bounce / damage / damageAndBounce / warning). The map only
declares the shape and how the boundary looks (§6).

───

3. Asteroids (the map's geometry)

jsonc
"asteroidPlacements": [
  { "asteroidId": "asteroid.colossal-a", "position": { "x": 0, "y": 0, "z": 0 },
    "rotation": 0.7, "scale": 1.8 },
  { "asteroidId": "asteroid.large-hazard", "position": { "x": -40, "y": 12, "z": 25 } }
]



Field
Meaning

asteroidId
references an existing asteroid.* config (see content/asteroids/)

position
{x, y, z}; y optional, defaults to 0

rotation
optional yaw in radians

scale
optional uniform scale; multiplies the asteroid's collider radius too



Asteroids are the only solid geometry. They:

• block line of sight (segment-vs-sphere in 3D),
• deal impact damage on collision,
• are the cover a dogfight uses.

Collision is a sphere, always — asteroid.collider.radius × placement.scale. A visually
irregular rock still collides as a ball, so a builder should keep meshes roughly convex or
accept that the visual and the collision differ.

A generated map should not place rocks on top of spawn points. The shipped-geometry test
(shared/src/schemas/shippedArenaGeometry.test.ts) requires ≥ 25 units of clearance between a
big centrepiece and any spawn pad, and generally checks that lanes between opposing spawns are
not fully walled off.

Adding new asteroid types

A new rock type is its own config (content/asteroids/*.json) — radius, hp, destructible,
impact damage, and a render recipe. A map builder that invents new rock shapes must emit those
configs too, and register them in content/manifest.json.

───

4. Spawn points

jsonc
"spawnPoints": [
  { "id": "sp-a1", "team": 0, "position": { "x": -57.8, "y": 10.5, "z": -57.8 }, "heading": 0.79 },
  { "id": "sp-b1", "team": 1, "position": { "x":  57.8, "y": -10.5, "z": 57.8 }, "heading": 3.93, "pitch": 0.1 }
]


• team is an integer; 0 is the player's side in practice modes, 1 the opposition.
• At least one spawn point is required, and every spawn must sit inside bounds (schema-enforced).
• Respawn picks a random pad belonging to the ship's team, so give each team at least 2–3 pads
or respawns become predictable. A 5v5 mode wants ~5 per side.
• heading should point roughly toward the middle of the map — players spawn facing it.

───

5. Lighting

jsonc
"lighting": {
  "ambientColor": "#1a2233",
  "ambientIntensity": 0.4,
  "directionalIntensity": 0.9
}


All optional. This is the generic rig. If the skybox declares a sun (§6) that sun replaces
the directional key light entirely — which is the better path, because then the lighting matches
the painted sky.

───

6. render — skybox and boundary shield

jsonc
"render": {
  "skybox": {
    "texture": "skyboxes/ring-nebula.webp",
    "intensity": 0.92,
    "tint": "#e4e7ff",
    "sun": { "dir": [-0.677, -0.208, -0.706], "color": "#dce4ff", "intensity": 1.0 }
  },
  "boundaryShield": {
    "baseOpacity": 0.05,
    "glowStartDistance": 40,
    "redTransitionDistance": 16,
    "warnDistance": 22,
    "blueColor": "#45c8ff",
    "redColor": "#ff405c",
    "hexDensity": 42,
    "warningNotification": "notification.boundary-warning"
  }
}


6.1 Skybox

The sky is a single equirectangular panorama mapped onto an inward-facing sphere
(sideOrientation: BACKSIDE) with diameter boundsRadius × 6, centred on the arena.


Field
Meaning

texture
path relative to content/, served from /content/…. e.g. skyboxes/ring-nebula.webp

intensity
emissive multiplier (the texture's level)

tint
RGB tint multiplied into the panorama

sun
optional; promotes the star painted in the panorama to the real key light



Format for a generated panorama:

• Equirectangular / lat-long, 2:1 aspect (e.g. 4096×2048). This is the standard panorama
layout — not a 6-face cubemap cross, and not a cube-strip.
• WebP is what ships (ring-nebula.webp, deep-field.webp); JPEG works too (Skybox01.jpg).
Prefer WebP for size. Keep it under a few MB — it is downloaded before the match starts and
counts against the client bundle budget checked in CI.
• Seamless horizontally; the poles will be pinched (inherent to equirectangular) so avoid putting
critical detail directly overhead or underfoot.

The sun block is the important one for realism.dir is a unit vector pointing FROM the
arena TOWARD the star — the same direction an author reads off the panorama. The renderer builds
a parallel-ray DirectionalLight travelling along -dir, so every lit surface faces back at the
painted star. The schema validates |dir| ≈ 1 (tolerance 0.02) precisely because a typo here is
otherwise very hard to spot.

For an external builder: if your tool places a star/planet in the generated panorama, it
already knows that direction — emit it as sun.dir and sample the star's colour into
sun.color. That single step is the difference between "a nice backdrop" and "the scene is lit
by the thing in the sky".

Notes on the shader, if you are matching the look in your own viewer: the material is a
StandardMaterial with diffuseColor/specularColor/emissiveColor all black, the panorama
on the emissive channel, intensity riding the texture's level, and the tint applied via an
emissive Fresnel with equal left/right colours. emissiveColor must stay black — the standard
shader adds emissive colour to the emissive texture rather than multiplying, so any non-black
value paints a flat wash over the whole sky.

Skybox rendering can be disabled by the quality tier (quality.scene.skyboxEnabled), so the map
must still be legible without it.

6.2 Boundary shield

The visible "wall" at the arena edge: an inward-facing shell that stays nearly invisible until you
approach, then brightens and shifts blue → red.


Field
Meaning

baseOpacity
opacity when far away (keep low — 0.05)

glowStartDistance
distance inside the rim where it starts brightening

redTransitionDistance
distance inside the rim where blue starts blending to red

warnDistance
distance inside the rim that triggers the HUD warning

blueColor / redColor
the two shell colours

hexDensity
number of procedural hex cells around the shell

warningNotification
id of an existing notification.* config



Scale these with the map: on a radius-126 arena the shipped values are 40 / 16 / 22. On a much
bigger arena, raise glowStartDistance proportionally or players will hit the wall before it
becomes visible.

───

7. Assets: models and textures

Where files live

content/
  manifest.json          ← every config file must be listed here
  arenas/*.json
  asteroids/*.json
  skyboxes/*.webp|*.jpg  ← panoramas
  models/… , ships/…     ← GLB meshes


content/manifest.json has a flat files array of config paths. A config that is not in the
manifest does not exist as far as the loader is concerned — this is the single most common
integration mistake. Texture/model assets are not listed there; they are referenced by path
from the configs that use them.

GLB conventions

For any mesh (ships, asteroids, props):

• Export forward as −Y in Blender, which imports as +Z in engine space.
• Normalise the asset to one unit of forward extent, then use modelScale in the render recipe
for its real size. Keeps scale a data decision rather than a re-export.
• modelRotationY is a radians yaw correction if the export is off-axis.
• Fully metallic PBR materials are clamped by the engine so they stay lit without an environment map.

───

8. Validation and importing

Run the content gate — it validates every config against its schema and cross-checks
references (a placement pointing at a non-existent asteroid.*, a warningNotification naming a
missing notification, etc.):

bash
npm run validate:content


It prints a per-type count on success. Additional map-specific checks live in
shared/src/schemas/shippedArenaGeometry.test.ts (spawn clearance, extents, corridors).

Import checklist for a generated map:

1. Drop the panorama into content/skyboxes/.
2. Drop any new mesh into the appropriate content/ subfolder.
3. Write content/arenas/&lt;name&gt;.json.
4. Write any new content/asteroids/&lt;name&gt;.json types it needs.
5. Add every new config path to content/manifest.json.
6. Point a gamemode at it via gamemode.defaultArena, or pass the arena id when starting a match.
7. npm run validate:content, then npx vitest run.

───

9. What a map does not control

Worth knowing so a builder does not try to emit it:


Concern
Lives in

Boundary behaviour (bounce/damage)
gamemode.boundaryRule

Team sizes, win conditions, respawn
gamemode.*

Bot rosters
gamemode.bots

HUD colours, menu look, metersPerUnit
theme.*

Ship/module stats
ship.*, module.*

Global damage/lock multipliers, tick rate
tuning.*

Quality tiers (incl. whether the skybox renders)
quality.*



A map is: bounds + rocks + spawns + sky + boundary look. Nothing else.

───

10. Minimal working example

jsonc
{
  "id": "arena.generated-01",
  "type": "arena",
  "version": 1,
  "name": "Generated 01",
  "bounds": { "shape": "sphere", "radius": 150 },
  "asteroidPlacements": [
    { "asteroidId": "asteroid.colossal-a", "position": { "x": 0, "y": 0, "z": 0 }, "scale": 1.5 },
    { "asteroidId": "asteroid.large-hazard", "position": { "x": 60, "y": 14, "z": -30 } }
  ],
  "spawnPoints": [
    { "id": "a1", "team": 0, "position": { "x": -95, "y": 8,   "z": -95 }, "heading": 0.79 },
    { "id": "a2", "team": 0, "position": { "x": -105, "y": -8, "z": -80 }, "heading": 0.79 },
    { "id": "b1", "team": 1, "position": { "x":  95, "y": -8,  "z":  95 }, "heading": 3.93 },
    { "id": "b2", "team": 1, "position": { "x": 105, "y":  8,  "z":  80 }, "heading": 3.93 }
  ],
  "lighting": { "ambientColor": "#141d2e", "ambientIntensity": 0.4, "directionalIntensity": 0.9 },
  "render": {
    "skybox": {
      "texture": "skyboxes/generated-01.webp",
      "intensity": 0.9,
      "tint": "#e8ecff",
      "sun": { "dir": [0.5, 0.3, -0.812], "color": "#ffe9d0", "intensity": 1.0 }
    },
    "boundaryShield": {
      "baseOpacity": 0.05,
      "glowStartDistance": 48,
      "redTransitionDistance": 20,
      "warnDistance": 26,
      "blueColor": "#45c8ff",
      "redColor": "#ff405c",
      "hexDensity": 48,
      "warningNotification": "notification.boundary-warning"
    }
  }
}


Add "arenas/generated-01.json" to content/manifest.json, run npm run validate:content, done.