import { slides, type Model, type SlideDetail } from './slides.ts';

export type SlideDagNode = {
  id: string; title: string; description: string; slideId: string; model: Model;
  parentId: string | null; children: SlideDagNode[]; links: SlideDagEdge[];
  runtime?: boolean; color: number; demoIndex?: number;
};
export type SlideDagEdge = { from: string; to: string };
export type SlideDagLayer = { owner: SlideDagNode; nodes: SlideDagNode[]; edges: SlideDagEdge[]; path: string[]; ancestors: SlideDagNode[] };
export const LOD_NAMES = ['graph-point', 'title-only', 'full-content'] as const;

function details(items: readonly SlideDetail[], parent: string, slideId: string, model: Model): SlideDagNode[] {
  return items.map(item => {
    const id = `${parent}/${item.id}`;
    const children = details(item.children ?? [], id, slideId, model);
    return { ...item, id, parentId: parent, slideId, model, color: 0, children, links: sequentialLinks(children) };
  });
}
function sequentialLinks(nodes: SlideDagNode[]) { return nodes.slice(1).map((node, i) => ({ from: nodes[i].id, to: node.id })); }
export const slideDagNodes: SlideDagNode[] = slides.map(slide => ({
  id: slide.id, title: `${slide.title} ${slide.accent}`, description: slide.description,
  parentId: 'root', slideId: slide.id, model: slide.model, color: 0,
  children: details(slide.children ?? [], slide.id, slide.id, slide.model),
  links: sequentialLinks(details(slide.children ?? [], slide.id, slide.id, slide.model)),
}));

// Presentation order remains the slide array; these edges describe the overview DAG.
export const slideDagEdges: SlideDagEdge[] = [
  { from: 'welcome', to: 'navigate' },
  { from: 'navigate', to: 'interact' }, { from: 'navigate', to: 'playback' },
  { from: 'interact', to: 'make-it-yours' }, { from: 'playback', to: 'make-it-yours' },
];

export function createRootNode(): SlideDagNode {
  return { id: 'root', parentId: null, title: 'Root', description: 'The single parent of this presentation. Open any child to explore its own DAG.', slideId: 'welcome', model: 'graph', color: 0, children: structuredClone(slideDagNodes), links: structuredClone(slideDagEdges) };
}

export function resolveLayer(path: readonly string[], root = createRootNode()): SlideDagLayer {
  let owner = root;
  const ancestors: SlideDagNode[] = [];
  for (const id of path) {
    const node = owner.children.find(node => node.id === id);
    if (!node) break;
    ancestors.push(node);
    owner = node;
  }
  return { owner, nodes: owner.children, edges: owner.links, path: ancestors.map(node => node.id), ancestors };
}

/** A stable topological rank and lane layout, with no overlap between sibling nodes. */
export function layoutWorkplane(nodes: readonly { id: string }[], edges: readonly SlideDagEdge[]) {
  const ranks = new Map<string, number>();
  const ids = new Set(nodes.map(node => node.id));
  if (ids.size !== nodes.length) throw new Error('Duplicate slide ID');
  if (edges.some(edge => !ids.has(edge.from) || !ids.has(edge.to))) throw new Error('Unknown slide link');
  let remaining = [...nodes];
  while (remaining.length) {
    const ready = remaining.filter(node => edges.filter(edge => edge.to === node.id).every(edge => ranks.has(edge.from)));
    if (!ready.length) throw new Error('A slide DAG cannot contain cycles');
    for (const node of ready) ranks.set(node.id, Math.max(0, ...edges.filter(edge => edge.to === node.id).map(edge => ranks.get(edge.from)! + 1)));
    remaining = remaining.filter(node => !ranks.has(node.id));
  }
  const maxRank = Math.max(0, ...ranks.values());
  return nodes.map(node => {
    const rank = ranks.get(node.id)!;
    const peers = nodes.filter(peer => ranks.get(peer.id) === rank);
    const lane = peers.findIndex(peer => peer.id === node.id) - (peers.length - 1) / 2;
    return { id: node.id, rank, lane, x: (rank - maxRank / 2) * 8.5, z: lane * 7 };
  });
}

export function lodForDistance(distance: number): 0 | 1 | 2 {
  return distance > 65 ? 0 : distance > 27 ? 1 : 2;
}

export class SlideDagState {
  rootNode = createRootNode();
  private nextId = 1;
  path: string[] = [];
  selected: string = slides[0].id;
  traced = false;
  get nodes() { return this.rootNode.children; }
  layerAt(path: readonly string[]) { return resolveLayer(path, this.rootNode); }
  get layer() { return this.layerAt(this.path); }
  get workplaneId() { return this.path.at(-1) ?? 'root'; }
  get owningSlideId() { return this.node?.slideId ?? this.layer.ancestors.at(-1)?.slideId ?? slides[0].id; }
  get node() { return this.layer.nodes.find(node => node.id === this.selected) ?? this.layer.nodes[0]; }
  select(id: string) { if (this.layer.nodes.some(node => node.id === id)) this.selected = id; }
  enter(): boolean {
    if (!this.node) return false;
    this.path.push(this.node.id);
    this.selected = this.layer.nodes[0]?.id ?? '';
    return true;
  }
  back(): boolean {
    const parent = this.path.pop();
    if (!parent) return false;
    this.selected = parent;
    return true;
  }
  root(id = this.owningSlideId) { this.path = []; this.selected = id; }
  move(direction: -1 | 1) {
    const nodes = this.layer.nodes;
    if (!nodes.length) return;
    const current = nodes.findIndex(node => node.id === this.selected);
    this.selected = nodes[Math.max(0, Math.min(nodes.length - 1, current + direction))].id;
  }
  navigate(direction: 'upstream' | 'downstream' | 'lane-next' | 'lane-previous' | 'predecessor') {
    const { nodes, edges } = this.layer;
    const layout = layoutWorkplane(nodes, edges);
    const current = layout.find(node => node.id === this.selected)!;
    if (!current) return;
    if (direction === 'predecessor') {
      const edge = edges.find(edge => edge.to === this.selected);
      if (edge) this.selected = edge.from;
      return;
    }
    const lane = direction.startsWith('lane');
    const sign = direction === 'upstream' || direction === 'lane-previous' ? -1 : 1;
    const candidates = layout.filter(node => lane ? node.rank === current.rank && (node.lane - current.lane) * sign > 0 : node.rank === current.rank + sign);
    candidates.sort((a, b) => Math.abs(a.lane - current.lane) - Math.abs(b.lane - current.lane));
    if (candidates[0]) this.selected = candidates[0].id;
  }
  traceIds() {
    const result = new Set(this.selected ? [this.selected] : []);
    for (const edge of this.layer.edges) {
      if (edge.from === this.selected) result.add(edge.to);
      if (edge.to === this.selected) result.add(edge.from);
    }
    return [...result];
  }
  create() {
    const node = this.createChild(this.layer.owner, this.node?.id);
    this.selected = node.id;
    return node;
  }
  createChild(parent: SlideDagNode, from?: string) {
    const ordinal = this.nextId++;
    const node: SlideDagNode = { id: `node-${ordinal}`, parentId: parent.id, title: `New node ${ordinal}`, description: 'N opens this node. Its children form their own flat DAG. C adds a node to the currently open parent.', slideId: parent.slideId, model: 'graph', children: [], links: [], color: 0, runtime: true };
    if (parent.id === 'interact/select') node.demoIndex = Math.max(0, ...parent.children.map(item => item.demoIndex ?? 0)) + 1;
    if (from && parent.children.some(item => item.id === from)) parent.links.push({ from, to: node.id });
    parent.children.push(node);
    return node;
  }
  remove() {
    const node = this.node;
    if (!node?.runtime) return false; // The five examples and their authored content stay available.
    const layer = this.layer;
    const index = layer.nodes.indexOf(node);
    const edges = layer.edges.filter(edge => edge.from !== node.id && edge.to !== node.id);
    layer.nodes.splice(index, 1);
    layer.owner.links = edges;
    this.selected = layer.nodes[Math.min(index, layer.nodes.length - 1)]?.id ?? '';
    return true;
  }
  find(id: string) {
    const stack = [this.rootNode];
    while (stack.length) { const node = stack.pop()!; if (node.id === id) return node; stack.push(...node.children); }
    return undefined;
  }
  snapshot() {
    const root = { ...this.rootNode, children: [], links: this.rootNode.links.map(edge => ({ ...edge })) } as SlideDagNode;
    const queue = [{ source: this.rootNode, target: root }];
    while (queue.length) {
      const { source, target } = queue.pop()!;
      for (const child of source.children) {
        const clone = { ...child, children: [], links: child.links.map(edge => ({ ...edge })) } as SlideDagNode;
        target.children.push(clone); queue.push({ source: child, target: clone });
      }
    }
    return { rootNode: root, nextId: this.nextId, path: [...this.path], selected: this.selected, traced: this.traced };
  }
  restore(snapshot: ReturnType<SlideDagState['snapshot']>) {
    this.rootNode = snapshot.rootNode; this.nextId = snapshot.nextId;
    this.path = [...snapshot.path]; this.selected = snapshot.selected; this.traced = snapshot.traced;
  }
}
