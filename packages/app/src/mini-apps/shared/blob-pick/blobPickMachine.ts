// A "pick" hands a document's "Choose Blob" action to the host's blob picker
// and carries the chosen blob back. This is the pick's lifecycle, kept apart
// from the provider that runs its navigation.

export interface BlobPickTarget {
  containerId: string;
  // localId of the document the pick returns to once a blob is chosen.
  localId: string;
  slotId: string;
  slotLabel: string;
}

export type BlobPickState =
  | { status: "idle" }
  // The picker is up for `target`.
  | { status: "picking"; target: BlobPickTarget }
  // A blob was chosen or the pick was cancelled, and the host is navigating
  // back to the document. The picker stays up, inert, until its route is left:
  // stepping back through browser history lands a moment later, and dropping
  // the target first would show the plain blob browser in between.
  | { status: "returning"; target: BlobPickTarget };

export type BlobPickEvent =
  | { type: "requested"; target: BlobPickTarget }
  // Resolved or cancelled. `awaitsRoute` is whether the host shows the picker
  // on a route of its own that it now has to leave.
  | { type: "finished"; awaitsRoute: boolean }
  // The host's route no longer shows the picker.
  | { type: "picker-route-left" };

export const IDLE_BLOB_PICK: BlobPickState = { status: "idle" };

export function transitionBlobPick(
  state: BlobPickState,
  event: BlobPickEvent,
): BlobPickState {
  switch (event.type) {
    case "requested":
      return { status: "picking", target: event.target };
    case "finished":
      if (state.status !== "picking") {
        return state;
      }
      return event.awaitsRoute
        ? { status: "returning", target: state.target }
        : IDLE_BLOB_PICK;
    case "picker-route-left":
      // Leaving while still picking (the host's own Back, the sidebar) abandons
      // the pick, so a later visit to the blob browser is not a picker for it.
      return IDLE_BLOB_PICK;
  }
}

/** The target the host's picker is up for, in either non-idle state. */
export function blobPickTarget(state: BlobPickState): BlobPickTarget | null {
  return state.status === "idle" ? null : state.target;
}
