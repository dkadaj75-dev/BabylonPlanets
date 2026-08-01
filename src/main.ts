import { EditorScene } from "./scene/EditorScene";
import { PlacementLayer } from "./scene/placements";
import { EditorState } from "./state/editorState";
import { buildPanels } from "./ui/panels";

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
