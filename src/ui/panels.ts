import { ZodError } from "zod";
import { arenaSlug, type EditorState } from "../state/editorState";
import { exportArena } from "../export/exportArena";
import { buildArenaBundle } from "../export/exportBundle";
import { importArenaFile, type ImportResult } from "../state/importArena";
import { EXAMPLE_MAPS, loadExampleMap } from "../examples/index";
import { validateGeometry, type Diagnostic } from "../validate/geometry";
import {
  generateSkybox,
  normalize,
  type GeneratedSkybox
} from "../skybox/generateSkybox";

export interface PanelHooks {
  /** Called after a panorama is generated so the scene can preview it. */
  onSkyboxGenerated(result: GeneratedSkybox): void;
}

/**
 * Handle returned to the bootstrap so input surfaces that live outside the
 * sidebar — currently drag-and-drop on the viewport — can drive the same
 * import path, and report into the same panel, as the file picker.
 */
export interface PanelController {
  importFile(file: File): void;
}

/**
 * Render a thrown value the way an author can act on it: zod issues carry the
 * offending field path, which is far more useful than the default message
 * blob, and both the export and import paths want identical treatment.
 */
function formatError(err: unknown): string {
  if (err instanceof ZodError) {
    return err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
  }
  return err instanceof Error ? err.message : String(err);
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

export function buildPanels(
  root: HTMLElement,
  state: EditorState,
  hooks: PanelHooks
): PanelController {
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
  let importStatus = "";
  let importWarnings: string[] = [];
  let importError = "";
  let selectedExample = EXAMPLE_MAPS[0]?.id ?? "";
  let bundleStatus = "";

  /**
   * Swap the whole model for a freshly imported one.
   *
   * The generated panorama is deliberately dropped: it belongs to the map that
   * was open a moment ago, and carrying it forward would let the bundle export
   * ship one map's sky inside another map's zip.
   */
  const applyImport = (result: ImportResult, source: string): void => {
    state.arena = result.arena;
    importWarnings = result.warnings;
    importError = "";
    exportError = "";
    bundleStatus = "";
    lastSkybox = null;
    skyStatus = "";
    importStatus = `loaded ${source}`;
    state.notify();
  };

  const reportImportFailure = (err: unknown, source: string): void => {
    importError = formatError(err);
    importStatus = `could not load ${source}`;
    importWarnings = [];
    state.notify();
  };

  const importFile = (file: File): void => {
    void importArenaFile(file)
      .then((result) => applyImport(result, file.name))
      .catch((err: unknown) => reportImportFailure(err, file.name));
  };

  const loadSection = (): HTMLElement => {
    const picker = el("select", "example-select");
    for (const map of EXAMPLE_MAPS) {
      const opt = el("option", undefined, `${map.name} — ${map.description}`);
      opt.value = map.id;
      if (map.id === selectedExample) opt.selected = true;
      picker.append(opt);
    }
    picker.addEventListener("change", () => {
      selectedExample = picker.value;
      state.notify();
    });

    const load = el("button", "primary", "Load example");
    load.addEventListener("click", () => {
      if (!selectedExample) return;
      try {
        applyImport(loadExampleMap(selectedExample), selectedExample);
      } catch (err) {
        reportImportFailure(err, selectedExample);
      }
    });

    // A label wrapping the input is what makes the control tappable on iPad,
    // where a bare file input renders as an easily-missed sliver.
    const fileWrap = el("label", "field");
    fileWrap.append(el("span", "field-label", "…or open an arena JSON"));
    const file = el("input");
    file.type = "file";
    file.accept = "application/json,.json";
    file.addEventListener("change", () => {
      const picked = file.files?.[0];
      if (picked) importFile(picked);
    });
    fileWrap.append(file);

    const hint = el("div", "status", "You can also drop a .json file onto the viewport.");
    const status = el("div", "status", importStatus);
    const warn = el("div", "warn-list");
    for (const w of importWarnings) warn.append(el("div", "diag diag-warning", w));
    const error = el("pre", "error", importError);

    return section("Load", picker, load, fileWrap, hint, status, warn, error);
  };

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

  const flagBasesSection = (): HTMLElement => {
    const bases = state.arena.flagBases ?? [];
    const rows = bases.map((fb, i) => {
      const row = el("div", "row");
      row.append(
        textField("Id", fb.id, (v) => ((fb.id = v), state.notify())),
        numField("Team", fb.team, (v) => ((fb.team = Math.max(0, Math.round(v))), state.notify())),
        numField("x", fb.position.x, (v) => ((fb.position.x = v), state.notify())),
        numField("y", fb.position.y ?? 0, (v) => ((fb.position.y = v), state.notify())),
        numField("z", fb.position.z, (v) => ((fb.position.z = v), state.notify())),
        numField("radius", fb.radius, (v) => ((fb.radius = v), state.notify()))
      );
      const remove = el("button", "danger", "Remove");
      remove.addEventListener("click", () => {
        bases.splice(i, 1);
        // Drop the key entirely rather than leaving []: the design prompt says
        // a non-CTF map omits the array, and an empty one would show up in
        // every future export of what is now a deathmatch map.
        if (bases.length === 0) delete state.arena.flagBases;
        state.notify();
      });
      row.append(remove);
      return row;
    });

    const add = el("button", undefined, "+ Add flag base");
    add.addEventListener("click", () => {
      const next = state.arena.flagBases ?? (state.arena.flagBases = []);
      // Mirror the shipped CTF convention: blue is team 0 to the west, red is
      // team 1 to the east, both a little behind the spawn line.
      const isBlue = next.length % 2 === 0;
      const radius = state.arena.bounds.shape === "sphere" ? state.arena.bounds.radius : 126;
      const x = Math.round(radius * 0.76) * (isBlue ? -1 : 1);
      next.push({
        id: isBlue ? "flag-base-blue" : "flag-base-red",
        team: isBlue ? 0 : 1,
        position: { x, y: 0, z: 0 },
        radius: 16
      });
      state.notify();
    });

    const hint = el(
      "div",
      "status",
      bases.length === 0 ? "Capture-the-flag maps only — leave empty for deathmatch." : ""
    );
    return section("Flag bases", ...rows, add, hint);
  };

  /**
   * Live report against the game's shipped-arena geometry rules.
   *
   * Recomputed on every model change rather than behind a "check" button: the
   * whole point is that an author sees a corridor or separation violation the
   * moment they type the coordinate that caused it, instead of discovering it
   * in the game's CI. The pass is pure arithmetic over a few dozen rocks, so
   * running it on each edit costs nothing measurable.
   */
  const geometrySection = (): HTMLElement => {
    const report = validateGeometry(state.arena);
    const errors = report.diagnostics.filter((d) => d.severity === "error").length;
    const warnings = report.diagnostics.filter((d) => d.severity === "warning").length;

    const headline = el(
      "div",
      report.ok ? "diag diag-ok" : "diag diag-error",
      report.ok
        ? `✓ passes the game's geometry rules${warnings ? ` (${warnings} advisory)` : ""}`
        : `✗ ${errors} rule violation${errors === 1 ? "" : "s"} — this map would fail the game's CI`
    );

    const list = el("div", "diag-list");
    for (const d of report.diagnostics as Diagnostic[]) {
      list.append(el("div", `diag diag-${d.severity}`, `[${d.rule}] ${d.message}`));
    }

    const s = report.stats;
    const fmt = (n: number | null): string => (n === null ? "—" : n.toFixed(2));
    const stats = el(
      "div",
      "status",
      `${s.rockCount} rocks · ${s.centrepieceCount} centrepiece · min gap ${fmt(s.minSurfaceGap)} ` +
        `· max extent ${fmt(s.maxExtent)}/${fmt(s.boundsRadius)} · y ${fmt(s.yMin)}…${fmt(s.yMax)} ` +
        `· ${s.teamCount} teams`
    );

    return section("Geometry check", headline, list, stats);
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
          if (result.blob.type !== "image/webp") {
            skyStatus +=
              " — this browser can't encode webp (saved as PNG); convert to .webp before shipping";
          }
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
      const ext = lastSkybox.blob.type === "image/webp" ? "webp" : "png";
      a.download = `${arenaSlug(state.arena.id)}.${ext}`;
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
        exportError = formatError(err);
      }
      state.notify();
    });

    // The full content/ tree, which is what the game actually consumes: the
    // arena JSON, the panorama under its real extension, and the manifest
    // lines — a config missing from the manifest does not exist to the loader.
    const bundle = el("button", undefined, "Download content bundle (.zip)");
    bundle.addEventListener("click", () => {
      void (async () => {
        bundleStatus = "building…";
        state.notify();
        try {
          const built = await buildArenaBundle({
            arena: state.arena,
            skybox: lastSkybox?.blob ?? null
          });
          const url = URL.createObjectURL(built.blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = built.filename;
          a.click();
          URL.revokeObjectURL(url);
          exportError = "";
          bundleStatus = `${built.filename} — ${built.contents.join(", ")}${
            lastSkybox ? "" : " (no panorama generated yet, so none included)"
          }`;
        } catch (err) {
          exportError = formatError(err);
          bundleStatus = "";
        }
        state.notify();
      })();
    });

    const manifest = el("pre", "manifest");
    manifest.textContent = `content/manifest.json entry:\n"arenas/${arenaSlug(state.arena.id)}.json"`;

    const status = el("div", "status", bundleStatus);
    const error = el("pre", "error", exportError);

    return section("Export", download, bundle, manifest, status, error);
  };

  const rebuild = (): void => {
    root.textContent = "";
    root.append(
      el("h1", "app-title", "BabylonPlanets"),
      loadSection(),
      arenaSection(),
      geometrySection(),
      placementsSection(),
      spawnsSection(),
      flagBasesSection(),
      skyboxSection(),
      exportSection()
    );
  };

  state.onChange(rebuild);
  rebuild();

  return { importFile };
}
