/**
 * Who in this runtime may write a container metadata peer next. A live
 * metadata document writes under its writer's peer for the container, every
 * edit and sync pass works on a detached copy, and a refresh or a concurrent
 * insert can load another document under the same peer. Two documents writing
 * one peer from the same history would reuse its next counters, and readers
 * then void one of the two updates. Another holder of the peer can also commit
 * operations at its next counters, which a sync pass is then served; a
 * document here that wrote those counters too would hold other operations at
 * the same ids, and Loro refuses to merge the two.
 *
 * The state is kept per peer, so every document that carries the peer sees
 * it, and records two counters. `end` is past every operation a document here
 * holds under the peer, written or imported from a served page, so a document
 * behind it never writes the peer again. `written` is past every operation
 * written here, so a served page that extends the peer from below it is not
 * imported.
 *
 * | From       | Event                                     | To                | Effect            |
 * | ---------- | ----------------------------------------- | ----------------- | ----------------- |
 * | none, held | localWrite, doc at `end`                  | unchanged         | write             |
 * | none, held | localWrite, doc behind `end`              | unchanged         | switchToFreshPeer |
 * | lent(b)    | localWrite by b, at `end`                 | unchanged         | write             |
 * | lent(b)    | localWrite by b, behind `end`             | unchanged         | switchToFreshPeer |
 * | lent(b)    | localWrite by another doc                 | unchanged         | switchToFreshPeer |
 * | none, held | wrote                                     | held(new end)     | none              |
 * | lent(b)    | wrote                                     | lent(b, new end)  | none              |
 * | none, held | copyFirstWrite, copy at `end`             | lent(copy)        | takePeer          |
 * | any other  | copyFirstWrite                            | unchanged         | keepOwnPeer       |
 * | lent(copy) | copyInstalled or copyMerged               | held              | none              |
 * | none, held | copyInstalled, copy never wrote, at end   | unchanged         | takePeer          |
 * | any other  | copyInstalled or copyMerged               | unchanged         | none              |
 * | any        | remoteExtended, importer behind `written` | unchanged         | collide           |
 * | none, held | remoteExtended, importer at `written`     | held(page end)    | import            |
 * | lent(b)    | remoteExtended, importer at `written`     | lent(b, page end) | import            |
 *
 * `wrote` raises `end` and `written` together, and `remoteExtended` raises
 * only `end`. A page that collides is left for a later pass, whose copy holds
 * the operations written here and so voids the update that reuses their ids.
 *
 * A loan to a copy that is dropped without being installed never ends: its
 * operations may already be queued, so nothing else writes the peer again.
 */
export type MetadataWriterPeerState<Doc> =
  | { readonly status: "none" }
  | {
      readonly status: "held";
      readonly end: number;
      readonly written: number;
    }
  | {
      readonly status: "lent";
      /** Undefined once the borrower is gone. */
      readonly borrower: Doc | undefined;
      readonly end: number;
      readonly written: number;
    };

export type MetadataWriterPeerEvent<Doc> =
  /** A document is about to write under the peer; `counter` is its own. */
  | { readonly type: "localWrite"; readonly doc: Doc; readonly counter: number }
  /** A document wrote under the peer up to `counter`. */
  | { readonly type: "wrote"; readonly counter: number }
  /** A detached copy's first write; `counter` is the copy's for the peer. */
  | {
      readonly type: "copyFirstWrite";
      readonly copy: Doc;
      readonly counter: number;
    }
  /** A copy replaced the live document that carries the peer. */
  | {
      readonly type: "copyInstalled";
      readonly copy: Doc;
      readonly counter: number;
      readonly copyWrote: boolean;
    }
  /** A copy's operations were merged into the live document. */
  | {
      readonly type: "copyMerged";
      readonly copy: Doc;
      readonly counter: number;
    }
  /**
   * A sync pass is about to import a judged page that carries the peer's
   * operations up to `end` into a document that holds them up to `counter`.
   */
  | {
      readonly type: "remoteExtended";
      readonly counter: number;
      readonly end: number;
    };

export type MetadataWriterPeerEffect =
  | "write"
  | "switchToFreshPeer"
  | "takePeer"
  | "keepOwnPeer"
  | "import"
  | "collide"
  | "none";

type Transition<Doc> = {
  readonly effect: MetadataWriterPeerEffect;
  readonly state: MetadataWriterPeerState<Doc>;
};

function endOf<Doc>(state: MetadataWriterPeerState<Doc>): number {
  return state.status === "none" ? 0 : state.end;
}

function writtenOf<Doc>(state: MetadataWriterPeerState<Doc>): number {
  return state.status === "none" ? 0 : state.written;
}

function onLocalWrite<Doc>(
  state: MetadataWriterPeerState<Doc>,
  doc: Doc,
  counter: number,
): Transition<Doc> {
  const mayWrite =
    counter >= endOf(state) &&
    (state.status !== "lent" || state.borrower === doc);
  return { effect: mayWrite ? "write" : "switchToFreshPeer", state };
}

function onWrote<Doc>(
  state: MetadataWriterPeerState<Doc>,
  counter: number,
): Transition<Doc> {
  const end = Math.max(endOf(state), counter);
  const written = Math.max(writtenOf(state), counter);
  return {
    effect: "none",
    state:
      state.status === "lent"
        ? { ...state, end, written }
        : { end, status: "held", written },
  };
}

function onCopyFirstWrite<Doc>(
  state: MetadataWriterPeerState<Doc>,
  copy: Doc,
  counter: number,
): Transition<Doc> {
  return state.status !== "lent" && counter >= endOf(state)
    ? {
        effect: "takePeer",
        state: {
          borrower: copy,
          end: endOf(state),
          status: "lent",
          written: writtenOf(state),
        },
      }
    : { effect: "keepOwnPeer", state };
}

function onCopySettled<Doc>(
  state: MetadataWriterPeerState<Doc>,
  event: Extract<
    MetadataWriterPeerEvent<Doc>,
    { readonly type: "copyInstalled" | "copyMerged" }
  >,
): Transition<Doc> {
  if (state.status === "lent") {
    if (state.borrower !== event.copy) return { effect: "none", state };
    const end = Math.max(state.end, event.counter);
    return {
      effect: "none",
      state: { end, status: "held", written: state.written },
    };
  }
  const continues =
    event.type === "copyInstalled" &&
    !event.copyWrote &&
    event.counter >= endOf(state);
  return { effect: continues ? "takePeer" : "none", state };
}

function onRemoteExtended<Doc>(
  state: MetadataWriterPeerState<Doc>,
  counter: number,
  pageEnd: number,
): Transition<Doc> {
  const written = writtenOf(state);
  if (written > counter) return { effect: "collide", state };
  const end = Math.max(endOf(state), pageEnd);
  return {
    effect: "import",
    state:
      state.status === "lent"
        ? { ...state, end }
        : { end, status: "held", written },
  };
}

export function transitionMetadataWriterPeer<Doc>(
  state: MetadataWriterPeerState<Doc>,
  event: MetadataWriterPeerEvent<Doc>,
): Transition<Doc> {
  switch (event.type) {
    case "localWrite":
      return onLocalWrite(state, event.doc, event.counter);
    case "wrote":
      return onWrote(state, event.counter);
    case "copyFirstWrite":
      return onCopyFirstWrite(state, event.copy, event.counter);
    case "copyInstalled":
    case "copyMerged":
      return onCopySettled(state, event);
    case "remoteExtended":
      return onRemoteExtended(state, event.counter, event.end);
  }
}
