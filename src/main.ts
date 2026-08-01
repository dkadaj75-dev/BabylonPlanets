import { EditorScene } from "./scene/EditorScene";

const canvas = document.getElementById("render-canvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("#render-canvas not found");
}

new EditorScene(canvas);
