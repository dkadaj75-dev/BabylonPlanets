import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4, Vector3 } from "@babylonjs/core/Maths/math";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";

/**
 * The editor viewport: an arc-rotate camera orbiting the arena origin, with a
 * wireframe sphere visualizing the arena bounds ("the bubble").
 */
export class EditorScene {
  readonly engine: Engine;
  readonly scene: Scene;
  private boundsMesh: Mesh;

  constructor(canvas: HTMLCanvasElement, boundsRadius = 150) {
    this.engine = new Engine(canvas, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.016, 0.02, 0.05, 1);

    const camera = new ArcRotateCamera(
      "editor-camera",
      -Math.PI / 3,
      Math.PI / 2.6,
      boundsRadius * 2.4,
      Vector3.Zero(),
      this.scene
    );
    camera.lowerRadiusLimit = 5;
    camera.upperRadiusLimit = boundsRadius * 6;
    camera.wheelDeltaPercentage = 0.02;
    camera.attachControl(canvas, true);

    const light = new HemisphericLight("editor-light", new Vector3(0.3, 1, 0.2), this.scene);
    light.intensity = 0.9;

    this.boundsMesh = this.createBoundsMesh(boundsRadius);

    this.engine.runRenderLoop(() => this.scene.render());
    window.addEventListener("resize", () => this.engine.resize());
  }

  setBoundsRadius(radius: number): void {
    this.boundsMesh.dispose();
    this.boundsMesh = this.createBoundsMesh(radius);
  }

  private createBoundsMesh(radius: number): Mesh {
    const mesh = MeshBuilder.CreateSphere(
      "arena-bounds",
      { diameter: radius * 2, segments: 24 },
      this.scene
    );
    const mat = new StandardMaterial("arena-bounds-mat", this.scene);
    mat.wireframe = true;
    mat.emissiveColor = Color3.FromHexString("#2b6fb0");
    mat.disableLighting = true;
    mat.alpha = 0.35;
    mesh.material = mat;
    mesh.isPickable = false;
    return mesh;
  }

  dispose(): void {
    this.engine.dispose();
  }
}
