export type Model = 'assembly' | 'graph' | 'layers';
export type SlideDetail = {
  id: string;
  title: string;
  description: string;
  children?: readonly SlideDetail[];
};
export type Slide = {
  id: string;
  label: string;
  title: string;
  accent: string;
  description: string;
  facts: readonly (readonly [string, string, string])[];
  note: string;
  scene: string;
  model: Model;
  camera: readonly [number, number, number];
  target: readonly [number, number, number];
  action: { label: string; command: 'next' | 'add-node' | 'play' | 'guide' };
  children?: readonly SlideDetail[];
};

export const slides: readonly Slide[] = [
  {
    id: 'welcome', label: 'The starting point', title: 'One canvas.', accent: 'Five possibilities.',
    description: 'A starting point for stories in three dimensions. Explore five examples, then make the content, models, and motion your own.',
    facts: [['Example slides', '05', 'ready to adapt'], ['Visual foundation', '3D', 'one shared canvas']],
    note: 'Scroll once or press → to begin. Drag the scene to look around.',
    scene: 'Modular assembly', model: 'assembly', camera: [8, 6, 11], target: [0, 1.5, 0],
    action: { label: 'Explore the examples', command: 'next' },
    children: [
      { id: 'composition', title: 'The composition', description: 'A title, subtitle, supporting facts, and action sit beside one shared 3D canvas.' },
      { id: 'canvas', title: 'The shared canvas', description: 'Slide mode focuses on one scene. DAG mode arranges the same scenes on connected node interiors.' },
    ],
  },
  {
    id: 'navigate', label: 'Move through the story', title: 'Your direction.', accent: 'Your pace.',
    description: 'Scroll, swipe, or use the arrow keys to move one slide at a time. Jump with the progress rail, or share a link to this exact slide.',
    facts: [['Scroll behavior', '01', 'slide per gesture'], ['Keyboard shortcuts', '↑ ↓', 'previous / next']],
    note: 'Home and End jump to either end. Browser Back retraces your slides.',
    scene: 'Connected workflow', model: 'graph', camera: [8, 8, 12], target: [0, 0.8, 0],
    action: { label: 'Try the interactive scene', command: 'next' },
    children: [
      { id: 'sequence', title: 'Top to bottom', description: 'Slide mode follows the five-slide order. Scroll down to advance and up to return.' },
      { id: 'explore', title: 'Explore the DAG', description: 'Select any slide, zoom to its node interior, and enter its nested content. Return through the breadcrumb trail.' },
    ],
  },
  {
    id: 'interact', label: 'Work directly in 3D', title: 'A scene you', accent: 'can change.',
    description: 'Click a node to select it. Press C to add a connected node, Delete to remove your selection, or X to change its color. Drag to orbit the graph.',
    facts: [['Live graph', '05', 'nodes'], ['Selection', 'Node 1', 'ready to edit']],
    note: 'R resets the camera. Reset graph restores the five example nodes.',
    scene: 'Editable workflow', model: 'graph', camera: [6, 7.5, 11], target: [0, 0.8, 0],
    action: { label: 'Add a connected node', command: 'add-node' },
    children: [
      { id: 'select', title: 'Select a node', description: 'In the slide’s editable graph, click a real Three.js mesh to select it.' },
      { id: 'edit', title: 'Edit the graph', description: 'Enter this node interior to inspect the three editing operations.', children: [
        { id: 'create', title: 'Create', description: 'C adds a new node connected from the current selection. The graph lays out again automatically.' },
        { id: 'color', title: 'Change color', description: 'X changes the selected node’s material directly in the Three.js scene.' },
        { id: 'remove', title: 'Remove', description: 'Delete removes the selected node and its links. Reset graph restores the example.' },
      ] },
    ],
  },
  {
    id: 'playback', label: 'Let the story unfold', title: 'Set it in motion.', accent: 'Take over anytime.',
    description: 'Start a timed tour and watch the camera move between scenes. Any manual navigation pauses playback. Escape stops it immediately.',
    facts: [['Default interval', '10', 'seconds per slide'], ['Playback behavior', 'You', 'stay in control']],
    note: 'Space toggles playback. Motion follows your device’s accessibility settings.',
    scene: 'Layered node interiors', model: 'layers', camera: [8, 6, 12], target: [0, 1.6, 0],
    action: { label: 'Play the tour from the start', command: 'play' },
    children: [
      { id: 'timing', title: 'Set the timing', description: 'The tourDuration URL parameter sets the dwell time. The default is ten seconds per slide.' },
      { id: 'takeover', title: 'Take over', description: 'Manual navigation, opening the guide, or switching modes stops playback. Reduced motion removes camera animation.' },
    ],
  },
  {
    id: 'make-it-yours', label: 'Make it your own', title: 'Your content.', accent: 'A running start.',
    description: 'Open the guide to explore the controls and customization points. Update the slide data and keep the navigation, responsive layout, and 3D scene working together.',
    facts: [['Local development', 'Vite', 'instant updates'], ['Content structure', '01', 'slide configuration']],
    note: 'The guide opens over the scene. Close it or press Escape to return.',
    scene: 'A reusable foundation', model: 'assembly', camera: [10, 5, 11], target: [0, 1.5, 0],
    action: { label: 'Open the guide', command: 'guide' },
    children: [
      { id: 'content', title: 'Change the content', description: 'Edit slides and their recursive children in src/slides.ts. Both views use the same source.' },
      { id: 'models', title: 'Change the models', description: 'Replace the shared models in src/scene.ts. Their previews appear on the slide DAG node interiors.' },
    ],
  },
];
