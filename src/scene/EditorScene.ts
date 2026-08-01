import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3, Color4, Vector3 } from "@babylonjs/core/Maths/math";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { BoundsInput } from "../schema/arena";
import type { Vec3Tuple } from "../skybox/generateSkybox";

/**
 * The editor viewport: an arc-rotate camera orbiting the arena origin, a
 * wireframe visualization of the arena bounds, and an optional skybox preview
 * built with the game's exact material recipe.
 */
export class EditorScene {
  readonly engine: Engine;
  readonly scene: Scene;
  private boundsMesh: Mesh | null = null;
  private skyboxMesh: Mesh | null = null;
  private sunLight: DirectionalLight | null = null;

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

    this.setBounds({ shape: "sphere", radius: boundsRadius });

    this.engine.runRenderLoop(() => this.scene.render());
    window.addEventListener("resize", () => this.engine.resize());
  }

  setBounds(bounds: BoundsInput): void {
    this.boundsMesh?.material?.dispose();
    this.boundsMesh?.dispose();
    this.boundsMesh =
      bounds.shape === "sphere"
        ? MeshBuilder.CreateSphere(
            "arena-bounds",
            { diameter: bounds.radius * 2, segments: 24 },
            this.scene
          )
        : MeshBuilder.CreateBox(
            "arena-bounds",
            // width = x, height (schema) = z depth, verticalExtent = y
            { width: bounds.width, depth: bounds.height, height: bounds.verticalExtent },
            this.scene
          );
    const mat = new StandardMaterial("arena-bounds-mat", this.scene);
    mat.wireframe = true;
    mat.emissiveColor = Color3.FromHexString("#2b6fb0");
    mat.disableLighting = true;
    mat.alpha = 0.35;
    this.boundsMesh.material = mat;
    this.boundsMesh.isPickable = false;
  }

  /**
   * Preview a generated panorama with the game's skybox recipe
   * (docs/space-arena-import-reference.md §6.1): inward-facing sphere of
   * diameter boundsRadius × 6, panorama on the emissive channel, and
   * diffuse/specular/emissive *colors* all black — the standard shader adds
   * emissiveColor to the emissive texture, so non-black would wash the sky.
   */
  applySkyboxPreview(textureUrl: string, boundsRadius: number, intensity = 0.9): void {
    this.clearSkyboxPreview();
    const mesh = MeshBuilder.CreateSphere(
      "skybox-preview",
      { diameter: boundsRadius * 6, segments: 32, sideOrientation: Mesh.BACKSIDE },
      this.scene
    );
    const mat = new StandardMaterial("skybox-preview-mat", this.scene);
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.emissiveColor = Color3.Black();
    const tex = new Texture(textureUrl, this.scene);
    tex.level = intensity;
    mat.emissiveTexture = tex;
    mat.disableLighting = true;
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.infiniteDistance = false;
    this.skyboxMesh = mesh;
  }

  clearSkyboxPreview(): void {
    if (this.skyboxMesh) {
      const mat = this.skyboxMesh.material as StandardMaterial | null;
      mat?.emissiveTexture?.dispose();
      mat?.dispose();
      this.skyboxMesh.dispose();
      this.skyboxMesh = null;
    }
  }

  /**
   * Preview the sun as the key light. `dir` points from the arena toward the
   * star; the light travels along -dir, matching the game's renderer.
   */
  setSun(dir: Vec3Tuple, colorHex: string, intensity: number): void {
    this.sunLight?.dispose();
    this.sunLight = new DirectionalLight(
      "sun-preview",
      new Vector3(-dir[0], -dir[1], -dir[2]),
      this.scene
    );
    this.sunLight.diffuse = Color3.FromHexString(colorHex);
    this.sunLight.intensity = intensity;
  }

  dispose(): void {
    this.engine.dispose();
  }
}
