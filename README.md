# Fabric — phone body scan

Fabric starts from [timcash/template](https://github.com/timcash/template) (Vite + TypeScript + Three.js, copied at `be59c4f`). It adds **Body Scan** ([scan.html](scan.html)), a browser app that measures a human body with a phone camera. Everything runs on the device. No frames are uploaded.

```sh
npm ci
npm run dev      # also fetches the pose model into public/mediapipe/
# open http://127.0.0.1:5173/scan.html  (a phone needs https: deploy, or tunnel the dev server)
```

The deck's masthead links to the scanner. Try it without a camera at `/scan.html?demo=1`, which runs the full flow on a synthetic body with known girths and shows measured beside true values.

## How a scan works

1. **Setup:** enter your height; it sets the metric scale. Prop the phone upright at waist height and stand 2.5–3 m away.
2. **Front:** face the camera with arms 30–45° out and feet hip-width apart. Live checks cover body detected, framing, facing, arms, feet, stillness and phone level. When all pass, a countdown captures six frames and takes their median.
3. **Turn:** raise both arms in a V and turn slowly through one full circle. Each frame gives the torso's caliper width at the chest, waist and hip from one angle. A dial shows the angles covered so far.
4. **Results:** 11 girths and 7 lengths, each with its method and an expected ±. The results page also shows a 3D cross-section view and annotated front and profile frames. You can export CSV or JSON, or a **capture package** (frames, person masks, landmarks and scale) for offline photogrammetry or Gaussian-splat training.

There is also a **two-photo mode** (front, plus an optional side photo) and a quicker **profile instead of turn** option.

| Measurement | Method |
| --- | --- |
| Chest, waist, hip | **Turntable:** caliper widths by angle integrated with Cauchy's formula, P = ∫₀^π w(θ) dθ. This is the convex outline a tape follows, with no ellipse assumed. Falls back to two-view (front width plus profile depth, as an ellipse), then to a front-only estimate. |
| Neck, thigh, knee, calf, ankle | Two-view ellipse, or a circular section without a profile view. |
| Upper arm, forearm, wrist | Perpendicular limb width, circular section. |
| Shoulder breadth, inseam, shoulder–crotch, waist height | Silhouette distances. |
| Arm length, hip-joint height, torso length | Pose-landmark distances. |

How it is built: MediaPipe Pose Landmarker (33 landmarks plus a person mask) runs in WebAssembly and WebGL. The landmarks place each measurement level, and the soft mask gives sub-pixel widths. Heights above the floor, not pixel rows, link the views. Plausibility gates reject merged silhouettes, such as two people touching, bent arms, or a crotch that cannot be found, instead of reporting nonsense.

Research notes, design rationale and an honest accuracy discussion are in **[docs/body-scan-research.md](docs/body-scan-research.md)**. Accuracy is verified against a synthetic body: torso and leg girths within 0.5%, lengths within 0.5 cm. It has **not yet been validated against tape measures on real people**. Clothing, hair, posture and tilt dominate real-world error.

| Path | Purpose |
| --- | --- |
| `src/scan/measure.ts` | Front/profile silhouette anthropometry, plausibility gates, multi-frame median |
| `src/scan/turntable.ts` | Yaw from projected spans, angle bins, Cauchy girth |
| `src/scan/geometry.ts`, `mask.ts` | Ellipse/Cauchy perimeters; sub-pixel runs, chords, connected vertical extent |
| `src/scan/synthetic.ts` | Parametric body with exact ground truth (tests and demo) |
| `src/scan/quality.ts` | Live capture checks |
| `src/scan/pose-mediapipe.ts`, `feeds.ts` | Self-hosted MediaPipe, camera/demo feeds, tilt |
| `src/scan/main.ts`, `scan.html`, `scan.css` | Capture flow and results UI |
| `src/scan/view3d.ts`, `capture-package.ts` | 3D cross-sections; zip export for splatting |
| `scripts/prepare-pose-assets.ts` | Copies the WASM runtime and downloads `pose_landmarker_full.task` (runs before dev/build) |
| `test/scan-measure.test.ts`, `scripts/scan-browser-test.ts` | Unit tests; browser test under the production CSP (demo, photo mode, fake camera) |

`npm run test:scan` runs the browser test. Set `SCAN_TEST_PHOTO=/path/to/photo.jpg` to also require a full measurement from a real photo. **Run it on a phone.** The camera needs https, so pick one of these:

- **GitHub Pages:** in repository Settings → Pages, set Source to *GitHub Actions*. [.github/workflows/pages.yml](.github/workflows/pages.yml) then deploys on every push to `main`, building with `BASE_PATH=/<repo>/`. Open `https://<user>.github.io/fabric/scan.html`.
- **Cloudflare:** rename the Worker in `wrangler.jsonc` if you like, then run `npm run deploy`. `public/_headers` allows `camera=(self)` and `'wasm-unsafe-eval'`; everything else stays `'self'`.
- **Local:** run `npm run dev -- --host` and reach it through an https tunnel. Plain-http LAN addresses get no camera.

---

# Template — recursive nodes (inherited)

A reusable Vite + TypeScript + Three.js presentation with five example slides. The UI has one domain object: **Node**. Slide mode presents the five root examples in order; DAG mode explores nodes and their connections.

## Domain language

Use this vocabulary in visible instructions, code, hotkeys, and test assertions. **Workplane, container, card, and slide are not separate graph entities.**

| Term | Definition |
| --- | --- |
| **Node** | One item with an ID, title, content, color, a parent, children, and links between its children. Every node has the same capabilities. |
| **Root node** | The single node whose parent is null. Every other node belongs beneath it. The app starts inside Root, showing its five example children. |
| **Parent / child** | A containment relationship: the child lives inside its parent. Each non-root node has exactly one parent. |
| **Sibling** | A node with the same parent as another node. |
| **Interior** | The flat 2D plane displayed when a node is open. It shows that node’s direct children arranged as a DAG. It is a view, not another stored object. |
| **Open node** | The node whose interior is currently displayed. Its ID determines the editing context. |
| **Selected node** | The child targeted by focus, open, color, delete, or dependency-navigation actions. Selection is not the same as the open parent. |
| **Dependency link** | A directed connection between siblings. A link means “depends on,” not “is contained inside.” Links cannot form cycles. |
| **DAG** | The acyclic graph of one parent’s direct children and their dependency links. The same rule applies at every nesting depth. |
| **Rank / lane** | A dependency column / a row within that column. Automatic layout assigns non-overlapping cells on the parent’s plane. |
| **Depth** | How many parent-child boundaries have been opened below Root. It is not a camera distance or a detail level. |
| **Breadcrumb** | The containment path from Root to the open node. Clicking an ancestor returns inside it. |
| **Slide mode** | The sequential presentation of the five root examples. Nested content uses the same node hierarchy; Present returns to its owning root example. |
| **DAG mode** | The spatial view of the open node’s children, using the same Three.js renderer and canvas. |
| **Editable example** | The nodes inside Root → Interact → Editable graph, also shown on the Interact slide. These are the same data objects in both views, not a second graph. |

### The one rule

**Open any node → show its direct children as a DAG on a flat plane → select and open any child → repeat.**

An empty node opens to an empty plane. C creates its first child there. Nothing new is stored merely because a node was opened: an interior is the node’s view. A newly created child can immediately be opened and populated the same way.

There is no configured nesting-depth limit. Lookup and snapshot traversal are iterative, and tests exercise 512 successive opens. “Unbounded nesting” describes the model, not infinite browser memory; practical limits still depend on the device.

### Example hierarchy

```text
Root                            parent: null
├── Welcome
├── Navigate
├── Interact
│   ├── Editable graph
│   │   ├── Node 1
│   │   ├── Node 2
│   │   └── …                   each can contain another DAG
│   └── Edit the graph
│       ├── Create
│       │   └── Your new node
│       │       └── Another node
│       ├── Change color
│       └── Remove
├── Playback
└── Make it yours
```

The root’s dependency links branch from Navigate into Interact and Playback, then join at Make it yours. Those links do not change containment. **L follows a dependency; N opens a child; T returns to the parent.**

## Three zoom levels

Only one representation of each visible node is rendered at a time:

| Level | Representation | Use |
| --- | --- | --- |
| **Point** | A compact point and connections | Read the whole graph’s shape. |
| **Summary** | The node’s title | Identify and select a node. |
| **Full content** | Title, description, child count, and the same live 3D scene shown in Slide mode | Inspect the slide’s content; N opens its child DAG. |

Zoom changes representation, not the hierarchy. **N** or double-click opens the selected node’s child DAG; **Enter** only focuses it. Child node centers all lie on the same local plane. Ancestor layers are not stacked over the current graph. The plane is rendered by Three.js and can still be orbited.

## Actions and hotkeys

The executable catalog is [src/hotkeys.ts](src/hotkeys.ts). The guide renders that catalog, and tests verify that every binding resolves to its documented action.

| Context | Action | Hotkey / gesture |
| --- | --- | --- |
| Both | Switch Slide / DAG presentation | G or / |
| Both | Open guide and hotkey reference | ? |
| Both | Start / stop Controls walkthrough | W / Tour button |
| Both | Stop walkthrough or story; close an open guide | Escape |
| Both | Open the selected node’s child DAG | N / double-click in DAG |
| Both | Return to parent node | T |
| Both | Create inside the currently open parent | C |
| Both | Recolor selected node | X |
| Both | Remove a created node, its descendants, and incident links | Delete / Backspace |
| Both | Orbit clockwise / counterclockwise | O / Shift+O; drag |
| Both | Reset camera / frame the currently open node | R |
| Slides | Previous / next root example | ↑ / ↓; ← / → and PageUp / PageDown are aliases |
| Slides | First / last example | Home / End |
| Slides | Invoke the visible action button | Enter |
| Slides | Start / pause Story playback | Space |
| Interact slide | Select previous / next editable node | [ / ] |
| Interact slide | Restore the initial five editable nodes | Shift+R / Reset graph |
| DAG | Select previous / next sibling in content order | [ / ] |
| DAG | Select upstream / downstream rank | H / L |
| DAG | Select next / previous lane | J / K |
| DAG | Follow an incoming dependency | U or P |
| DAG | Focus selected node | Enter |
| DAG | Toggle direct-neighbor trace | Shift+Enter / Trace |
| DAG | Return inside Root and frame its children | F / Home / Root |
| DAG | Present the owning root example | V / Present |
| DAG | Pan without changing selection | Arrow keys; right-drag or Shift-scroll |
| DAG | Increase / decrease detail | Shift+↑ / Shift+↓ |
| DAG | Zoom in / out | + / −; wheel |

C creates a sibling of the selection **inside the open parent**, connected from that selection. To create inside the selected node instead, press **N, then C**. On the Interact slide the visible editable graph’s parent is Editable graph. N opens its selected node in DAG mode. T from Slide mode exposes the parent DAG.

Authored examples are protected from deletion so the template’s five-slide presentation remains available. Created nodes can be removed, including their descendants. Node edits are local to the running page and reset on reload; there is no persistence or collaboration backend.

Native buttons keep Enter/Space activation; inputs and dialog controls keep their normal keyboard behavior. In DAG mode, Escape returns to the parent only when no walkthrough or guide is active.

## Playback, walkthrough, and tests

| Term | Contract |
| --- | --- |
| **Story playback** | Timed traversal of the five slides, not a demonstration of every control. |
| **Controls walkthrough** | The Tour button / W runs a guided demonstration through the normal UI input handlers. |
| **Step** | An instruction, a demonstrated input, and an expected observable result. |
| **Assertion** | A check of real mode, node count, selection, parent, camera, or detail state. Showing text alone is not success. |
| **Takeover** | Real user input cancels pending walkthrough actions immediately. Temporary tour edits are restored before the user’s action proceeds. |
| **Dwell** | A readable pause between verified steps, adjustable for testing. |

The walkthrough demonstrates the five slides, navigation, editing, playback, help, switching views, graph movement, tracing, camera controls, every detail level, opening empty nodes, recursive creation, deletion, and parent/root recovery.

[Shared steps](src/walkthrough-steps.ts) drive both the live walkthrough and a headless replay using real keyboard/pointer inputs. The browser tests also run the live controller, check cancellation and edit restoration, verify coplanar child meshes and deep nesting, and save screenshots to a temporary folder. Existing tests retain touch, wheel momentum, history, reduced-motion, and WebGL-fallback coverage.

Use `?tourDuration=2000` for a two-second story interval (default 10000 ms; bounds 800–60000). Use `?walkthroughSpeed=4` for a four-times-faster controls walkthrough (default 1; bounds 0.25–20). Assertions are never skipped. Neither tour starts without an explicit action.

## Develop and verify

Use Node.js 24 or newer:

```sh
npm ci
npm run dev
npm run check
```

| Command | Purpose |
| --- | --- |
| npm test | Model, recursive containment, layout, hotkey, and navigation tests |
| npm run build | Type checking and production bundle |
| npm run test:browser | Slide controls, real editable meshes, touch, history, and fallback |
| npm run test:dag | Node selection, opening, detail, mobile, and mode-switch regression tests |
| npm run test:walkthrough | Shared controls tour, live controller, cancellation, and recursive browser tests |
| npm run check | All tests and production build |
| npm run preview | Serve the production bundle |
| npm run deploy | Build and deploy with Cloudflare Wrangler |

Set CHROME_PATH for a nonstandard Chrome installation. Customize initial presentation data in [src/slides.ts](src/slides.ts), node relationships in [src/slide-dag.ts](src/slide-dag.ts), models in [src/scene.ts](src/scene.ts), and styles in [src/style.css](src/style.css).

See the [guide](docs/guide.md) and [dag/v1 comparison](docs/dag-reference.md). Cloudflare hosting is optional; choose a unique Worker name before deploying. No credentials are included and pushing Git alone does not deploy this repository.

## H3 geospatial example

[H3](https://h3geo.org) is a hierarchical hexagonal grid for the whole Earth. Each point maps to one cell at each resolution, from 0 (continent-sized) to 15 (about 1 m2). Cells nest inside coarser parents, have six neighbors (five for the 12 pentagons at each resolution), and can be compared by grid distance.

[src/h3-example.ts](src/h3-example.ts) is a standalone example built on [h3-js](https://github.com/uber/h3-js) v4. It is not used by the scene or slides. h3-js was chosen because it is the H3 C library compiled to pure JS/WASM: there is no cgo, node-gyp, or other native toolchain, so it installs the same way on Windows, macOS, Linux, and in the browser.

| Function | h3-js call | Result |
| --- | --- | --- |
| cellAt(lat, lng, res) | latLngToCell | Cell containing a point |
| boundaryOf(cell) | cellToBoundary | [lat, lng] vertices (6, or 5 for pentagons) |
| neighborsOf(cell, k) | gridDisk | Cell plus all cells within k steps |
| parentOf(cell, res) | cellToParent | Coarser ancestor |
| childrenOf(cell, res) | cellToChildren | Finer descendants |
| distanceBetween(a, b) | gridDistance | Grid steps between two cells |
| areaKm2(cell) | cellArea | Area in km2 |
| summarizeCell(lat, lng, res) | all of the above | One plain object with every fact |

The example location is downtown Denver (39.7392, -104.9903) at resolution 9, where a cell is about 0.1 km2. [test/h3-example.test.ts](test/h3-example.test.ts) checks validity, resolution, boundary size, the 7-cell disk, parent and child containment, and grid distances of 1 and 0. Run it with npm test, or alone with:

```sh
node --experimental-strip-types --test test/h3-example.test.ts
```

## dag/v1 parity and remaining work

DAG mode uses a black background, a faint neutral grid, charcoal node panels, and selection outlines. No filled blue workplane sits behind the graph. The slide models retain their original colors and live 3D previews.

The [source-backed functionality map](docs/dag-reference.md) separates implemented controls, partial parity, deliberate differences, and product features absent from both UIs. Next priorities are node-content editing, independent link editing/insertion, undo/redo, and persistence; then animated layout, camera continuity, trace-link emphasis, and performance telemetry. Collaboration and executable optimization loops require a backend, not just the reference’s UI code. These are proposed work, not current functionality.
