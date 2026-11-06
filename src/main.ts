import './style.css';
import { marked } from 'marked';
import guide from '../docs/guide.md?raw';
import { slides } from './slides';
import { clampSlide, indexFromHash, tourDuration, WheelGate } from './navigation';
import { DemoGraph } from './graph';
import { createScene } from './scene';
import { SlideDagState } from './slide-dag';
import { hotkeyMarkdown, resolveHotkey, type Action } from './hotkeys';
import { createWalkthrough } from './walkthrough';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const dialog = element<HTMLDialogElement>('guide-dialog');
const dagState = new SlideDagState();
const graph = new DemoGraph(dagState);
let mode: 'slides' | 'dag' = 'slides';
const gate = new WheelGate();
const duration = tourDuration(new URLSearchParams(location.search).get('tourDuration'));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let index = indexFromHash(location.hash, slides);
let timer: ReturnType<typeof setInterval> | undefined;
let scene: ReturnType<typeof createScene> | undefined;
let focusBeforeDialog: HTMLElement | null = null;
element('guide-content').innerHTML = marked.parse(`${guide}\n\n${hotkeyMarkdown()}`, { async: false }); // Repository-owned Markdown only.

const progress = element('slide-progress');
slides.forEach((slide, i) => {
  const button = document.createElement('button');
  button.setAttribute('aria-label', `Slide ${i + 1}: ${slide.label}`);
  button.title = slide.label;
  button.addEventListener('click', () => go(i));
  progress.append(button);
});

function stopTour() {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
  element('play').setAttribute('aria-pressed', 'false');
  element('play').setAttribute('aria-label', 'Play automatic tour');
  element('play-icon').textContent = '▷';
  element('play-label').textContent = 'Play story';
  document.body.dataset.playing = 'false';
}

function updateFacts() {
  const facts = slides[index].id === 'interact' ? [
    ['Live graph', String(graph.nodes.length).padStart(2, '0'), 'nodes'],
    ['Selection', graph.selected === null ? 'None' : `Node ${graph.selected}`, `${graph.edges.length} links`],
  ] : slides[index].facts;
  element('slide-facts').replaceChildren(...facts.map(([label, value, suffix]) => {
    const group = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    const small = document.createElement('span');
    small.textContent = suffix;
    dd.append(value, small);
    group.append(dt, dd);
    return group;
  }));
}

function go(next: number, source: 'manual' | 'auto' | 'history' | 'initial' = 'manual') {
  if (source !== 'auto') stopTour();
  const previous = index;
  index = clampSlide(next, slides.length);
  const slide = slides[index];
  const accent = document.createElement('span');
  accent.textContent = slide.accent;
  element('slide-title').replaceChildren(document.createTextNode(slide.title), document.createElement('br'), accent);
  element('slide-label').textContent = `${String(index + 1).padStart(2, '0')} — ${slide.label}`;
  element('slide-description').textContent = slide.description;
  element('slide-note').textContent = slide.note;
  element('slide-action').textContent = `${slide.action.label} ↗`;
  element('reset-graph').hidden = slide.id !== 'interact';
  element('slide-count').textContent = `${String(index + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`;
  element<HTMLButtonElement>('previous').disabled = index === 0;
  element<HTMLButtonElement>('next').disabled = index === slides.length - 1;
  Array.from(progress.children).forEach((button, i) => {
    if (i === index) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
  });
  const sub = document.createElement('span');
  sub.textContent = `EXAMPLE / ${String(index + 1).padStart(2, '0')}`;
  element('scene-caption').replaceChildren(document.createTextNode(slide.scene.toUpperCase()), sub);
  document.body.dataset.slide = slide.id;
  document.title = `${slide.label} — Slide Template`;
  const url = new URL(location.href);
  url.hash = slide.id;
  url.searchParams.delete('mode');
  url.searchParams.delete('layer');
  if (source === 'manual' && previous !== index) history.pushState(null, '', url);
  else if (location.href !== url.href) history.replaceState(null, '', url);
  updateFacts();
  scene?.setSlide(slide);
  if (previous !== index && !reducedMotion.matches) document.querySelector('.slide-copy')?.animate([
    { opacity: 0, transform: `translateY(${index > previous ? 18 : -18}px)` },
    { opacity: 1, transform: 'translateY(0)' },
  ], { duration: 220, easing: 'ease-out' });
}

function updateMode() {
  document.body.dataset.mode = mode;
  element('mode-toggle').setAttribute('aria-pressed', String(mode === 'dag'));
  element('mode-toggle').textContent = mode === 'dag' ? 'Slide mode' : 'DAG mode';
  element('dag-header').hidden = mode !== 'dag';
  element('dag-controls').hidden = mode !== 'dag';
}

function writeDagLocation(replace = false) {
  const url = new URL(location.href);
  url.searchParams.set('mode', 'dag');
  if (dagState.path.length) url.searchParams.set('layer', dagState.path.join('|'));
  else url.searchParams.delete('layer');
  url.hash = dagState.selected;
  if (url.href !== location.href) history[replace ? 'replaceState' : 'pushState'](null, '', url);
}

function renderDag() {
  const layer = dagState.layer;
  const selected = dagState.node;
  element('dag-title').textContent = `Inside ${layer.owner.title}`;
  element('dag-depth').textContent = `Depth ${layer.path.length} · ${layer.nodes.length} child nodes`;
  element('dag-selection').textContent = selected ? `${selected.title} — ${selected.children.length} children. N opens this node.` : 'This node is empty. C creates its first child. T returns to its parent.';
  element<HTMLButtonElement>('dag-enter').disabled = !selected;
  element<HTMLButtonElement>('dag-remove').disabled = !selected?.runtime;
  element<HTMLButtonElement>('dag-trace').disabled = !selected;
  element('dag-trace').setAttribute('aria-pressed', String(dagState.traced));
  element<HTMLButtonElement>('dag-parent').disabled = !layer.path.length;
  const breadcrumb = element('dag-breadcrumb');
  breadcrumb.replaceChildren(...['Root', ...layer.ancestors.map(node => node.title)].map((label, depth) => {
    const button = document.createElement('button');
    button.textContent = depth ? `› ${label}` : label;
    button.addEventListener('click', () => {
      const through = dagState.selected;
      const nextSelected = dagState.path[depth];
      dagState.path = dagState.path.slice(0, depth);
      dagState.selected = nextSelected ?? dagState.layer.nodes[0]?.id ?? '';
      scene?.refreshDag(through); renderDag(); writeDagLocation();
    });
    return button;
  }));
  breadcrumb.scrollLeft = breadcrumb.scrollWidth;
  element('dag-node-list').replaceChildren(...layer.nodes.map(node => {
    const button = document.createElement('button');
    button.textContent = node.title;
    button.setAttribute('aria-pressed', String(node.id === dagState.selected));
    button.addEventListener('click', () => selectDag(node.id));
    return button;
  }));
  document.title = `${selected?.title ?? layer.owner.title} — Node DAG`;
}

function selectDag(id: string, enter = false) {
  stopTour();
  dagState.select(id);
  renderDag();
  if (enter) enterDag();
  else { scene?.dagFocus(); writeDagLocation(); }
}
function enterDag() {
  const through = dagState.selected;
  if (!dagState.enter()) return;
  scene?.refreshDag(through);
  renderDag(); writeDagLocation();
}
function parentDag() {
  const through = dagState.selected;
  if (!dagState.back()) { scene?.dagOverview(); return; }
  scene?.refreshDag(through);
  renderDag(); writeDagLocation();
}
function rootDag() {
  dagState.root(); scene?.refreshDag(); renderDag(); writeDagLocation();
}
function setMode(next: 'slides' | 'dag') {
  if (next === 'dag' && !scene) return;
  stopTour();
  const nextIndex = slides.findIndex(slide => slide.id === dagState.owningSlideId);
  mode = next;
  updateMode();
  if (mode === 'dag') {
    dagState.root(slides[index].id);
    scene?.setMode('dag'); renderDag(); writeDagLocation();
  } else {
    scene?.setMode('slides');
    const url = new URL(location.href);
    url.searchParams.delete('mode'); url.searchParams.delete('layer'); url.hash = slides[nextIndex < 0 ? index : nextIndex].id;
    history.pushState(null, '', url);
    go(nextIndex < 0 ? index : nextIndex, 'history');
  }
}
function restoreLocation() {
  const url = new URL(location.href);
  stopTour();
  mode = url.searchParams.get('mode') === 'dag' && scene ? 'dag' : 'slides';
  updateMode();
  if (mode === 'dag') {
    dagState.path = dagState.layerAt((url.searchParams.get('layer') ?? '').split('|').filter(Boolean)).path;
    dagState.selected = dagState.layer.nodes[0]?.id ?? '';
    dagState.select(url.hash.slice(1));
    scene?.setMode('dag'); renderDag(); writeDagLocation(true);
  } else {
    scene?.setMode('slides'); go(indexFromHash(url.hash, slides), 'history');
  }
}

function toggleTour() {
  if (timer !== undefined) return stopTour();
  if (index === slides.length - 1) go(0);
  element('play').setAttribute('aria-pressed', 'true');
  element('play').setAttribute('aria-label', 'Pause automatic tour');
  element('play-icon').textContent = 'Ⅱ';
  element('play-label').textContent = 'Pause tour';
  document.body.dataset.playing = 'true';
  timer = setInterval(() => {
    if (index < slides.length - 1) go(index + 1, 'auto');
    if (index === slides.length - 1) stopTour();
  }, duration);
}

function openGuide() {
  stopTour();
  focusBeforeDialog = document.activeElement as HTMLElement;
  dialog.showModal();
  element('close-guide').focus();
}
dialog.addEventListener('close', () => focusBeforeDialog?.focus());
dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});

function editGraph(command: 'add' | 'remove' | 'color' | 'reset') {
  stopTour();
  let message = '';
  if (command === 'add') message = graph.add() ? `Added node ${graph.selected}.` : 'The demo supports up to twelve nodes. Remove a node to add another.';
  if (command === 'remove') message = graph.remove() ? 'Removed the selected node and its links.' : 'Select a node first.';
  if (command === 'color') { graph.recolor(); message = graph.selected === null ? 'Select a node first.' : `Changed the color of node ${graph.selected}.`; }
  if (command === 'reset') { graph.reset(); message = 'Restored the five example nodes.'; }
  scene?.syncGraph();
  updateFacts();
  element('interaction-status').textContent = message;
  element('slide-note').textContent = message;
}

element('slide-action').addEventListener('click', () => {
  switch (slides[index].action.command) {
    case 'next': go(index + 1); break;
    case 'add-node': editGraph('add'); break;
    case 'play': go(0); toggleTour(); break;
    case 'guide': openGuide(); break;
  }
});
element('reset-graph').addEventListener('click', () => editGraph('reset'));
element('previous').addEventListener('click', () => go(index - 1));
element('next').addEventListener('click', () => go(index + 1));
element('play').addEventListener('click', toggleTour);
element('open-guide').addEventListener('click', openGuide);
element('close-guide').addEventListener('click', () => dialog.close());
element('home').addEventListener('click', event => { event.preventDefault(); if (mode === 'dag') rootDag(); else go(0); });
document.querySelector('.skip-link')!.addEventListener('click', event => { event.preventDefault(); element('slide-title').focus(); });
window.addEventListener('popstate', restoreLocation);
window.addEventListener('hashchange', restoreLocation);
element('mode-toggle').addEventListener('click', () => setMode(mode === 'slides' ? 'dag' : 'slides'));
element('dag-enter').addEventListener('click', enterDag);
element('dag-parent').addEventListener('click', parentDag);
element('dag-overview').addEventListener('click', rootDag);
element('dag-present').addEventListener('click', () => setMode('slides'));
element('dag-create').addEventListener('click', () => executeAction('node-create'));
element('dag-remove').addEventListener('click', () => executeAction('node-remove'));
element('dag-trace').addEventListener('click', () => executeAction('dag-trace'));
element('dag-zoom-in').addEventListener('click', () => scene?.dagZoom(-300));
element('dag-zoom-out').addEventListener('click', () => scene?.dagZoom(300));
element('dag-lod').addEventListener('change', event => {
  const value = (event.target as HTMLSelectElement).value;
  if (value === 'auto') scene?.dagOverview(); else scene?.dagLod(Number(value));
});

window.addEventListener('wheel', event => {
  if (dialog.open || event.ctrlKey) return;
  if (event.target instanceof Element && event.target.closest('#dag-breadcrumb')) return;
  stopTour();
  if (mode === 'dag') {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
    if (event.shiftKey) scene?.dagPan(event.deltaX / 100, event.deltaY / 100);
    else scene?.dagZoom(Math.max(-200, Math.min(200, event.deltaY * unit)));
    return;
  }
  if (innerHeight <= 550) return;
  event.preventDefault();
  if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
  const direction = gate.consume(event.deltaY * unit, performance.now());
  if (direction) go(index + direction);
}, { passive: false });

let walkthroughSnapshot: ReturnType<SlideDagState['snapshot']> | undefined;
let walkthroughSelection: number | null = null;
const walkthrough = createWalkthrough(() => {
  stopTour(); dialog.close();
  walkthroughSnapshot = dagState.snapshot(); walkthroughSelection = graph.selected;
  dagState.rootNode = new SlideDagState().rootNode; dagState.root(); dagState.traced = false; graph.reset();
  if (mode === 'dag') setMode('slides');
  go(0); scene?.syncGraph();
}, () => {
  stopTour(); dialog.close();
  if (walkthroughSnapshot) {
    const path = [...dagState.path]; const selection = dagState.selected;
    dagState.restore(walkthroughSnapshot); graph.selected = walkthroughSelection; walkthroughSnapshot = undefined;
    if (mode === 'dag') {
      dagState.path = dagState.layerAt(path).path;
      dagState.selected = dagState.layer.nodes.some(node => node.id === selection) ? selection : dagState.layer.nodes[0]?.id ?? '';
    }
  }
  scene?.syncGraph(); updateFacts();
  if (mode === 'dag') { scene?.refreshDag(); renderDag(); writeDagLocation(true); }
});
element('start-walkthrough').addEventListener('click', () => { if (scene) void walkthrough.start(); });
element('stop-walkthrough').addEventListener('click', () => { walkthrough.stop(); element('walkthrough').hidden = true; });

function executeAction(action: Action) {
  if (action !== 'playback') stopTour();
  switch (action) {
    case 'mode': setMode(mode === 'dag' ? 'slides' : 'dag'); break;
    case 'guide': openGuide(); break;
    case 'walkthrough': if (scene) void walkthrough.start(); break;
    case 'cancel': if (dialog.open) dialog.close(); else if (mode === 'dag') parentDag(); break;
    case 'previous': go(index - 1); break;
    case 'next': go(index + 1); break;
    case 'first': go(0); break;
    case 'last': go(slides.length - 1); break;
    case 'slide-action': element('slide-action').click(); break;
    case 'playback': toggleTour(); break;
    case 'camera-reset': if (mode === 'dag') scene?.dagOverview(); else scene?.resetCamera(); break;
    case 'orbit-right': scene?.orbit(1); break;
    case 'orbit-left': scene?.orbit(-1); break;
    case 'demo-previous': case 'demo-next':
      graph.move(action === 'demo-previous' ? -1 : 1); scene?.syncGraph(); updateFacts(); break;
    case 'demo-reset': editGraph('reset'); break;
    case 'node-open':
      if (mode === 'slides') {
        const demo = slides[index].id === 'interact' ? graph.owner.children.find(node => node.demoIndex === graph.selected) : undefined;
        setMode('dag');
        if (demo) { dagState.path = ['interact', 'interact/select']; dagState.selected = demo.id; scene?.refreshDag(); }
      }
      enterDag(); break;
    case 'node-parent':
      if (mode === 'slides') {
        const editable = slides[index].id === 'interact'; setMode('dag');
        if (editable) { dagState.path = ['interact']; dagState.selected = 'interact/select'; scene?.refreshDag(); renderDag(); writeDagLocation(); }
      } else parentDag(); break;
    case 'node-create':
      if (mode === 'slides' && slides[index].id === 'interact') editGraph('add');
      else { if (mode === 'slides') setMode('dag'); dagState.create(); scene?.syncGraph(); scene?.refreshDag(); renderDag(); writeDagLocation(); }
      break;
    case 'node-color':
      if (mode === 'slides' && slides[index].id === 'interact') editGraph('color');
      else { if (mode === 'slides') setMode('dag'); if (dagState.node) dagState.node.color = (dagState.node.color + 1) % 3; scene?.syncGraph(); renderDag(); }
      break;
    case 'node-remove':
      if (mode === 'slides' && slides[index].id === 'interact') editGraph('remove');
      else if (mode === 'dag') {
        const removed = dagState.remove(); scene?.syncGraph(); scene?.refreshDag(); renderDag(); writeDagLocation();
        if (!removed) element('dag-selection').textContent = 'The authored examples are protected. C creates a removable node.';
      }
      break;
    case 'dag-previous': case 'dag-next':
      dagState.move(action === 'dag-previous' ? -1 : 1); selectDag(dagState.selected); break;
    case 'dag-upstream': case 'dag-downstream': case 'dag-lane-next': case 'dag-lane-previous': case 'dag-predecessor':
      dagState.navigate(action.slice(4) as 'upstream' | 'downstream' | 'lane-next' | 'lane-previous' | 'predecessor');
      selectDag(dagState.selected); break;
    case 'dag-trace': dagState.traced = !dagState.traced; renderDag(); break;
    case 'dag-focus': scene?.dagFocus(); break;
    case 'dag-root': rootDag(); break;
    case 'dag-present': setMode('slides'); break;
    case 'pan-left': scene?.dagPan(-1, 0); break;
    case 'pan-right': scene?.dagPan(1, 0); break;
    case 'pan-up': scene?.dagPan(0, -1); break;
    case 'pan-down': scene?.dagPan(0, 1); break;
    case 'zoom-in': scene?.dagZoom(-300); break;
    case 'zoom-out': scene?.dagZoom(300); break;
    case 'detail-more': case 'detail-less': {
      const lod = ['graph-point', 'title-only', 'full-content'].indexOf(element('scene').dataset.dagLod ?? 'title-only');
      scene?.dagLod(lod + (action === 'detail-more' ? 1 : -1)); break;
    }
  }
}

window.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
  const target = event.target instanceof Element ? event.target : null;
  if (dialog.open && event.key !== 'Escape') return;
  if (target?.closest('input, textarea, select, [contenteditable]')) return;
  if (!event.shiftKey && (event.key === 'Enter' || event.key === ' ') && target?.closest('button, a')) return;
  const action = resolveHotkey(event.key, event.shiftKey, mode, slides[index].id);
  if (action) { event.preventDefault(); executeAction(action); }
});

// Real user input owns the scene immediately; synthetic walkthrough inputs do not cancel themselves.
for (const type of ['pointerdown', 'wheel', 'touchstart', 'keydown'] as const) {
  window.addEventListener(type, event => {
    if (!event.isTrusted || !walkthrough.running) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('#walkthrough, #start-walkthrough')) return;
    if (event instanceof KeyboardEvent && event.key.toLowerCase() === 'w') return;
    walkthrough.stop();
    if (event instanceof KeyboardEvent && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); }
  }, { capture: true, passive: false });
}

let touch: { x: number; y: number } | undefined;
window.addEventListener('touchstart', event => {
  if (mode === 'dag' || dialog.open || event.touches.length !== 1) { touch = undefined; return; }
  stopTour();
  touch = { x: event.touches[0].clientX, y: event.touches[0].clientY };
}, { passive: true });
window.addEventListener('touchend', event => {
  const start = touch;
  touch = undefined;
  if (!start || dialog.open || innerHeight <= 550 || !event.changedTouches.length) return;
  const point = event.changedTouches[0];
  const dy = start.y - point.clientY;
  const dx = start.x - point.clientX;
  if (Math.abs(dy) > 55 && Math.abs(dy) > Math.abs(dx) * 1.3) go(index + Math.sign(dy));
}, { passive: true });
window.addEventListener('touchcancel', () => { touch = undefined; });
document.addEventListener('visibilitychange', () => { if (document.hidden) { stopTour(); walkthrough.stop(); } });
reducedMotion.addEventListener('change', () => { stopTour(); walkthrough.stop(); });

function initializeScene() {
  try {
    scene = createScene(element('scene'), graph, stopTour, id => {
      stopTour(); graph.select(id); scene?.syncGraph(); updateFacts();
      element('interaction-status').textContent = `Selected node ${id}.`;
    }, dagState, selectDag);
    scene.setSlide(slides[index]);
    element('scene-fallback').hidden = true;
  } catch {
    element('scene-fallback').hidden = false;
    element<HTMLButtonElement>('mode-toggle').disabled = true;
    element<HTMLButtonElement>('start-walkthrough').disabled = true;
    element('mode-toggle').title = 'DAG mode requires WebGL. Slides and guide remain available.';
  }
}
initializeScene();
restoreLocation();
window.addEventListener('pagehide', () => { walkthrough.stop(); stopTour(); scene?.dispose(); scene = undefined; });
window.addEventListener('pageshow', event => { if (event.persisted) { initializeScene(); restoreLocation(); } });
