/**
 * A local attachment row marked detached is a removal marker: this device
 * removed the slot from a synced document and still owes the server a detach
 * of the slot's binding. Another pane, or another device through a pull, can
 * add the slot back before that detach is sent or while it is in flight, and
 * the local storage key can stay the same throughout. Committed document
 * history decides what the marker becomes, never an in-memory document that
 * may hold a staged edit that later rolls back. Startup and the sync detach
 * pass settle a marker through this one transition, so they cannot disagree.
 *
 * | From           | Row              | Committed slot | To             |
 * | -------------- | ---------------- | -------------- | -------------- |
 * | awaitingDetach | detached or live | removed        | awaitingDetach |
 * | awaitingDetach | detached or live | same copy      | held           |
 * | awaitingDetach | detached         | other copy     | dropped        |
 * | awaitingDetach | live             | other copy     | held           |
 * | remoteDetached | detached or live | removed        | dropped        |
 * | remoteDetached | detached or live | same copy      | rebinding      |
 * | remoteDetached | detached         | other copy     | dropped        |
 * | remoteDetached | live             | other copy     | held           |
 * | either open    | absent           | any            | superseded     |
 *
 * `remoteDetachSettled` moves `awaitingDetach` to `remoteDetached` once the
 * slot has no active binding: this device's signed detach landed, or the
 * listing had none. A same copy re-added after that needs its bytes uploaded
 * again, since the binding it relied on is gone. The terminal states ignore
 * every event.
 */
export type AttachmentRemovalMarker =
  /** The committed document lacks the slot; its binding may be active. */
  | { readonly status: "awaitingDetach" }
  /** The committed document lacks the slot, and no binding remains. */
  | { readonly status: "remoteDetached" }
  /** The row is the held copy of a slot the document has again. */
  | { readonly status: "held" }
  /** The held copy is queued to upload and bind its re-added slot again. */
  | { readonly status: "rebinding" }
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
  | { readonly kind: "present"; readonly contentSha256: string };

export type AttachmentRemovalMarkerEvent =
  | {
      readonly type: "committedChecked";
      readonly row: AttachmentMarkerRow;
      readonly slot: CommittedAttachmentSlot;
    }
  | { readonly type: "remoteDetachSettled" };

/** The durable write that entering a state from an observed row requires. */
export type AttachmentMarkerRowEffect =
  | "none"
  | "markDetached"
  | "revive"
  | "delete"
  | "requeueUpload";

/** A marker that still owes a settle against committed history. */
export type OpenAttachmentRemovalMarker = Extract<
  AttachmentRemovalMarker,
  { status: "awaitingDetach" | "remoteDetached" }
>;

function checkCommittedSlot(
  state: OpenAttachmentRemovalMarker,
  row: AttachmentMarkerRow,
  slot: CommittedAttachmentSlot,
): AttachmentRemovalMarker {
  if (row.kind === "absent") return { status: "superseded" };
  if (slot.kind === "removed") {
    return state.status === "awaitingDetach" ? state : { status: "dropped" };
  }
  if (slot.contentSha256 === row.contentSha256) {
    return state.status === "awaitingDetach"
      ? { status: "held" }
      : { status: "rebinding" };
  }
  // Other bytes fill the slot. A copy this device removed is unrelated to
  // them; a live row is a served copy the content has not recorded yet.
  return row.kind === "detached" ? { status: "dropped" } : { status: "held" };
}

export function transitionAttachmentRemovalMarker(
  state: AttachmentRemovalMarker,
  event: AttachmentRemovalMarkerEvent,
): AttachmentRemovalMarker {
  if (state.status !== "awaitingDetach" && state.status !== "remoteDetached") {
    return state;
  }
  switch (event.type) {
    case "committedChecked":
      return checkCommittedSlot(state, event.row, event.slot);
    case "remoteDetachSettled":
      return { status: "remoteDetached" };
  }
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
  attachment: { readonly contentSha256: string } | undefined,
): CommittedAttachmentSlot {
  return attachment
    ? { contentSha256: attachment.contentSha256, kind: "present" }
    : { kind: "removed" };
}

/** The row write that makes the durable row match `next`. */
export function attachmentMarkerRowEffect(
  next: AttachmentRemovalMarker,
  row: AttachmentMarkerRow,
): AttachmentMarkerRowEffect {
  switch (next.status) {
    case "awaitingDetach":
    case "remoteDetached":
      return row.kind === "live" ? "markDetached" : "none";
    case "held":
      return row.kind === "detached" ? "revive" : "none";
    case "rebinding":
      return "requeueUpload";
    case "dropped":
      return "delete";
    case "superseded":
      return "none";
  }
}
