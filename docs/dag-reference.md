# DAG v1 → template: functionality map

Reviewed **2026-09-10**, against local `~/gradient-cli` files and template baseline `0476360`. This is a source audit, not a claim that the reference runtime or deployed site was tested. The neutral-background change is implemented; the remaining gaps are a roadmap.

## What dag/v1 actually runs

The [Vite entry point][entry] imports the shared [Cloudflare site CSS][css], renders `/robotic-welding-technician/graph`, and imports the [graph runtime][runtime]. That runtime uses **custom WebGPU rendering and projection**, with a canvas fallback—not Three.js. Hidden DOM labels provide accessibility; visible GPU labels use an SDF glyph atlas.

The reference README is not fully aligned with this runtime: it advertises D for arrows and Enter for tour progression, but the inspected `handleHotkey` has no D action and Enter focuses a node. The matrix below follows executable code, not those older descriptions.

GitNexus did not resolve the runtime symbols, and template is not indexed. This comparison follows actual imports and handlers directly. The local gradient-cli directory did not provide a Git revision; these SHA-256 hashes identify the inspected snapshot:

| File under gradient-cli | SHA-256 |
| --- | --- |
| `dag/v1/ui/src/main.ts` | `85d7c7ae481d61eb6dabe2dc250583907a851798b798d6157362f11fe5d602ba` |
| `cloudflare/v1/ui/src/style.css` | `7b26df85145a0bc43e6ebf2bca00c7fc52e2dcf1d7f50e84fdc9b651a33ffe8f` |
| `robotic-welding-technician/v1/assets/robotic-welding-technician-graph.js` | `87699dbe333e7cf6593a7aaba9745ae180234ca9f75fb10ab5b5ce143ba11e74` |

## Visual change applied now

The reference [palette][palette] and [background shader][gpu] use black, faint white grid lines, neutral panels, and white outlines. Category color appears on points/top rails; selection and incident links receive stronger contrast.

Template’s large blue area was a **lit, filled Three.js plane**, not a CSS gradient. It has been removed. A node interior still defines the coordinate plane for its children; it does not need a filled mesh behind them.

- DAG background: black; grid and fog: neutral.
- Node panels: unlit charcoal so the slide models’ blue lights cannot tint them.
- Selection: brighter outline and neutral fill. X recolors outlines/points instead of flooding panel backgrounds.
- Links/text: neutral grays and white. DAG control backgrounds are charcoal.
- Slide-mode styling, real 3D model materials, animation, and shared previews are preserved. Blue content and small navigation accents are intentional.

Implementation: [DAG renderer](../src/dag-scene.ts), [scene/grid lifecycle](../src/scene.ts), and [styles](../src/style.css). Browser tests inspect rendered pixels as well as CSS, while retaining the mesh-sharing and animation assertions.

The reference also contains a blue-tinted nested-backplane helper. It is gated by `nestedGraphOpen`; normal `openNestedGraph` sets that flag false and switches active layers. It is not a reason to reintroduce a blue slab or stacked ancestor cards. See [layer entry][nesting] and [nested-preview helpers][nested-preview].

## Capability matrix

**Present** = usable in template. **Partial** = simpler/different implementation. **Missing** = not implemented in template. **Intentional** = preserve the requested template behavior rather than copying the reference.

Template evidence: [node/link model](../src/slide-dag.ts), [input actions and navigation](../src/main.ts), [hotkey catalog](../src/hotkeys.ts), [camera/rendering](../src/scene.ts), [DAG representations](../src/dag-scene.ts), [shared previews](../src/scene-preview.ts), [walkthrough](../src/walkthrough.ts), and [browser assertions](../scripts/dag-browser-test.ts).

### Nodes, links, and nesting

| Capability | Verified dag/v1 behavior | Template status and gap |
| --- | --- | --- |
| Select / focus | Label activation, Enter, brackets, HJKL, U/P predecessor. [Handlers][keys] | **Present.** Actual Three.js raycasts, keyboard selection/focus, accessible node buttons. |
| Create nodes | C creates a linked node in the active container at the next dependency rank. [Create][create] | **Present.** C creates inside the open parent and links from the selection. Containment stays distinct from dependencies. |
| Edit title / summary / metadata | `renameDemoWorkplane` changes a tour-created node directly. No general editing hotkey/form in the handler. [CRUD][crud] | **Missing.** Only color edits and source-file content edits exist. Build a real editor, not a tour-only mutation. |
| Delete nodes | `deleteDemoWorkplane` is a tour cleanup helper. Normal Delete/Escape only clears trace. [CRUD][crud], [keys][keys] | **Present for created nodes.** Delete removes descendants and incident links; authored examples remain protected. Broader authoring needs an explicit protection policy. |
| Arbitrary link CRUD | Internal add/remove helpers are used by creation and tour insertion; no general link-selection/editor interaction. [CRUD][crud] | **Missing as user operations.** Creation auto-links; deletion cleans up links. Cannot select, connect, reconnect, or delete an individual existing link. |
| Insert on an edge | Tour helper rewrites parent → child into parent → gate → child. [Insert][insert] | **Missing.** Needs an atomic command, rank recomputation, and replacement-edge tests. |
| Link metadata | Edges carry a label, but normal rendering has no label editor. [Create][create], [render][render] | **Missing.** Edges are only `{from,to}`. Typed ports, flow-rate/capacity and editable labels are product additions, not complete reference features. |
| Cycle prevention | Creation extends forward; `addRuntimeEdge` pushes without reachability validation. [CRUD][crud] | **Partial.** Layout rejects cycles/unknown endpoints; creation is acyclic by construction. Future arbitrary-link commands must validate before mutating state. |
| Recursive open / parent / root | N enters children, T returns, F/Home shows the root container. Empty nodes receive generated Inputs/Plan/Execute/Evidence examples. [Nesting][nesting] | **Present, intentionally different.** One root starts open. N shows actual children; empty interiors stay empty until C. No fixed runtime nesting depth. |
| Closed-root view | Initial visible layer contains just root. [Visibility][visibility] | **Intentional difference.** Template starts inside root with five slides. A closed-root representation is optional, not required for single-root ownership. |
| Shared slide content | Route bridge switches between separate slide pages and graph. [Bridge][slide-bridge] | **Present with a different architecture.** One Three.js renderer shares actual model resources across modes. Full content retains live scenes. Preserve this. |

### Layout, camera, and visual detail

| Capability | Verified dag/v1 behavior | Template status and gap |
| --- | --- | --- |
| Rank/lane reflow | 720 × 340 cells; frame loop eases positions toward layout targets. [Layout][layout], [frame loop][tick] | **Partial.** Stable topological 8.5 × 7 cells exist, but add/remove rebuilds meshes at final positions without animated reflow. |
| Layer-local rendering | Filters by active container; nested coordinates may have negative Z offsets. [Visibility][visibility], [nesting][nesting] | **Present.** Only direct children render on local XZ with Y=0. Preserve local coordinates rather than accumulating offsets. |
| Three LOD bands | Point/title/full from zoom; card dimensions and edge anchors change with LOD. [Render][render] | **Partial.** Three bands exist; links still use full-card offsets at point LOD. Add representation-aware endpoints. |
| Distance vs detail | 3D wheel changes camera distance scale; keyboard zoom changes zoom/LOD. [Input][input], [projection][projection] | **Different policy.** Template ties distance to LOD; wheel zoom/focus resets toward the standard DAG orientation. Independent detail control and orbit-preserving zoom are absent. |
| Enter / exit flight | Interpolates through the container to the destination, default 1280 ms. [Camera][camera] | **Partial.** Template has a 900 ms through-parent path to child-layer overview, not the first child. No per-node camera-pose restoration. |
| Pan sensitivity | Arrow pan scales inversely with zoom. [Keys][keys] | **Partial.** Arrows, pointer pan, orbit/reset and zoom exist; keyboard pan is a fixed world increment. |
| Navigation fallback | H/L fall back from rank lookup to links; brackets wrap within visible nodes. [Navigation][navigation] | **Partial / intentional.** Template H/L uses adjacent ranks and brackets clamp. Consider link fallback for irregular ranks; keep Slide mode non-wrapping. |
| Trace emphasis | Immediate neighbors highlighted, other nodes dimmed, incident links brighter/thicker. [Trace][trace], [render][render] | **Partial.** Node highlighting exists; links do not change style and other nodes are not dimmed. Full transitive tracing is absent in both. |
| Metadata / text | Category rail, rank/lane/depth, phase/summary, fitted SDF titles. [Text][text] | **Partial.** Title/description/child count and live scene exist; no category/phase schema or rank/lane labels. CanvasTexture text, not SDF. |
| Orientation gizmo | Static screen-space XYZ reference. [Gizmo][gizmo] | **Missing.** Prefer a camera-aware Three.js indicator rather than copying static axes. |
| Fullscreen | Stage fullscreen button. [Input][input] | **Missing.** Needs accessible enter/exit and focus restoration. |
| Neutral styling | Neutral GPU backdrop, outlined panels and category accents. [Palette][palette], [CSS][css] | **Implemented in this change.** Shader scan lines/vignette are not copied. |

### Rendering, observability, and testing

| Capability | Verified dag/v1 behavior | Template status and gap |
| --- | --- | --- |
| Backend / fallback | WebGPU first; canvas fallback draws graph geometry. [GPU][gpu], [fallback][fallback] | **Intentional backend difference / partial fallback.** Three.js WebGL; without WebGL template keeps slides/guide and disables DAG. Do not add a separate 2D graph without revisiting the one-canvas requirement. |
| Idle rendering | Frames stop once camera/layout/tour settle. [Frame loop][tick] | **Missing optimization.** Template continuously schedules frames. Animated previews need frames, but static LODs and reduced-motion scenes could idle. |
| Performance HUD | FPS, CPU frame time, queue-completion wait, bottleneck heuristic, FPS history. [Metrics][metrics] | **Missing.** No runtime frame-time HUD or graph-size performance budgets. |
| Per-step telemetry | Tour records FPS/CPU/GPU-wait and node/link deltas. [Tour][tour] | **Partial.** Template records step durations, assertions, structured logs and screenshots, not rendering telemetry. Queue wait is not hardware GPU execution time. |
| Frame capture hook | `window.__rwtRecordFrame` runs just after GPU submission. [Frame loop][tick] | **Different implementation.** Browser screenshots exist; no same-frame video/export hook. Add only if recording is needed. |
| Real-controls walkthrough | 22 reference steps mix key dispatch with direct rename/insert/delete helpers. [Tour][tour] | **Present.** Template shares 62 steps between live controller and headless replay. New features must gain real commands before the tour demonstrates them. |
| Automated coverage | dag/v1 CLI tests + Vite build; runtime onboarding assertions are separate. [CLI tests][cli-tests] | **Present.** 22 unit tests, Slide/DAG browser suites, full walkthrough, 512-level model and 35-level browser recursion, mobile, takeover, history, reduced motion, fallback. |

## Product gaps absent from both inspected UI runtimes

These are **not** capabilities we can simply copy from dag/v1:

- **Persistence:** save/load, schema versions, migrations, autosave, reload recovery, import/export. URL navigation is not saved graph content; template snapshots only restore temporary tour edits.
- **Undo/redo:** atomic and reversible node/link/insert/reparent commands.
- **Collaboration:** shared storage, identity/presence, concurrent editing, permissions, conflict resolution, reconnect/replay. Neither inspected runtime has a collaborative transport.
- **Authoring:** multi-select, duplicate/copy/paste, search, drag-reparent, presentation reorder, per-node content/model editing. Current pointer drag moves the camera, not nodes.
- **Workflow execution:** typed inputs/outputs, parallel inner loops, cancellation/retry, runs, provenance, evidence and measurable outer-loop improvements. The reference depicts a curriculum; its tour changes demo data, not a workflow engine.
- **Resource metrics:** wall-clock, latency distributions, memory and GPU-memory accounting need real measurement sources and explicit unavailable states.

## Recommended implementation order

Only the background change is implemented in this revision. The rest is proposed work.

| Priority | Increment / ownership | Acceptance test |
| --- | --- | --- |
| 1 | Node-content editor + undoable commands: `slide-dag.ts`, `main.ts`, `hotkeys.ts` | Edit nested title/description; cancel, commit, undo/redo; Full content updates without changing ownership. F2 is a proposed binding, not an existing one. |
| 1 | Edge selection, connect/disconnect/reconnect, insert: model + DAG renderer + input | Reject self-links, duplicates, cross-parent links and cycles before mutation; insert A→gate→B atomically; undo restores A→B. Preserve descendants and stable IDs. |
| 1 | Save/load + schema validation: new persistence module | Reload retains nested edits/path; malformed/cyclic imports fail safely; round-trip retains content and link metadata. |
| 2 | Animated reflow, LOD-aware links, camera continuity: `dag-scene.ts`, `scene.ts` | Add/remove siblings without final overlap; point links attach to points; orbit survives wheel zoom; parent return restores framing. Parameterize animation duration for tests. |
| 2 | Trace links, orientation, fullscreen: renderer + controls | Highlight incident links, dim unrelated nodes; preserve keyboard/focus behavior across fullscreen changes. |
| 2 | Performance measurements and idle policy: scene + walkthrough + browser tests | Capture frame-time percentiles and draw/memory counters with graph size; static/reduced-motion views idle; animated previews still move. |
| 3 | Collaboration and executable loops: command/persistence boundaries + new backend | Two browser contexts edit one graph and converge; concurrent link changes cannot form a cycle; reconnect recovers state; loop results come from actual runs. |

Keep **one Node, one root, recursive child DAGs, three representations**. Keep presentation order separate from dependency order and keep one Three.js canvas with real slide content. Do not copy demo-only mutations, generated placeholder children, or a second graph renderer into the product architecture.

## Source links

Reference links point to the inspected local checkout; template links are repository-relative.

[entry]: /Users/tim.c/gradient-cli/dag/v1/ui/src/main.ts:1
[css]: /Users/tim.c/gradient-cli/cloudflare/v1/ui/src/style.css:4138
[runtime]: /Users/tim.c/gradient-cli/robotic-welding-technician/v1/assets/robotic-welding-technician-graph.js:1
[palette]: /Users/tim.c/gradient-cli/robotic-welding-technician/v1/assets/robotic-welding-technician-graph.js:257
[visibility]: /Users/tim.c/gradient-cli/robotic-welding-technician/v1/assets/robotic-welding-technician-graph.js:170
[input]: /Users/tim.c/gradient-cli/robotic-welding-technician/v1/assets/robotic-welding-technician-graph.js:190
[navigation]: /Users/tim.c/gradient-cli/robotic-welding-technician/v1/assets/robotic-welding-technician-graph.js:291
[nesting]: /Users/tim.c/gradient-cli/robotic-welding-technician/v1/assets/robotic-welding-technician-graph.js:346
[camera]: /Users/tim.c/gradient-cli/robotic-welding-technician/v1/assets/robotic-welding-technician-graph.js:421
[tour]: /Users/tim.c/gradient-cli/robotic-welding-technician/v1/assets/robotic-welding-technician-graph.js:658
[layout]: /Users/tim.c/gradient-cli/robotic-welding-technician/v1/assets/robotic-welding-technician-graph.js:935
[create]: /Users/tim.c/gradient-cli/robotic-welding-technician/v1/assets/robotic-welding-technician-graph.js:976
[insert]: /Users/tim.c/gradient-cli/robotic-welding-technician/v1/assets/robotic-welding-technician-graph.js:1012
[crud]: /Users/tim.c/gradient-cli/robotic-welding-technician/v1/assets/robotic-welding-technician-graph.js:1056
[trace]: /Users/tim.c/gradient-cli/robotic-welding-technician/v1/assets/robotic-welding-technician-graph.js:1120
[keys]: /Users/tim.c/gradient-cli/robotic-welding-technician/v1/assets/robotic-welding-technician-graph.js:1141
[projection]: /Users/tim.c/gradient-cli/robotic-welding-technician/v1/assets/robotic-welding-technician-graph.js:1181
[nested-preview]: /Users/tim.c/gradient-cli/robotic-welding-technician/v1/assets/robotic-welding-technician-graph.js:1530
[gizmo]: /Users/tim.c/gradient-cli/robotic-welding-technician/v1/assets/robotic-welding-technician-graph.js:1708
[text]: /Users/tim.c/gradient-cli/robotic-welding-technician/v1/assets/robotic-welding-technician-graph.js:1941
[render]: /Users/tim.c/gradient-cli/robotic-welding-technician/v1/assets/robotic-welding-technician-graph.js:1980
[gpu]: /Users/tim.c/gradient-cli/robotic-welding-technician/v1/assets/robotic-welding-technician-graph.js:2093
[fallback]: /Users/tim.c/gradient-cli/robotic-welding-technician/v1/assets/robotic-welding-technician-graph.js:2239
[tick]: /Users/tim.c/gradient-cli/robotic-welding-technician/v1/assets/robotic-welding-technician-graph.js:2255
[metrics]: /Users/tim.c/gradient-cli/robotic-welding-technician/v1/assets/robotic-welding-technician-graph.js:2378
[slide-bridge]: /Users/tim.c/gradient-cli/robotic-welding-technician/v1/assets/robotic-welding-technician-graph.js:2537
[cli-tests]: /Users/tim.c/gradient-cli/dag/v1/cli_test.go:1
