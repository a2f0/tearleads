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
 * | From            | Row              | Committed slot | To              |
 * | --------------- | ---------------- | -------------- | --------------- |
 * | awaitingDetach  | detached or live | removed        | awaitingDetach  |
 * | bindingReplaced | detached or live | removed        | bindingReplaced |
 * | bindingUnknown  | detached or live | removed        | bindingUnknown  |
 * | remoteDetached  | detached or live | removed        | dropped         |
 * | remoteDetached  | detached or live | same copy      | rebinding       |
 * | bindingUnknown  | detached         | same copy      | rebinding       |
 * | any open        | detached unbound | same copy      | rebinding       |
 * | any other open  | detached or live | same copy      | held            |
 * | any open        | detached         | other copy     | dropped         |
 * | any open        | live             | other copy     | held            |
 * | any open        | absent           | any            | superseded      |
 *
 * The open state comes from a fresh binding list (`observeMarkerBinding`), or
 * is `bindingUnknown` at startup, before any list. `remoteDetachSettled`
 * moves `awaitingDetach` to `remoteDetached` once this device's signed detach
 * lands. A same copy re-added once its binding may be gone has its bytes
 * uploaded again: that is harmless when a binding remains, and the only way
 * back when none does. The terminal states ignore every event.
 */
export type AttachmentRemovalMarker =
  /** The committed document lacks the slot; the listed binding is the marker's. */
  | { readonly status: "awaitingDetach" }
  /** No binding remains for the slot. */
  | { readonly status: "remoteDetached" }
  /**
   * A binding of another blob is listed and not yet the marker's: another
   * writer's re-add, bound before the content update that records it, until
   * a later pull shows the slot still removed.
   */
  | { readonly status: "bindingReplaced" }
  /** No binding list has been read yet. */
  | { readonly status: "bindingUnknown" }
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
  | {
      readonly kind: "detached" | "live";
      /** False when the copy's upload never bound. */
      readonly bound: boolean;
      readonly contentSha256: string;
    };

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
  {
    status:
      | "awaitingDetach"
      | "bindingReplaced"
      | "bindingUnknown"
      | "remoteDetached";
  }
>;

export function isOpenAttachmentRemovalMarker(
  state: AttachmentRemovalMarker,
): state is OpenAttachmentRemovalMarker {
  return (
    state.status === "awaitingDetach" ||
    state.status === "bindingReplaced" ||
    state.status === "bindingUnknown" ||
    state.status === "remoteDetached"
  );
}

function settleRemovedSlot(
  state: OpenAttachmentRemovalMarker,
): AttachmentRemovalMarker {
  return state.status === "remoteDetached" ? { status: "dropped" } : state;
}

function settleSameCopy(
  state: OpenAttachmentRemovalMarker,
  row: Extract<AttachmentMarkerRow, { kind: "detached" | "live" }>,
  slot: Extract<CommittedAttachmentSlot, { kind: "present" }>,
): AttachmentRemovalMarker {
  // Bind these bytes again unless a binding of them is known to remain: the
  // detach landed, the copy never bound and lost its upload at removal, or
  // startup cannot tell whether a detach landed before it stopped.
  const rebind =
    state.status === "remoteDetached" ||
    (row.kind === "detached" &&
      (!row.bound || state.status === "bindingUnknown"));
  return rebind
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
    return settleSameCopy(state, row, slot);
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
 * `markerBlobId` (null when its upload never bound). A binding of another
 * blob is the marker's only once a pull has completed since it was first
 * listed with the slot still removed (`replacedBindingId`): another writer's
 * re-add sends the content update that records the slot right after its
 * bind, so a pull after the listing would have brought it. Until then the
 * binding may be that re-add, and detaching it would leave the slot unbound.
 */
export function observeMarkerBinding(
  activeBinding:
    | { readonly bindingId: string; readonly blobId: string }
    | undefined,
  markerBlobId: string | null,
  replacedBindingId?: string,
): OpenAttachmentRemovalMarker {
  if (!activeBinding) return { status: "remoteDetached" };
  return activeBinding.blobId === markerBlobId ||
    activeBinding.bindingId === replacedBindingId
    ? { status: "awaitingDetach" }
    : { status: "bindingReplaced" };
}

/** Observe a slot's row against the copy a marker names by storage key. */
export function observeAttachmentMarkerRow(
  row: {
    readonly blobId: string | null;
    readonly contentSha256: string;
    readonly detachedAt: string | null;
    readonly storageKey: string;
  } | null,
  storageKey: string,
): AttachmentMarkerRow {
  if (!row || row.storageKey !== storageKey) return { kind: "absent" };
  return {
    bound: row.blobId !== null,
    contentSha256: row.contentSha256,
    kind: row.detachedAt === null ? "live" : "detached",
  };
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
    case "bindingUnknown":
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
