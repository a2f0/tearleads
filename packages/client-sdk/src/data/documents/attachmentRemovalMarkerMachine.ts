/**
 * A local attachment row marked detached is a removal marker: this device
 * removed the slot from a synced document and still owes the server a detach
 * of the binding of the copy it removed. Another pane, or another device
 * through a pull, can add the slot back before that detach is sent or while
 * it is in flight, and the local storage key can stay the same throughout.
 * Another device binds its re-add before it sends the content update that
 * records it, so a binding of other blob can be listed while committed
 * history still lacks the slot: that binding is theirs, never this marker's
 * to detach. Committed document history decides what the marker becomes,
 * never an in-memory document that may hold a staged edit that later rolls
 * back. Startup and the sync detach pass settle a marker through this one
 * transition, so they cannot disagree.
 *
 * | From            | Row              | Committed slot | To             |
 * | --------------- | ---------------- | -------------- | -------------- |
 * | awaitingDetach  | detached or live | removed        | awaitingDetach |
 * | awaitingDetach  | detached or live | same copy      | held           |
 * | remoteDetached  | detached or live | removed        | dropped        |
 * | remoteDetached  | detached or live | same copy      | rebinding      |
 * | bindingReplaced | detached or live | removed        | dropped        |
 * | bindingReplaced | detached or live | same copy      | held           |
 * | any open        | detached         | other copy     | dropped        |
 * | any open        | live             | other copy     | held           |
 * | any open        | absent           | any            | superseded     |
 *
 * The open state comes from the binding list (`observeMarkerBinding`), and
 * `remoteDetachSettled` moves `awaitingDetach` to `remoteDetached` once this
 * device's signed detach lands. A same copy re-added after that needs its
 * bytes uploaded again, since the binding it relied on is gone. The terminal
 * states ignore every event.
 */
export type AttachmentRemovalMarker =
  /** The committed document lacks the slot; this copy's binding may be active. */
  | { readonly status: "awaitingDetach" }
  /** No binding remains for the slot. */
  | { readonly status: "remoteDetached" }
  /** Another blob's binding replaced this copy's; there is nothing to detach. */
  | { readonly status: "bindingReplaced" }
  /** The row is the held copy of a slot the document has again. */
  | { readonly status: "held" }
  /** The held copy is queued to upload and bind its re-added slot again. */
  | {
      readonly status: "rebinding";
      readonly mimeType: string | null;
      readonly name: string;
    }
  /** The row is gone and its bytes are queued for the reference-checked reclaim. */
  | { readonly status: "dropped" }
  /** Another writer replaced or removed the row; it is theirs now. */
  | { readonly status: "superseded" };

/**
 * The durable row for the marker's slot. `absent` also covers a row that now
 * holds another storage key: another writer filled the slot again.
 */
export type AttachmentMarkerRow =
  | { readonly kind: "absent" }
  | { readonly kind: "detached"; readonly contentSha256: string }
  | { readonly kind: "live"; readonly contentSha256: string };

/** The marker's slot as committed document history records it. */
export type CommittedAttachmentSlot =
  | { readonly kind: "removed" }
  | {
      readonly kind: "present";
      readonly contentSha256: string;
      readonly mimeType: string | null;
      readonly name: string;
    };

export type AttachmentRemovalMarkerEvent =
  | {
      readonly type: "committedChecked";
      readonly row: AttachmentMarkerRow;
      readonly slot: CommittedAttachmentSlot;
    }
  | { readonly type: "remoteDetachSettled" };

/** The durable write that entering a state from an observed row requires. */
export type AttachmentMarkerRowEffect =
  | { readonly kind: "none" }
  | { readonly kind: "markDetached" }
  | { readonly kind: "revive" }
  | { readonly kind: "delete" }
  | {
      readonly kind: "requeueUpload";
      readonly mimeType: string | null;
      readonly name: string;
    };

/** A marker that still owes a settle against committed history. */
export type OpenAttachmentRemovalMarker = Extract<
  AttachmentRemovalMarker,
  { status: "awaitingDetach" | "bindingReplaced" | "remoteDetached" }
>;

export function isOpenAttachmentRemovalMarker(
  state: AttachmentRemovalMarker,
): state is OpenAttachmentRemovalMarker {
  return (
    state.status === "awaitingDetach" ||
    state.status === "bindingReplaced" ||
    state.status === "remoteDetached"
  );
}

function settleRemovedSlot(
  state: OpenAttachmentRemovalMarker,
): AttachmentRemovalMarker {
  return state.status === "awaitingDetach" ? state : { status: "dropped" };
}

function settleSameCopy(
  state: OpenAttachmentRemovalMarker,
  slot: Extract<CommittedAttachmentSlot, { kind: "present" }>,
): AttachmentRemovalMarker {
  // Only a slot left with no binding at all needs these bytes bound again.
  return state.status === "remoteDetached"
    ? { mimeType: slot.mimeType, name: slot.name, status: "rebinding" }
    : { status: "held" };
}

function checkCommittedSlot(
  state: OpenAttachmentRemovalMarker,
  row: AttachmentMarkerRow,
  slot: CommittedAttachmentSlot,
): AttachmentRemovalMarker {
  if (row.kind === "absent") return { status: "superseded" };
  if (slot.kind === "removed") return settleRemovedSlot(state);
  if (slot.contentSha256 === row.contentSha256) {
    return settleSameCopy(state, slot);
  }
  // Other bytes fill the slot. A copy this device removed is unrelated to
  // them; a live row is a served copy the content has not recorded yet.
  return row.kind === "detached" ? { status: "dropped" } : { status: "held" };
}

export function transitionAttachmentRemovalMarker(
  state: AttachmentRemovalMarker,
  event: AttachmentRemovalMarkerEvent,
): AttachmentRemovalMarker {
  if (!isOpenAttachmentRemovalMarker(state)) return state;
  switch (event.type) {
    case "committedChecked":
      return checkCommittedSlot(state, event.row, event.slot);
    case "remoteDetachSettled":
      return state.status === "awaitingDetach"
        ? { status: "remoteDetached" }
        : state;
  }
}

/**
 * The open state a fresh binding list gives a marker whose copy was bound to
 * `markerBlobId` (null when its upload never bound).
 */
export function observeMarkerBinding(
  activeBinding: { readonly blobId: string } | undefined,
  markerBlobId: string | null,
): OpenAttachmentRemovalMarker {
  if (!activeBinding) return { status: "remoteDetached" };
  return activeBinding.blobId === markerBlobId
    ? { status: "awaitingDetach" }
    : { status: "bindingReplaced" };
}

/** Observe a slot's row against the copy a marker names by storage key. */
export function observeAttachmentMarkerRow(
  row: {
    readonly contentSha256: string;
    readonly detachedAt: string | null;
    readonly storageKey: string;
  } | null,
  storageKey: string,
): AttachmentMarkerRow {
  if (!row || row.storageKey !== storageKey) return { kind: "absent" };
  return row.detachedAt === null
    ? { contentSha256: row.contentSha256, kind: "live" }
    : { contentSha256: row.contentSha256, kind: "detached" };
}

export function observeCommittedAttachmentSlot(
  attachment:
    | {
        readonly contentSha256: string;
        readonly mimeType: string | null;
        readonly name: string;
      }
    | undefined,
): CommittedAttachmentSlot {
  return attachment
    ? {
        contentSha256: attachment.contentSha256,
        kind: "present",
        mimeType: attachment.mimeType,
        name: attachment.name,
      }
    : { kind: "removed" };
}

/** The row write that makes the durable row match `next`. */
export function attachmentMarkerRowEffect(
  next: AttachmentRemovalMarker,
  row: AttachmentMarkerRow,
): AttachmentMarkerRowEffect {
  switch (next.status) {
    case "awaitingDetach":
    case "bindingReplaced":
    case "remoteDetached":
      return { kind: row.kind === "live" ? "markDetached" : "none" };
    case "held":
      return { kind: row.kind === "detached" ? "revive" : "none" };
    case "rebinding":
      return {
        kind: "requeueUpload",
        mimeType: next.mimeType,
        name: next.name,
      };
    case "dropped":
      return { kind: "delete" };
    case "superseded":
      return { kind: "none" };
  }
}
