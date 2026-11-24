/**
 * The Loro read windows of one document scope (#3194), as pure decisions.
 * `loroWindowPersistence.ts` stores the window rows and the isolation state
 * these functions read and return.
 */

/** A window another lifetime left, as stored. */
export interface LoroWindow {
  readonly contentKeyEpoch: number | null;
  readonly counts: boolean;
  readonly documentId: string;
  readonly judge: string;
  readonly keyFingerprint: string | null;
  readonly lifetimeId: string;
  /** The unsettled updates it read, in server order. */
  readonly updateIds: readonly string[];
}

/** What a window whose lifetime ended means for its updates. */
export type OrphanVerdict =
  /** The lifetime died reading this update alone: one attempt toward it. */
  | {
      readonly kind: "count";
      readonly contentKeyEpoch: number | null;
      readonly keyFingerprint: string | null;
      readonly updateId: string;
    }
  /** The death says nothing about any one update: read each alone. */
  | { readonly kind: "isolate"; readonly suspects: readonly string[] }
  /**
   * The user ended the lifetime, or the window belongs to another judge or
   * server document: it says nothing.
   */
  | { readonly kind: "discard" };

/**
 * A window counts when it holds one unsettled update and its lifetime has
 * met no Loro runtime failure: a lifetime counts at most one failure.
 */
export function loroWindowCounts(
  unsettledUpdates: number,
  lifetimeFailed: boolean,
): boolean {
  return unsettledUpdates === 1 && !lifetimeFailed;
}

export function judgeOrphanWindow(
  window: LoroWindow,
  context: {
    readonly documentId: string;
    /** The lifetime met a Loro runtime failure with this window open. */
    readonly endedFailed: boolean;
    readonly endedHidden: boolean;
    readonly judge: string;
  },
): OrphanVerdict {
  if (
    context.endedHidden ||
    window.judge !== context.judge ||
    window.documentId !== context.documentId ||
    window.updateIds.length === 0
  ) {
    return { kind: "discard" };
  }
  const [only] = window.updateIds;
  if (
    window.counts &&
    !context.endedFailed &&
    window.updateIds.length === 1 &&
    only !== undefined
  ) {
    return {
      kind: "count",
      contentKeyEpoch: window.contentKeyEpoch,
      keyFingerprint: window.keyFingerprint,
      updateId: only,
    };
  }
  return { kind: "isolate", suspects: window.updateIds };
}

/** Whether a scope reads one update a page, and which updates it suspects. */
export type LoroIsolation =
  | { readonly status: "free" }
  | {
      readonly status: "isolating";
      readonly documentId: string;
      readonly suspects: readonly string[];
    };

export type LoroIsolationEvent =
  /** A death left these updates of `documentId` unattributed. */
  | {
      readonly type: "orphanIsolated";
      readonly documentId: string;
      readonly suspects: readonly string[];
    }
  /** A page of `documentId` committed, having served these updates. */
  | {
      readonly type: "pageCommitted";
      readonly documentId: string;
      readonly pullCompleted: boolean;
      readonly servedUpdateIds: readonly string[];
    };

export const LORO_ISOLATION_FREE: LoroIsolation = { status: "free" };

export function transitionLoroIsolation(
  state: LoroIsolation,
  event: LoroIsolationEvent,
): LoroIsolation {
  switch (event.type) {
    case "orphanIsolated": {
      const kept =
        state.status === "isolating" && state.documentId === event.documentId
          ? state.suspects
          : [];
      const suspects = [...new Set([...kept, ...event.suspects])];
      return suspects.length === 0
        ? LORO_ISOLATION_FREE
        : { status: "isolating", documentId: event.documentId, suspects };
    }
    case "pageCommitted": {
      if (
        state.status === "free" ||
        state.documentId !== event.documentId ||
        event.pullCompleted
      ) {
        return LORO_ISOLATION_FREE;
      }
      const served = new Set(event.servedUpdateIds);
      const suspects = state.suspects.filter((id) => !served.has(id));
      return suspects.length === 0
        ? LORO_ISOLATION_FREE
        : { status: "isolating", documentId: state.documentId, suspects };
    }
  }
}

/** The page limit a pull of `documentId` asks for, if any. */
export function loroIsolationPageLimit(
  state: LoroIsolation,
  documentId: string,
): 1 | undefined {
  return state.status === "isolating" && state.documentId === documentId
    ? 1
    : undefined;
}
