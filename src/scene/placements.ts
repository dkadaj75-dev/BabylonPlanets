import type { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Quaternion, Vector3 } from "@babylonjs/core/Maths/math";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { EditorArena } from "../state/editorState";

/** Nominal visual radius for an asteroid at scale 1 (real radius comes from the asteroid config in-game). */
const ASTEROID_NOMINAL_RADIUS = 10;

const TEAM_COLORS = ["#45c8ff", "#ff405c", "#ffd24a", "#7dff8a"];

/**
 * Renders asteroid placements and spawn points from the editor model.
 * Rebuild-all on sync is fine at map scale (tens of placements).
 */
export class PlacementLayer {
  private meshes: Mesh[] = [];

  constructor(private readonly scene: Scene) {}

  sync(arena: EditorArena): void {
    for (const m of this.meshes) {
      m.material?.dispose();
      m.dispose();
    }
    this.meshes = [];

    arena.asteroidPlacements.forEach((p, i) => {
      const radius = ASTEROID_NOMINAL_RADIUS * (p.scale ?? 1);
      const mesh = MeshBuilder.CreateSphere(
        `asteroid-${i}`,
        { diameter: radius * 2, segments: 10 },
        this.scene
      );
      mesh.position.set(p.position.x, p.position.y ?? 0, p.position.z);
      mesh.rotation.y = p.rotation ?? 0;
      const mat = new StandardMaterial(`asteroid-${i}-mat`, this.scene);
      mat.diffuseColor = Color3.FromHexString("#8a8f99");
      mat.specularColor = Color3.Black();
      mesh.material = mat;
      this.meshes.push(mesh);
    });

    arena.spawnPoints.forEach((sp, i) => {
      const mesh = MeshBuilder.CreateCylinder(
        `spawn-${i}`,
        { diameterTop: 0, diameterBottom: 5, height: 10, tessellation: 12 },
        this.scene
      );
      mesh.position.set(sp.position.x, sp.position.y ?? 0, sp.position.z);
      // heading 0 faces +X, increasing toward +Z; pitch positive = climbing.
      const pitch = sp.pitch ?? 0;
      const forward = new Vector3(
        Math.cos(pitch) * Math.cos(sp.heading),
        Math.sin(pitch),
        Math.cos(pitch) * Math.sin(sp.heading)
      );
      const orientation = new Quaternion();
      Quaternion.FromUnitVectorsToRef(Vector3.Up(), forward, orientation);
      mesh.rotationQuaternion = orientation;
      const mat = new StandardMaterial(`spawn-${i}-mat`, this.scene);
      mat.emissiveColor = Color3.FromHexString(TEAM_COLORS[sp.team % TEAM_COLORS.length] ?? "#ffffff");
      mat.disableLighting = true;
      mesh.material = mat;
      this.meshes.push(mesh);
    });
  }
}
