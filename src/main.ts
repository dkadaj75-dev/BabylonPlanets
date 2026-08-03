import { EditorScene } from "./scene/EditorScene";
import { PlacementLayer } from "./scene/placements";
import { EditorState } from "./state/editorState";
import { buildPanels } from "./ui/panels";
import { generateSkybox } from "./skybox/generateSkybox";

const canvas = document.getElementById("render-canvas");
const sidebar = document.getElementById("sidebar");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("#render-canvas not found");
if (!(sidebar instanceof HTMLElement)) throw new Error("#sidebar not found");

const state = new EditorState();
const editor = new EditorScene(canvas);
const placements = new PlacementLayer(editor.scene);

let skyboxUrl: string | null = null;

const syncScene = (): void => {
  editor.setBounds(state.arena.bounds);
  placements.sync(state.arena);
};
state.onChange(syncScene);
syncScene();

buildPanels(sidebar, state, {
  onSkyboxGenerated(result) {
    if (skyboxUrl) URL.revokeObjectURL(skyboxUrl);
    skyboxUrl = URL.createObjectURL(result.blob);
    const radius = state.arena.bounds.shape === "sphere" ? state.arena.bounds.radius : 150;
    const skybox = state.arena.render?.skybox;
    editor.applySkyboxPreview(skyboxUrl, radius, skybox?.intensity ?? 0.9);
    editor.setSun(result.sunDir, skybox?.sun?.color ?? "#ffffff", skybox?.sun?.intensity ?? 1);
  }
});

// Default starfield + sun so the viewport reads as space from the first frame
// instead of a black void. Preview-only: it is not written into the arena —
// the Skybox panel's "Generate & preview" replaces it and records the config.
void generateSkybox({ width: 2048 }).then((result) => {
  if (skyboxUrl) return; // a user-generated panorama already took over
  skyboxUrl = URL.createObjectURL(result.blob);
  const radius = state.arena.bounds.shape === "sphere" ? state.arena.bounds.radius : 150;
  editor.applySkyboxPreview(skyboxUrl, radius, 0.9);
  editor.setSun(result.sunDir, "#ffe9d0", 1);
});
