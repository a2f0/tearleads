import {
  planRemovedSlotDetach,
  type RemovedSlotDetachEvent,
  type RemovedSlotDetachState,
  type RemovedSlotDetachStep,
  transitionRemovedSlotDetach,
} from "./removedSlotDetachMachine";

/**
 * The parts of a document store this module reads, named structurally so
 * the store's state module can record observations without an import cycle.
 */
interface ObservingStore {
  readonly attachmentStorageKeyBySlotId: Readonly<Record<string, string>>;
  readonly pendingAttachments: readonly { readonly slotId: string }[];
  readonly record: { readonly documentId?: string | null } | null;
}

interface SlotObservations {
  documentId: string | null;
  readonly slots: Map<string, RemovedSlotDetachState>;
}

// In memory, per store: a store reloaded for the same document keeps what it
// saw, and one relinked to another document starts over.
const observations = new WeakMap<ObservingStore, SlotObservations>();

function observationsFor(state: ObservingStore): SlotObservations {
  const documentId = state.record?.documentId ?? null;
  const current = observations.get(state);
  if (
    current &&
    (documentId === null ||
      current.documentId === null ||
      current.documentId === documentId)
  ) {
    current.documentId ??= documentId;
    return current;
  }
  const fresh: SlotObservations = { documentId, slots: new Map() };
  observations.set(state, fresh);
  return fresh;
}

function dispatch(
  observed: SlotObservations,
  slotId: string,
  event: RemovedSlotDetachEvent,
): void {
  const next = transitionRemovedSlotDetach(observed.slots.get(slotId), event);
  if (next) observed.slots.set(slotId, next);
  else observed.slots.delete(slotId);
}

/**
 * Records the slots a published snapshot holds. Only a slot this client
 * parsed as recorded can later count as removed, so a client that cannot read
 * an attachment never detaches its binding.
 */
export function observeRecordedAttachmentSlots(
  state: ObservingStore,
  attachments: readonly { readonly slotId: string }[],
): void {
  if (attachments.length === 0) return;
  const observed = observationsFor(state);
  for (const { slotId } of attachments) {
    if (observed.slots.get(slotId)?.status !== "seen") {
      dispatch(observed, slotId, { type: "recorded" });
    }
  }
}

/**
 * Slots this store saw recorded that `view` lacks and whose bytes it neither
 * holds nor is uploading: a held copy settles through its removal marker.
 */
export function listRemovedAttachmentSlots(
  state: ObservingStore,
  view: { readonly slotIds: ReadonlySet<string> },
): string[] {
  const uploading = new Set(state.pendingAttachments.map((row) => row.slotId));
  return [...observationsFor(state).slots.keys()].filter(
    (slotId) =>
      !view.slotIds.has(slotId) &&
      !state.attachmentStorageKeyBySlotId[slotId] &&
      !uploading.has(slotId),
  );
}

export function planAttachmentSlotDetach(
  state: ObservingStore,
  slotId: string,
  binding: { readonly bindingId: string } | undefined,
  versionVector: string,
): RemovedSlotDetachStep {
  return planRemovedSlotDetach(
    observationsFor(state).slots.get(slotId),
    binding,
    versionVector,
  );
}

export function recordAttachmentSlotDetach(
  state: ObservingStore,
  slotId: string,
  event: RemovedSlotDetachEvent,
): void {
  dispatch(observationsFor(state), slotId, event);
}
