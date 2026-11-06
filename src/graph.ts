import { SlideDagState, type SlideDagNode } from './slide-dag.ts';

export type DemoNode = { id: number; color: number };
export type DemoEdge = { from: number; to: number };
export const nodeColors = [0x408fff, 0x42c8b0, 0xeeae5b];

/** Numeric selection adapter for the example renderer, not a second graph model. */
export class DemoGraph {
  private selection: number | null = 1;
  readonly limit = 12;
  state: SlideDagState;
  constructor(state = new SlideDagState()) { this.state = state; if (!this.owner.children.length) this.reset(); }
  get owner() { return this.state.find('interact/select')!; }
  get selected(): number | null {
    return this.owner.children.some(node => node.demoIndex === this.selection) ? this.selection : this.owner.children.at(-1)?.demoIndex ?? null;
  }
  set selected(id: number | null) { this.selection = id; }
  get nodes(): DemoNode[] { return this.owner.children.map(node => ({ id: node.demoIndex!, color: node.color })); }
  get edges(): DemoEdge[] {
    return this.owner.links.map(edge => ({ from: this.owner.children.find(node => node.id === edge.from)!.demoIndex!, to: this.owner.children.find(node => node.id === edge.to)!.demoIndex! }));
  }
  reset() {
    const owner = this.owner;
    owner.title = 'Editable graph';
    owner.description = 'The same editable nodes shown on the Interact slide. Open any one to explore its children.';
    owner.children = Array.from({ length: 5 }, (_, i): SlideDagNode => ({ id: 'demo-' + (i + 1), parentId: owner.id, demoIndex: i + 1, title: 'Node ' + (i + 1), description: 'N opens this node, C creates inside the current parent, and X recolors the selection.', slideId: 'interact', model: 'graph', color: 0, runtime: true, children: [], links: [] }));
    owner.links = [[1, 2], [1, 3], [2, 4], [3, 4], [4, 5]].map(([from, to]) => ({ from: 'demo-' + from, to: 'demo-' + to }));
    this.selected = 1;
  }
  select(id: number) { if (this.nodes.some(node => node.id === id)) this.selected = id; }
  add() {
    if (this.nodes.length >= this.limit) return false;
    const from = this.owner.children.find(node => node.demoIndex === this.selected)?.id;
    const node = this.state.createChild(this.owner, from);
    this.selected = node.demoIndex!;
    return true;
  }
  remove() {
    const node = this.owner.children.find(node => node.demoIndex === this.selected);
    if (!node) return false;
    this.owner.children = this.owner.children.filter(child => child !== node);
    this.owner.links = this.owner.links.filter(edge => edge.from !== node.id && edge.to !== node.id);
    this.selected = this.nodes.at(-1)?.id ?? null;
    return true;
  }
  recolor() {
    const node = this.owner.children.find(node => node.demoIndex === this.selected);
    if (node) node.color = (node.color + 1) % nodeColors.length;
  }
  move(direction: -1 | 1) {
    const index = this.nodes.findIndex(node => node.id === this.selected);
    this.selected = this.nodes[Math.max(0, Math.min(this.nodes.length - 1, index + direction))]?.id ?? null;
  }
}
