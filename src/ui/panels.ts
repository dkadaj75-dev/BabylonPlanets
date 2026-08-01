import { ZodError } from "zod";
import { arenaSlug, type EditorState } from "../state/editorState";
import { exportArena } from "../export/exportArena";
import {
  generateSkybox,
  normalize,
  type GeneratedSkybox
} from "../skybox/generateSkybox";

export interface PanelHooks {
  /** Called after a panorama is generated so the scene can preview it. */
  onSkyboxGenerated(result: GeneratedSkybox): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function numField(
  label: string,
  value: number,
  onCommit: (v: number) => void,
  step = 1
): HTMLElement {
  const wrap = el("label", "field");
  wrap.append(el("span", "field-label", label));
  const input = el("input");
  input.type = "number";
  input.step = String(step);
  input.value = String(value);
  input.addEventListener("change", () => {
    const v = Number(input.value);
    if (Number.isFinite(v)) onCommit(v);
  });
  wrap.append(input);
  return wrap;
}

function textField(label: string, value: string, onCommit: (v: string) => void): HTMLElement {
  const wrap = el("label", "field");
  wrap.append(el("span", "field-label", label));
  const input = el("input");
  input.type = "text";
  input.value = value;
  input.addEventListener("change", () => onCommit(input.value));
  wrap.append(input);
  return wrap;
}

function section(title: string, ...children: (HTMLElement | string)[]): HTMLElement {
  const d = el("details", "panel-section");
  d.open = true;
  const summary = el("summary", undefined, title);
  d.append(summary, ...children);
  return d;
}

export function buildPanels(root: HTMLElement, state: EditorState, hooks: PanelHooks): void {
  // Transient (non-exported) UI state survives panel rebuilds.
  const sky = {
    dirX: 0.5,
    dirY: 0.3,
    dirZ: -0.812,
    color: "#ffe9d0",
    seed: 1,
    stars: 2200,
    width: 2048
  };
  let lastSkybox: GeneratedSkybox | null = null;
  let skyStatus = "";
  let exportError = "";

  const arenaSection = (): HTMLElement => {
    const a = state.arena;
    const kids: HTMLElement[] = [
      textField("Name", a.name, (v) => {
        a.name = v;
        state.notify();
      }),
      textField("Id (arena.…)", a.id, (v) => {
        a.id = v.startsWith("arena.") ? v : `arena.${v}`;
        state.notify();
      })
    ];
    if (a.bounds.shape === "sphere") {
      kids.push(
        numField("Bounds radius", a.bounds.radius, (v) => {
          if (a.bounds.shape === "sphere") a.bounds.radius = v;
          state.notify();
        })
      );
    }
    return section("Arena", ...kids);
  };

  const placementsSection = (): HTMLElement => {
    const rows = state.arena.asteroidPlacements.map((p, i) => {
      const row = el("div", "row");
      row.append(
        textField("Asteroid id", p.asteroidId, (v) => {
          p.asteroidId = v;
          state.notify();
        }),
        numField("x", p.position.x, (v) => ((p.position.x = v), state.notify())),
        numField("y", p.position.y ?? 0, (v) => ((p.position.y = v), state.notify())),
        numField("z", p.position.z, (v) => ((p.position.z = v), state.notify())),
        numField("yaw (rad)", p.rotation ?? 0, (v) => ((p.rotation = v), state.notify()), 0.1),
        numField("scale", p.scale ?? 1, (v) => ((p.scale = v), state.notify()), 0.1)
      );
      const remove = el("button", "danger", "Remove");
      remove.addEventListener("click", () => {
        state.arena.asteroidPlacements.splice(i, 1);
        state.notify();
      });
      row.append(remove);
      return row;
    });
    const add = el("button", undefined, "+ Add asteroid");
    add.addEventListener("click", () => {
      state.arena.asteroidPlacements.push({
        asteroidId: "asteroid.large-hazard",
        position: { x: 0, y: 0, z: 0 }
      });
      state.notify();
    });
    return section("Asteroids", ...rows, add);
  };

  const spawnsSection = (): HTMLElement => {
    const rows = state.arena.spawnPoints.map((sp, i) => {
      const row = el("div", "row");
      row.append(
        textField("Id", sp.id, (v) => ((sp.id = v), state.notify())),
        numField("Team", sp.team, (v) => ((sp.team = Math.max(0, Math.round(v))), state.notify())),
        numField("x", sp.position.x, (v) => ((sp.position.x = v), state.notify())),
        numField("y", sp.position.y ?? 0, (v) => ((sp.position.y = v), state.notify())),
        numField("z", sp.position.z, (v) => ((sp.position.z = v), state.notify())),
        numField("heading (rad)", sp.heading, (v) => ((sp.heading = v), state.notify()), 0.1),
        numField("pitch (rad)", sp.pitch ?? 0, (v) => ((sp.pitch = v), state.notify()), 0.1)
      );
      const remove = el("button", "danger", "Remove");
      remove.addEventListener("click", () => {
        state.arena.spawnPoints.splice(i, 1);
        state.notify();
      });
      row.append(remove);
      return row;
    });
    const add = el("button", undefined, "+ Add spawn point");
    add.addEventListener("click", () => {
      const n = state.arena.spawnPoints.length;
      state.arena.spawnPoints.push({
        id: `sp-${n + 1}`,
        team: n % 2,
        position: { x: 0, y: 0, z: 0 },
        heading: 0
      });
      state.notify();
    });
    return section("Spawn points", ...rows, add);
  };

  const skyboxSection = (): HTMLElement => {
    const dirRow = el("div", "row");
    dirRow.append(
      numField("sun dir x", sky.dirX, (v) => (sky.dirX = v), 0.05),
      numField("sun dir y", sky.dirY, (v) => (sky.dirY = v), 0.05),
      numField("sun dir z", sky.dirZ, (v) => (sky.dirZ = v), 0.05)
    );

    const colorWrap = el("label", "field");
    colorWrap.append(el("span", "field-label", "Sun color"));
    const colorInput = el("input");
    colorInput.type = "color";
    colorInput.value = sky.color;
    colorInput.addEventListener("change", () => (sky.color = colorInput.value));
    colorWrap.append(colorInput);

    const optsRow = el("div", "row");
    optsRow.append(
      numField("Seed", sky.seed, (v) => (sky.seed = Math.round(v))),
      numField("Stars", sky.stars, (v) => (sky.stars = Math.max(0, Math.round(v)))),
      numField("Width (px)", sky.width, (v) => (sky.width = Math.max(256, Math.round(v))))
    );

    const status = el("div", "status", skyStatus);

    const generate = el("button", "primary", "Generate & preview");
    generate.addEventListener("click", () => {
      void (async () => {
        skyStatus = "generating…";
        status.textContent = skyStatus;
        try {
          const result = await generateSkybox({
            width: sky.width,
            sunDir: normalize([sky.dirX, sky.dirY, sky.dirZ]),
            sunColor: sky.color,
            seed: sky.seed,
            starCount: sky.stars
          });
          lastSkybox = result;
          const slug = arenaSlug(state.arena.id);
          state.arena.render = {
            ...state.arena.render,
            skybox: {
              texture: `skyboxes/${slug}.webp`,
              intensity: 0.9,
              sun: { dir: result.sunDir, color: sky.color, intensity: 1 }
            }
          };
          hooks.onSkyboxGenerated(result);
          skyStatus = `generated ${result.width}×${result.height} (${(result.blob.size / 1024).toFixed(0)} KiB)`;
          state.notify();
        } catch (err) {
          skyStatus = `failed: ${err instanceof Error ? err.message : String(err)}`;
          state.notify();
        }
      })();
    });

    const download = el("button", undefined, "Download .webp");
    download.addEventListener("click", () => {
      if (!lastSkybox) return;
      const url = URL.createObjectURL(lastSkybox.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${arenaSlug(state.arena.id)}.webp`;
      a.click();
      URL.revokeObjectURL(url);
    });

    return section("Skybox", dirRow, colorWrap, optsRow, generate, download, status);
  };

  const exportSection = (): HTMLElement => {
    const download = el("button", "primary", "Download arena JSON");
    download.addEventListener("click", () => {
      try {
        const { filename, json } = exportArena(state.arena);
        const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        exportError = "";
      } catch (err) {
        exportError =
          err instanceof ZodError
            ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n")
            : String(err);
      }
      state.notify();
    });

    const manifest = el("pre", "manifest");
    manifest.textContent = `content/manifest.json entry:\n"arenas/${arenaSlug(state.arena.id)}.json"`;

    const error = el("pre", "error", exportError);

    return section("Export", download, manifest, error);
  };

  const rebuild = (): void => {
    root.textContent = "";
    root.append(
      el("h1", "app-title", "BabylonPlanets"),
      arenaSection(),
      placementsSection(),
      spawnsSection(),
      skyboxSection(),
      exportSection()
    );
  };

  state.onChange(rebuild);
  rebuild();
}
