import { satisfiesVersionVector } from "@tearleads/loro";

/**
 * One attachment slot a store saw its document record. Nothing is owed while
 * the slot stays recorded. Once a synced view lacks it, a binding the server
 * still lists for it is detached at that view's version, whether or not this
 * device ever held its bytes.
 */
export type RemovedSlotDetachState =
  | { readonly status: "seen" }
  /**
   * The API refused a detach of `bindingId` at `versionVector` because the
   * document, or the version the binding was bound at, holds an op that
   * version lacks. It is not sent again until the view moves past it.
   */
  | {
      readonly bindingId: string;
      readonly status: "refused";
      readonly versionVector: string;
    };

export type RemovedSlotDetachEvent =
  /** A published snapshot records the slot. */
  | { readonly type: "recorded" }
  | {
      readonly bindingId: string;
      readonly type: "detachRefused";
      readonly versionVector: string;
    }
  /** A listing showed no binding for the slot, or its detach landed. */
  | { readonly type: "settled" };

const SEEN: RemovedSlotDetachState = { status: "seen" };

/** Undefined: the store keeps nothing for the slot. */
export function transitionRemovedSlotDetach(
  state: RemovedSlotDetachState | undefined,
  event: RemovedSlotDetachEvent,
): RemovedSlotDetachState | undefined {
  switch (event.type) {
    case "recorded":
      return state?.status === "seen" ? state : SEEN;
    case "detachRefused":
      return {
        bindingId: event.bindingId,
        status: "refused",
        versionVector: event.versionVector,
      };
    case "settled":
      return undefined;
  }
}

export type RemovedSlotDetachStep = "detach" | "settle" | "wait";

function sameVersion(left: string, right: string): boolean {
  return (
    satisfiesVersionVector(left, right) && satisfiesVersionVector(right, left)
  );
}

/** Whether a detach refused at `versionVector` still waits for a newer view. */
export function isRemovedSlotDetachWaiting(
  state: RemovedSlotDetachState | undefined,
  versionVector: string,
): boolean {
  return (
    state?.status === "refused" &&
    sameVersion(state.versionVector, versionVector)
  );
}

/**
 * What a pass owes a slot it may detach, given the binding the server lists
 * for it and the version of the pass's synced view. A refused detach waits
 * for a newer view, so a binding the API keeps refusing costs one request
 * per document version rather than one per pass.
 */
export function planRemovedSlotDetach(
  state: RemovedSlotDetachState | undefined,
  binding: { readonly bindingId: string } | undefined,
  versionVector: string,
): RemovedSlotDetachStep {
  if (!binding) return "settle";
  if (
    state?.status === "refused" &&
    state.bindingId === binding.bindingId &&
    isRemovedSlotDetachWaiting(state, versionVector)
  ) {
    return "wait";
  }
  return "detach";
}
