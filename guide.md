# One node. Recursive interiors.

The presentation and DAG share one recursive **Node** model. There is one **Root**, whose parent is null. Every other node has one parent, children, and dependency links between those children. A slide is a presentation; a workplane is only an interior view—not another object.

## Open any node

DAG mode starts inside Root, showing the five example nodes. Select a node and press **N** or double-click it: its direct children appear as a DAG on a flat plane. Select a child and do the same again. **T** returns to the parent; **F** returns inside Root. Breadcrumbs navigate the containment path.

Empty nodes open normally. Press **C** to create their first child. The new child can itself be opened and populated. There is no configured nesting-depth limit; browser memory is the practical bound. The model tests exercise 512 successive opens.

**Containment is not dependency.** Children live inside a parent. Links connect siblings in the same parent and cannot create cycles. H/L move across dependency ranks, J/K across lanes, and U/P follows an incoming link. None of these actions changes containment.

## The three detail levels

Zoom changes how a node is drawn: **Point → Summary → Full content**. Only one representation per node is visible. Full content shows its description and the same live 3D scene as Slide mode, including animation and graph edits. That scene is the node’s content, not its children. **Enter focuses; N opens its child DAG.** Zoom alone does not switch parents.

All children in an open node lie on one local plane. Ancestors do not remain stacked above them. Drag or O/Shift+O orbits; arrows pan in DAG mode. R frames the currently open node; F returns to Root.

## Create, open, and edit

The meanings stay consistent in both views: **C creates, N opens, X recolors, Delete removes, T returns**.

C creates inside the open parent and connects from the selected sibling. To create inside the selection, press **N, then C**. Delete removes a created node, all descendants, and incident links. Authored examples are protected. Edits are local and reset on reload.

On the Interact slide, the editable nodes are the very same children found at **Root → Interact → Editable graph**. Select by clicking their actual meshes or with [ / ]. C adds, X recolors, and Shift+R restores the five-node example. N opens the selected node in DAG mode. The compact slide example supports twelve visible nodes; nested DAG creation has no configured node-count limit.

## Slide navigation

Slide mode moves through five root examples, top to bottom. Scroll or swipe once per slide; Up/Down, Left/Right, and PageUp/PageDown are keyboard alternatives. Home/End jump to the ends, and the progress rail jumps directly. Browser Back/Forward retraces navigation. Enter invokes the slide’s visible action button.

G or / switches views. Present or V returns from nested DAG content to its owning root example. DAG scrolling zooms; it never advances the slideshow. On short screens, content can scroll normally; use the slide buttons or hotkeys.

## Story playback and Controls walkthrough

**Play story / Space** traverses slides automatically. Manual input, Escape, opening the guide, switching views, or hiding the page stops playback. Starting at the final slide restarts from the first.

**Tour / W** teaches the controls using a shared sequence of real input-handler actions and state assertions. It covers both views, editing, navigation, help, tracing, the three detail levels, empty interiors, recursive children, deletion, and parent/root recovery. Its title and instruction identify each demonstrated action.

Any real pointer, wheel, touch, or keyboard input takes over and cancels pending walkthrough actions. Escape stops without also moving to a parent. The walkthrough restores pre-existing graph edits on completion or cancellation. Stop / close dismisses its instruction panel.

Set `?tourDuration=2000` for a two-second story interval (default ten seconds). Set `?walkthroughSpeed=4` for a four-times-faster controls walkthrough. The bounds are 800–60000 ms and 0.25–20 respectively. Faster playback never skips assertions.

## Accessibility and verification

Text fields and focused buttons retain native editing and Enter/Space behavior. ? opens this guide; Escape closes it. In the app, the guide includes a hotkey catalog generated from the executable bindings; the README also lists the controls.

Reduced motion disables camera transitions and ambient animation. Touch users can use visible open, parent, create, delete, zoom, and mode buttons. Without WebGL, the recursive graph and controls tour are disabled; slides and guide remain available.

Run `npm run check` to type-check, build, and run the model and browser tests. Headless tests save screenshots in temporary folders and log their locations. `npm run test:walkthrough` replays the shared steps, runs the live tour, verifies manual takeover, and exercises deep recursive opening. Set CHROME_PATH for a nonstandard Chrome installation.

## Customize

Edit src/slides.ts for the five initial examples and nested content; src/slide-dag.ts defines their node hierarchy and links. src/hotkeys.ts owns action bindings and src/walkthrough-steps.ts owns the shared demonstration contract. Change models in src/scene.ts and styles in src/style.css.

The README contains the complete domain vocabulary. This guide is also published as /guide.md. Cloudflare hosting is optional; configure a unique Worker name and authenticate outside Git before running npm run deploy. A Git push alone does not publish the site.
