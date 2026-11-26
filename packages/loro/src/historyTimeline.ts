import { type Change, LoroDoc, type PeerID, VersionVector } from "loro-crdt";

/** One step of a document's history: a single change by a single peer. */
export interface HistoryStop {
  peerId: PeerID;
  /** Counter of the change's first operation. */
  startCounter: number;
  /** One past the counter of the change's last operation. */
  endCounter: number;
  lamport: number;
  /** Unix seconds the writer recorded, or null when the change carries none. */
  timestamp: number | null;
}

/** One entry of a version: the last operation it includes for a peer. */
export interface HistoryVersionEntry {
  peerId: PeerID;
  counter: number;
}

export interface HistoryViewer {
  /**
   * The scratch document, showing the version last checked out. Read it; do
   * not edit it. It is detached from its own latest version.
   */
  readonly doc: LoroDoc;
  /** Every change in the document, in the order the timeline plays them. */
  readonly stops: ReadonlyArray<HistoryStop>;
  /**
   * Show the document as it was after `stops[0..index]`. `-1` shows the empty
   * document before the first change.
   */
  checkout(index: number): void;
  /** The version after `stops[0..index]`, as the operations that head it. */
  versionAt(index: number): HistoryVersionEntry[];
  /** Release the WASM document. The viewer is unusable afterwards. */
  free(): void;
}

/**
 * A document that only ever imports and reads. It has no stable peer and does
 * not record change times, so it must never author.
 */
export function createReadOnlyDocument(): LoroDoc {
  return new LoroDoc();
}

/** Orders peer ids, decimal strings of unequal length, numerically. */
export function comparePeerIds(left: PeerID, right: PeerID): number {
  if (left.length !== right.length) return left.length - right.length;
  return left < right ? -1 : Number(left > right);
}

interface TimelineNode {
  readonly stop: HistoryStop;
  /** Nodes that cannot play before this one. */
  readonly dependents: number[];
  unmetDependencies: number;
}

/** Which of two changes plays first when neither depends on the other. */
type StopOrder = (left: HistoryStop, right: HistoryStop) => boolean;

const lamportBefore: StopOrder = (left, right) => {
  if (left.lamport !== right.lamport) return left.lamport < right.lamport;
  const peerOrder = comparePeerIds(left.peerId, right.peerId);
  if (peerOrder !== 0) return peerOrder < 0;
  return left.startCounter < right.startCounter;
};

/** A change that carries no recorded time sorts as time 0. */
const recordedTimeBefore: StopOrder = (left, right) => {
  const leftTime = left.timestamp ?? 0;
  const rightTime = right.timestamp ?? 0;
  if (leftTime !== rightTime) return leftTime < rightTime;
  return lamportBefore(left, right);
};

/** A binary min-heap of node indexes ordered by a {@link StopOrder}. */
class ReadyQueue {
  private readonly heap: number[] = [];

  constructor(
    private readonly nodes: readonly TimelineNode[],
    private readonly playsBefore: StopOrder,
  ) {}

  get size(): number {
    return this.heap.length;
  }

  push(nodeIndex: number): void {
    const { heap } = this;
    let position = heap.length;
    heap.push(nodeIndex);
    while (position > 0) {
      const parent = (position - 1) >> 1;
      if (!this.before(heap[position], heap[parent])) break;
      this.swap(position, parent);
      position = parent;
    }
  }

  pop(): number | undefined {
    const { heap } = this;
    const first = heap[0];
    const last = heap.pop();
    if (first === undefined || last === undefined) return undefined;
    if (heap.length === 0) return first;
    heap[0] = last;
    let position = 0;
    for (;;) {
      const left = position * 2 + 1;
      const right = left + 1;
      let smallest = position;
      if (this.before(heap[left], heap[smallest])) smallest = left;
      if (this.before(heap[right], heap[smallest])) smallest = right;
      if (smallest === position) break;
      this.swap(position, smallest);
      position = smallest;
    }
    return first;
  }

  private before(left: number | undefined, right: number | undefined): boolean {
    const leftNode = left === undefined ? undefined : this.nodes[left];
    const rightNode = right === undefined ? undefined : this.nodes[right];
    return (
      leftNode !== undefined &&
      rightNode !== undefined &&
      this.playsBefore(leftNode.stop, rightNode.stop)
    );
  }

  private swap(left: number, right: number): void {
    const { heap } = this;
    const leftValue = heap[left];
    const rightValue = heap[right];
    if (leftValue === undefined || rightValue === undefined) return;
    heap[left] = rightValue;
    heap[right] = leftValue;
  }
}

interface PeerNode {
  readonly index: number;
  readonly stop: HistoryStop;
}

interface TimelineGraph {
  readonly nodes: TimelineNode[];
  readonly nodesByPeer: Map<PeerID, PeerNode[]>;
  /** The dependencies each change declares, by node index. */
  readonly declaredDependencies: Change["deps"][];
}

/** Index of the peer's change that holds `counter`, or -1 when none does. */
function findChangeIndex(
  peerNodes: readonly PeerNode[],
  counter: number,
): number {
  let low = 0;
  let high = peerNodes.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const candidate = peerNodes[middle];
    if (candidate === undefined) return -1;
    if (counter < candidate.stop.startCounter) {
      high = middle - 1;
    } else if (counter >= candidate.stop.endCounter) {
      low = middle + 1;
    } else {
      return candidate.index;
    }
  }
  return -1;
}

function toHistoryStop(peerId: PeerID, change: Change): HistoryStop {
  return {
    peerId,
    startCounter: change.counter,
    endCounter: change.counter + change.length,
    lamport: change.lamport,
    timestamp: change.timestamp > 0 ? change.timestamp : null,
  };
}

function buildTimelineGraph(
  changes: ReadonlyMap<PeerID, readonly Change[]>,
): TimelineGraph {
  const graph: TimelineGraph = {
    nodes: [],
    nodesByPeer: new Map(),
    declaredDependencies: [],
  };
  for (const [peerId, peerChanges] of changes) {
    const peerNodes: PeerNode[] = [];
    const ordered = [...peerChanges].sort(
      (left, right) => left.counter - right.counter,
    );
    for (const change of ordered) {
      const stop = toHistoryStop(peerId, change);
      peerNodes.push({ index: graph.nodes.length, stop });
      graph.nodes.push({ stop, dependents: [], unmetDependencies: 0 });
      graph.declaredDependencies.push(change.deps);
    }
    graph.nodesByPeer.set(peerId, peerNodes);
  }
  return graph;
}

/** The nodes that must play before `peerNodes[position]`. */
function dependenciesOf(
  graph: TimelineGraph,
  peerNodes: readonly PeerNode[],
  position: number,
): Set<number> {
  const dependencies = new Set<number>();
  const current = peerNodes[position];
  if (current === undefined) return dependencies;
  // A peer's own changes always play in counter order.
  const previous = peerNodes[position - 1];
  if (previous !== undefined) dependencies.add(previous.index);
  for (const dependency of graph.declaredDependencies[current.index] ?? []) {
    const holder = findChangeIndex(
      graph.nodesByPeer.get(dependency.peer) ?? [],
      dependency.counter,
    );
    // History that is not held locally cannot be ordered against.
    if (holder >= 0 && holder !== current.index) dependencies.add(holder);
  }
  return dependencies;
}

function linkDependencies(graph: TimelineGraph): void {
  for (const peerNodes of graph.nodesByPeer.values()) {
    for (const [position, { index }] of peerNodes.entries()) {
      const node = graph.nodes[index];
      if (node === undefined) continue;
      const dependencies = dependenciesOf(graph, peerNodes, position);
      node.unmetDependencies = dependencies.size;
      for (const dependency of dependencies) {
        graph.nodes[dependency]?.dependents.push(index);
      }
    }
  }
}

/** Play every node whose dependencies have played, earliest first. */
function playInOrder(
  nodes: readonly TimelineNode[],
  playsBefore: StopOrder,
): HistoryStop[] {
  const ready = new ReadyQueue(nodes, playsBefore);
  for (const [index, node] of nodes.entries()) {
    if (node.unmetDependencies === 0) ready.push(index);
  }
  const stops: HistoryStop[] = [];
  for (let index = ready.pop(); index !== undefined; index = ready.pop()) {
    const node = nodes[index];
    if (node === undefined) continue;
    stops.push(node.stop);
    for (const dependent of node.dependents) {
      const dependentNode = nodes[dependent];
      if (dependentNode === undefined) continue;
      dependentNode.unmetDependencies -= 1;
      if (dependentNode.unmetDependencies === 0) ready.push(dependent);
    }
  }
  return stops;
}

/**
 * Order every change into one timeline: by recorded time, then Lamport time,
 * then peer. A change never plays before a change it depends on, whatever
 * times were recorded, so every prefix of the result is a real version of the
 * document. Honest writers already record times that respect dependencies (a
 * change is never stamped earlier than the newest time its document holds);
 * the dependency check keeps a wrong or hostile clock from producing a prefix
 * that was never a version.
 */
export function orderHistoryStops(
  changes: ReadonlyMap<PeerID, readonly Change[]>,
): HistoryStop[] {
  return orderStops(changes, recordedTimeBefore);
}

/**
 * Order every change by Lamport time, then peer. A change's Lamport time is
 * past that of every operation it depends on, so for a document Loro built
 * this is a plain sort. The dependency check keeps every prefix a real
 * version even if a holder met Lamport times that break that rule. Recorded
 * times play no part, so every holder of the same changes computes the same
 * order whatever clocks the writers had.
 */
export function orderHistoryStopsByLamport(
  changes: ReadonlyMap<PeerID, readonly Change[]>,
): HistoryStop[] {
  return orderStops(changes, lamportBefore);
}

function orderStops(
  changes: ReadonlyMap<PeerID, readonly Change[]>,
  playsBefore: StopOrder,
): HistoryStop[] {
  const graph = buildTimelineGraph(changes);
  linkDependencies(graph);
  const stops = playInOrder(graph.nodes, playsBefore);
  if (stops.length !== graph.nodes.length) {
    // Unreachable for a real document: its changes form an acyclic graph.
    throw new Error("Document history has a dependency cycle.");
  }
  return stops;
}

class LoroHistoryViewer implements HistoryViewer {
  readonly stops: ReadonlyArray<HistoryStop>;
  /** The version after `stops[0..cursorIndex]`, extended as the cursor moves. */
  private cursorIndex = -1;
  private cursorVersion = new Map<PeerID, number>();

  constructor(readonly doc: LoroDoc) {
    doc.detach();
    this.stops = orderHistoryStops(doc.getAllChanges());
  }

  checkout(index: number): void {
    this.doc.checkout(
      this.versionAt(index).map(({ counter, peerId }) => ({
        counter,
        peer: peerId,
      })),
    );
    // Checking out the newest version re-attaches the document, which would
    // make it editable; a viewer is read-only at every stop.
    this.doc.detach();
  }

  versionAt(index: number): HistoryVersionEntry[] {
    if (!Number.isInteger(index) || index < -1 || index >= this.stops.length) {
      throw new RangeError(`History stop ${index} is out of range.`);
    }
    if (index < this.cursorIndex) {
      this.cursorIndex = -1;
      this.cursorVersion = new Map();
    }
    while (this.cursorIndex < index) {
      this.cursorIndex += 1;
      const stop = this.stops[this.cursorIndex];
      if (stop !== undefined) {
        this.cursorVersion.set(stop.peerId, stop.endCounter);
      }
    }
    return this.doc
      .vvToFrontiers(VersionVector.parseJSON(this.cursorVersion))
      .map(({ counter, peer }) => ({ counter, peerId: peer }));
  }

  free(): void {
    this.doc.free();
  }
}

/**
 * Build a timeline over a document that already holds the history to browse,
 * and take ownership of it. Pass a scratch document from
 * {@link createReadOnlyDocument}, never a document that is being edited:
 * checking out a version makes the document read-only.
 */
export function openHistoryViewer(doc: LoroDoc): HistoryViewer {
  return new LoroHistoryViewer(doc);
}
