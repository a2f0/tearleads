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
 * toward the rotation, never an update. A `history` window rebuilds a whole
 * history to compare it with the device's own, for a viewer (#2970): its
 * death is charged to nothing, and it changes nothing durable.
 */
export type LoroWindowKind = "read" | "rotation" | "history";

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
   * The user ended the lifetime, the window belongs to another judge or
   * server document, or it verified history for a viewer: it says nothing.
   */
  | { readonly kind: "discard" };

/**
 * A window counts when its lifetime has met no Loro runtime failure, so a
 * lifetime counts at most one failure. A read window counts only when it
 * holds one unsettled update; a rotation window counts its death toward the
 * rotation whatever its page held; a history window never counts.
 */
export function loroWindowCounts(
  kind: LoroWindowKind,
  unsettledUpdates: number,
  lifetimeFailed: boolean,
): boolean {
  if (lifetimeFailed) return false;
  switch (kind) {
    case "read":
      return unsettledUpdates === 1;
    case "rotation":
      return true;
    case "history":
      return false;
  }
}

/**
 * Whether a window the process outlives clears the attempts earlier deaths
 * counted toward the updates it read. A history window writes nothing but
 * its own row, so it clears none.
 */
export function loroWindowClearsAttempts(kind: LoroWindowKind): boolean {
  switch (kind) {
    case "read":
    case "rotation":
      return true;
    case "history":
      return false;
  }
}

/**
 * Whether a window's row takes the place of the row another window of its
 * lifetime wrote on the scope, which keeps one row a lifetime. A history
 * window's does not: its death says nothing, so the other window's row,
 * which counts nothing beside it, stays to isolate that window's updates.
 */
export function loroWindowTakesScopeRow(kind: LoroWindowKind): boolean {
  switch (kind) {
    case "read":
    case "rotation":
      return true;
    case "history":
      return false;
  }
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
  switch (window.kind) {
    case "history":
      // No attempt, no suspect, no rotation death: sync keeps its page size.
      return { kind: "discard" };
    case "rotation":
      return charged
        ? { kind: "rotationDeath", suspects: window.updateIds }
        : { kind: "isolate", suspects: window.updateIds };
    case "read": {
      const [only] = window.updateIds;
      if (charged && window.updateIds.length === 1 && only !== undefined) {
        return { kind: "count", updateId: only };
      }
      return { kind: "isolate", suspects: window.updateIds };
    }
  }
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
