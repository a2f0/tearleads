/**
 * The Loro read windows of one document scope (#3194), as pure decisions.
 * `loroWindowPersistence.ts` stores the window rows and the isolation state
 * these functions read and return.
 */

/**
 * What a death in a window is charged to. A `read` window's death counts
 * toward the update it read alone. A `rotation` window reads history this
 * device already accepted, to rebuild it for a key rotation, so its death
 * is far likelier the rebuild's size or state than the update: it counts
 * toward the rotation, never an update.
 */
export type LoroWindowKind = "read" | "rotation";

/** A window another lifetime left, as stored. */
export interface LoroWindow {
  readonly counts: boolean;
  readonly documentId: string;
  readonly judge: string;
  readonly kind: LoroWindowKind;
  readonly lifetimeId: string;
  /** The unsettled updates it read, in server order. */
  readonly updateIds: readonly string[];
}

/** What a window whose lifetime ended means for its updates. */
export type OrphanVerdict =
  /** The lifetime died reading this update alone: one attempt toward it. */
  | { readonly kind: "count"; readonly updateId: string }
  /**
   * The lifetime died rebuilding history for a rotation: one death toward
   * the device's rotation of the document. Its updates are read alone.
   */
  | { readonly kind: "rotationDeath"; readonly suspects: readonly string[] }
  /** The death says nothing about any one update: read each alone. */
  | { readonly kind: "isolate"; readonly suspects: readonly string[] }
  /**
   * The user ended the lifetime, or the window belongs to another judge or
   * server document: it says nothing.
   */
  | { readonly kind: "discard" };

/**
 * A window counts when its lifetime has met no Loro runtime failure, so a
 * lifetime counts at most one failure. A read window counts only when it
 * holds one unsettled update; a rotation window counts its death toward the
 * rotation whatever its page held.
 */
export function loroWindowCounts(
  kind: LoroWindowKind,
  unsettledUpdates: number,
  lifetimeFailed: boolean,
): boolean {
  return (kind === "rotation" || unsettledUpdates === 1) && !lifetimeFailed;
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
  const charged = window.counts && !context.endedFailed;
  if (window.kind === "rotation") {
    return charged
      ? { kind: "rotationDeath", suspects: window.updateIds }
      : { kind: "isolate", suspects: window.updateIds };
  }
  const [only] = window.updateIds;
  if (charged && window.updateIds.length === 1 && only !== undefined) {
    return { kind: "count", updateId: only };
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
  /**
   * A page of `documentId` committed, having passed these updates: accepted
   * or voided them. An update it held or deferred is not passed.
   */
  | {
      readonly type: "pageCommitted";
      readonly documentId: string;
      readonly passedUpdateIds: readonly string[];
      readonly pullCompleted: boolean;
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
      const passed = new Set(event.passedUpdateIds);
      const suspects = state.suspects.filter((id) => !passed.has(id));
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
