import {
  DOCUMENTS_APP_KIND,
  type ExecSql,
  RecordedAttachmentSlotRepository,
} from "../../../../workflows/documents";
import {
  isRemovedSlotDetachWaiting,
  planRemovedSlotDetach,
  type RemovedSlotDetachEvent,
  type RemovedSlotDetachState,
  type RemovedSlotDetachStep,
  type RemovedSlotSightingWrite,
  removedSlotSightingWrite,
  transitionRemovedSlotDetach,
} from "./removedSlotDetachMachine";

/**
 * The parts of a document store this module reads, named structurally so
 * the store's state module can record observations without an import cycle.
 */
interface ObservingStore {
  readonly attachmentStorageKeyBySlotId: Readonly<Record<string, string>>;
  readonly localId: string;
  readonly pendingAttachments: readonly { readonly slotId: string }[];
  readonly record: { readonly documentId?: string | null } | null;
  readonly runtime: { readonly infra: { readonly execSql: ExecSql } };
}

interface SlotObservations {
  documentId: string | null;
  readonly slots: Map<string, RemovedSlotDetachState>;
  /** The one read of what earlier stores over this record persisted. */
  restored?: Promise<void>;
}

// Per store, backed by the local database: a store reloaded or reopened
// after a restart for the same document restores what was seen, and one
// relinked to another document starts over.
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
    if (current.documentId === null && documentId !== null) {
      // Sightings wait for a server id to be stored under.
      current.documentId = documentId;
      writeSightings(state, current, "record", [...current.slots.keys()]);
    }
    return current;
  }
  const fresh: SlotObservations = { documentId, slots: new Map() };
  observations.set(state, fresh);
  return fresh;
}

/**
 * Queues the durable side of transitions. A write that fails loses only the
 * restart it was for: the store still holds the slot in memory.
 */
function writeSightings(
  state: ObservingStore,
  observed: SlotObservations,
  write: RemovedSlotSightingWrite,
  slotIds: readonly string[],
): void {
  const { documentId } = observed;
  if (write === "keep" || documentId === null || slotIds.length === 0) return;
  const repository = new RecordedAttachmentSlotRepository(
    state.runtime.infra.execSql,
  );
  const scope = { appKind: DOCUMENTS_APP_KIND, localId: state.localId };
  void (
    write === "record"
      ? repository.record(scope, {
          documentId,
          seenAt: new Date().toISOString(),
          slotIds,
        })
      : repository.forget(scope, slotIds)
  ).catch(() => undefined);
}

function transition(
  observed: SlotObservations,
  slotId: string,
  event: RemovedSlotDetachEvent,
): RemovedSlotSightingWrite {
  const previous = observed.slots.get(slotId);
  const next = transitionRemovedSlotDetach(previous, event);
  if (next) observed.slots.set(slotId, next);
  else observed.slots.delete(slotId);
  return removedSlotSightingWrite(previous, next, event);
}

function dispatch(
  state: ObservingStore,
  observed: SlotObservations,
  slotId: string,
  event: RemovedSlotDetachEvent,
): void {
  writeSightings(state, observed, transition(observed, slotId, event), [
    slotId,
  ]);
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
  const recorded = attachments.flatMap(({ slotId }) =>
    observed.slots.get(slotId)?.status !== "seen" &&
    transition(observed, slotId, { type: "recorded" }) === "record"
      ? [slotId]
      : [],
  );
  writeSightings(state, observed, "record", recorded);
}

/**
 * Adds the slots earlier stores over this record saw recorded, once per
 * observation set. A slot this store already tracks keeps its own state.
 */
function restoreRecordedSlots(state: ObservingStore): Promise<void> {
  const observed = observationsFor(state);
  const { documentId } = observed;
  if (documentId === null) return Promise.resolve();
  observed.restored ??= new RecordedAttachmentSlotRepository(
    state.runtime.infra.execSql,
  )
    .restore(
      { appKind: DOCUMENTS_APP_KIND, localId: state.localId },
      documentId,
    )
    .then(
      (slotIds) => {
        for (const slotId of slotIds) {
          transition(observed, slotId, { type: "restored" });
        }
      },
      // Unreadable: the store keeps only what it sees itself.
      () => undefined,
    );
  return observed.restored;
}

/**
 * Slots this store, or an earlier one over its record, saw recorded that
 * `view` lacks and whose bytes it neither holds nor is uploading: a held copy
 * settles through its removal marker. A slot whose detach was refused at this
 * very version is left out, so a pass lists bindings again only once the view
 * moves.
 */
export async function listRemovedAttachmentSlots(
  state: ObservingStore,
  view: {
    readonly slotIds: ReadonlySet<string>;
    readonly versionVector: string;
  },
): Promise<string[]> {
  await restoreRecordedSlots(state);
  const uploading = new Set(state.pendingAttachments.map((row) => row.slotId));
  return [...observationsFor(state).slots].flatMap(([slotId, slot]) =>
    !view.slotIds.has(slotId) &&
    !state.attachmentStorageKeyBySlotId[slotId] &&
    !uploading.has(slotId) &&
    !isRemovedSlotDetachWaiting(slot, view.versionVector)
      ? [slotId]
      : [],
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
  dispatch(state, observationsFor(state), slotId, event);
}
