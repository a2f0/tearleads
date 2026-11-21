import {
  type HeldCopy,
  type HeldCopyCheck,
  type HeldCopyCheckEvent,
  sameHeldCopy,
  transitionHeldCopyCheck,
} from "./heldCopyCheckMachine";

/**
 * The held-copy maps a document store keeps per slot. Spelled out here, not
 * picked from the store state, so the snapshot can read checks without an
 * import cycle; the store state object itself keys the checks.
 */
export interface HeldCopySlots {
  readonly attachmentBlobIdBySlotId: Readonly<Record<string, string | null>>;
  readonly attachmentContentSha256BySlotId: Readonly<Record<string, string>>;
  readonly attachmentStorageKeyBySlotId: Readonly<Record<string, string>>;
}

interface HeldCopyChecks {
  readonly bySlotId: Map<string, HeldCopyCheck>;
  /** A host opened the document, so a reload checks its copies again. */
  requested: boolean;
}

// Session-local: a restart checks every copy again on its first access.
const checksByStore = new WeakMap<HeldCopySlots, HeldCopyChecks>();

function readChecks(state: HeldCopySlots): HeldCopyChecks {
  let checks = checksByStore.get(state);
  if (!checks) {
    checks = { bySlotId: new Map(), requested: false };
    checksByStore.set(state, checks);
  }
  return checks;
}

export function dispatchHeldCopyCheck(
  state: HeldCopySlots,
  slotId: string,
  event: HeldCopyCheckEvent,
): HeldCopyCheck | undefined {
  const checks = readChecks(state);
  const next = transitionHeldCopyCheck(checks.bySlotId.get(slotId), event);
  if (next) checks.bySlotId.set(slotId, next);
  return next;
}

export function requestHeldCopyChecks(state: HeldCopySlots): void {
  readChecks(state).requested = true;
}

export function heldCopyChecksRequested(state: HeldCopySlots): boolean {
  return checksByStore.get(state)?.requested === true;
}

/** The copy the slot's held row names, if it holds one. */
export function heldCopyOf(
  state: HeldCopySlots,
  slotId: string,
): HeldCopy | null {
  const storageKey = state.attachmentStorageKeyBySlotId[slotId];
  const contentSha256 = state.attachmentContentSha256BySlotId[slotId];
  return storageKey && contentSha256 !== undefined
    ? { contentSha256, storageKey }
    : null;
}

/**
 * Slots whose current held copy a check found missing or damaged. A copy that
 * replaced the checked one is not covered by that check's finding.
 */
export function unavailableHeldCopySlotIds(
  state: HeldCopySlots,
): ReadonlySet<string> {
  const slotIds = new Set<string>();
  for (const [slotId, check] of checksByStore.get(state)?.bySlotId ?? []) {
    const copy = heldCopyOf(state, slotId);
    if (
      check.status === "unavailable" &&
      copy &&
      sameHeldCopy(check.copy, copy)
    )
      slotIds.add(slotId);
  }
  return slotIds;
}

/**
 * The held blob ids hydration compares bindings with. An unavailable copy
 * reports none, so its binding is fetched again; its storage key stays, so
 * bytes the document does not record are still refused.
 */
export function hydrationBlobIdBySlotId(
  state: HeldCopySlots,
): Readonly<Record<string, string | null | undefined>> {
  const unavailable = unavailableHeldCopySlotIds(state);
  if (unavailable.size === 0) return state.attachmentBlobIdBySlotId;
  const blobIds: Record<string, string | null | undefined> = {
    ...state.attachmentBlobIdBySlotId,
  };
  for (const slotId of unavailable) blobIds[slotId] = undefined;
  return blobIds;
}
