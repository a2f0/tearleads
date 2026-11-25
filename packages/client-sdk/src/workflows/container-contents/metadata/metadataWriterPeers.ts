import type { createDocument } from "@tearleads/loro";
import type { DomainScope } from "../../../data/shared/domainScope";
import {
  type MetadataWriterPeerEvent,
  type MetadataWriterPeerState,
  transitionMetadataWriterPeer,
} from "./metadataWriterPeerMachine";

type MetadataDocument = Awaited<ReturnType<typeof createDocument>>;
type PeerId = MetadataDocument["peerIdStr"];

/**
 * Applies `metadataWriterPeerMachine.ts` to live metadata documents: a copy
 * borrows the live document's peer at its first write while no other
 * document may write it, so serial edits keep one peer per container and
 * writer, and only overlapping writes add a peer. A sync pass asks before it
 * imports a served page that extends the peer (`admitServedMetadataPage`).
 *
 * A runtime's writer peers share one table, so every document a runtime
 * loads under a writer peer sees its state. A document on a fresh peer starts
 * its own table, which its copies share and which goes with them.
 */
type StoredState =
  | { readonly status: "held"; readonly end: number; readonly written: number }
  | {
      readonly status: "lent";
      readonly borrower: WeakRef<MetadataDocument>;
      readonly end: number;
      readonly written: number;
    };

type PeerStates = Map<PeerId, StoredState>;

const runtimePeerStates = new WeakMap<DomainScope, PeerStates>();
const documentPeerStates = new WeakMap<MetadataDocument, PeerStates>();
/** Each copy's source, until the copy first writes or is installed. */
const copySources = new WeakMap<MetadataDocument, MetadataDocument>();

function getOrCreateRuntimeMetadataWriterPeers(
  domainScope: DomainScope,
): PeerStates {
  let states = runtimePeerStates.get(domainScope);
  if (!states) {
    states = new Map();
    runtimePeerStates.set(domainScope, states);
  }
  return states;
}

function peerStatesOf(doc: MetadataDocument): PeerStates {
  let states = documentPeerStates.get(doc);
  if (!states) {
    states = new Map();
    documentPeerStates.set(doc, states);
  }
  return states;
}

function counterOf(doc: MetadataDocument, peerId: PeerId): number {
  return doc.version().get(peerId) ?? 0;
}

function readState(
  states: PeerStates,
  peerId: PeerId,
): MetadataWriterPeerState<MetadataDocument> {
  const stored = states.get(peerId);
  if (!stored) return { status: "none" };
  return stored.status === "held"
    ? stored
    : { ...stored, borrower: stored.borrower.deref() };
}

function writeState(
  states: PeerStates,
  peerId: PeerId,
  state: MetadataWriterPeerState<MetadataDocument>,
  previous: StoredState | undefined,
): void {
  if (state.status === "none") return;
  if (state.status === "held") {
    states.set(peerId, state);
    return;
  }
  // A loan outlives its borrower: the borrower's operations may be queued.
  const borrower =
    state.borrower === undefined
      ? previous?.status === "lent"
        ? previous.borrower
        : undefined
      : new WeakRef(state.borrower);
  if (borrower) {
    states.set(peerId, { ...state, borrower });
  }
}

function dispatch(
  states: PeerStates,
  peerId: PeerId,
  event: MetadataWriterPeerEvent<MetadataDocument>,
) {
  const previous = states.get(peerId);
  const next = transitionMetadataWriterPeer(readState(states, peerId), event);
  writeState(states, peerId, next.state, previous);
  return next.effect;
}

/** A random peer no other document uses. */
function freshPeerId(): bigint {
  const [high = 0, low = 0] = crypto.getRandomValues(new Uint32Array(2));
  return (BigInt(high) << 32n) | BigInt(low) || 1n;
}

/** `doc` writes under its writer's peer for a container in this runtime. */
export function bindRuntimeMetadataWriterPeer(
  doc: MetadataDocument,
  domainScope: DomainScope,
): void {
  documentPeerStates.set(
    doc,
    getOrCreateRuntimeMetadataWriterPeers(domainScope),
  );
}

/** `copy` was made from `source` and may borrow its peer on its first write. */
export function trackDetachedMetadataCopy(
  copy: MetadataDocument,
  source: MetadataDocument,
): void {
  copySources.set(copy, source);
}

function takePeer(doc: MetadataDocument, source: MetadataDocument): void {
  doc.setPeerId(source.peerIdStr);
  documentPeerStates.set(doc, peerStatesOf(source));
}

/** Runs before every local write into a metadata document. */
export function prepareLocalMetadataWrite(doc: MetadataDocument): void {
  const source = copySources.get(doc);
  if (source) {
    copySources.delete(doc);
    const effect = dispatch(peerStatesOf(source), source.peerIdStr, {
      copy: doc,
      counter: counterOf(doc, source.peerIdStr),
      type: "copyFirstWrite",
    });
    if (effect === "takePeer") {
      takePeer(doc, source);
      return;
    }
  }
  const effect = dispatch(peerStatesOf(doc), doc.peerIdStr, {
    counter: counterOf(doc, doc.peerIdStr),
    doc,
    type: "localWrite",
  });
  if (effect === "switchToFreshPeer") {
    doc.setPeerId(freshPeerId());
    documentPeerStates.set(doc, new Map());
  }
}

/** Runs after every local write into a metadata document. */
export function finishLocalMetadataWrite(doc: MetadataDocument): void {
  dispatch(peerStatesOf(doc), doc.peerIdStr, {
    counter: counterOf(doc, doc.peerIdStr),
    type: "wrote",
  });
}

/** The operations a served page carries under one peer, up to `endCounter`. */
interface ServedPeerSpan {
  readonly endCounter: number;
  readonly peerId: string;
}

/**
 * Runs before a sync pass imports a judged page into `doc`, with the spans
 * the page carries. A page that extends the writer peer `doc` would write
 * next, past the operations `doc` holds, was committed by another holder of
 * that peer. False when a document here wrote operations `doc` lacks at those
 * counters: the page must not be imported. Otherwise the peer ends past the
 * page from now on, so a document that lacks the page takes a fresh peer for
 * its next write. The caller imports in the same synchronous step, so no
 * local write runs between this check and the import.
 */
export function admitServedMetadataPage(
  doc: MetadataDocument,
  spans: readonly ServedPeerSpan[],
): boolean {
  // A copy that has not written would borrow its source's peer.
  const holder = copySources.get(doc) ?? doc;
  const peerId = holder.peerIdStr;
  const counter = counterOf(doc, peerId);
  const end = spans.reduce(
    (highest, span) =>
      span.peerId === peerId ? Math.max(highest, span.endCounter) : highest,
    counter,
  );
  if (end === counter) return true;
  const effect = dispatch(peerStatesOf(holder), peerId, {
    counter,
    end,
    type: "remoteExtended",
  });
  return effect !== "collide";
}

/** `copy` replaced `source` as the live document. */
export function adoptInstalledMetadataCopy(
  copy: MetadataDocument,
  source: MetadataDocument,
): void {
  copySources.delete(copy);
  const copyWrote = copy.version().get(copy.peerIdStr) !== undefined;
  if (copyWrote && copy.peerIdStr !== source.peerIdStr) {
    // The copy wrote a peer the source no longer carries, perhaps one it
    // borrowed before the source moved off it: the copy holds it now.
    dispatch(peerStatesOf(copy), copy.peerIdStr, {
      copy,
      counter: counterOf(copy, copy.peerIdStr),
      copyWrote,
      type: "copyInstalled",
    });
  }
  const effect = dispatch(peerStatesOf(source), source.peerIdStr, {
    copy,
    counter: counterOf(copy, source.peerIdStr),
    copyWrote,
    type: "copyInstalled",
  });
  if (effect === "takePeer") takePeer(copy, source);
}

/** `copy`'s operations were merged into the live document. */
export function releaseMergedMetadataCopy(copy: MetadataDocument): void {
  copySources.delete(copy);
  dispatch(peerStatesOf(copy), copy.peerIdStr, {
    copy,
    counter: counterOf(copy, copy.peerIdStr),
    type: "copyMerged",
  });
}
