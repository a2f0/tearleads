/**
 * A structured document's edit mode, together with the write access it
 * depends on.
 *
 * - `locked`: the document cannot be written, and no edit is waiting.
 * - `waiting-for-write-access`: the host asked to open in edit mode (a new
 *   document) before write access arrived; editing starts when it does.
 * - `viewing`: writable, showing the read view.
 * - `editing`: writable, showing the edit fields.
 *
 * Replaces the `isEditing` + `pendingInitialEditing` pair and two effects,
 * which could hold editing without write access (a toggle while read-only)
 * and re-applied the initial edit request on every write-access change.
 */
export type StructuredDocumentEditingState =
  | { readonly status: "editing" }
  | { readonly status: "locked" }
  | { readonly status: "viewing" }
  | { readonly status: "waiting-for-write-access" };

type StructuredDocumentEditingEvent =
  | { readonly type: "edit-entered" }
  | { readonly type: "initial-edit-requested" }
  | { readonly type: "toggled" }
  | { readonly canWrite: boolean; readonly type: "write-access-changed" };

const EDITING: StructuredDocumentEditingState = { status: "editing" };
const LOCKED: StructuredDocumentEditingState = { status: "locked" };
const VIEWING: StructuredDocumentEditingState = { status: "viewing" };
const WAITING: StructuredDocumentEditingState = {
  status: "waiting-for-write-access",
};

export function initialStructuredDocumentEditingState(input: {
  canWrite: boolean;
  initialEditing: boolean;
}): StructuredDocumentEditingState {
  if (input.canWrite) {
    return input.initialEditing ? EDITING : VIEWING;
  }

  return input.initialEditing ? WAITING : LOCKED;
}

/**
 * Pure transition; returns the same reference for events that change nothing
 * so React skips the re-render.
 *
 * | state \ event | initial-edit-requested | toggled | edit-entered | write access gained | write access lost |
 * | ------------- | ---------------------- | ------- | ------------ | ------------------- | ----------------- |
 * | locked        | waiting                | (same)  | (same)       | viewing             | (same)            |
 * | waiting       | (same)                 | (same)  | (same)       | editing             | (same)            |
 * | viewing       | editing                | editing | editing      | (same)              | locked            |
 * | editing       | (same)                 | viewing | (same)       | (same)              | locked            |
 */
export function transitionStructuredDocumentEditing(
  state: StructuredDocumentEditingState,
  event: StructuredDocumentEditingEvent,
): StructuredDocumentEditingState {
  switch (event.type) {
    case "initial-edit-requested":
      if (state.status === "locked") {
        return WAITING;
      }
      return state.status === "viewing" ? EDITING : state;
    case "toggled":
      if (state.status === "viewing") {
        return EDITING;
      }
      return state.status === "editing" ? VIEWING : state;
    case "edit-entered":
      return state.status === "viewing" ? EDITING : state;
    case "write-access-changed":
      return transitionWriteAccess(state, event.canWrite);
    default:
      return assertNever(event);
  }
}

function transitionWriteAccess(
  state: StructuredDocumentEditingState,
  canWrite: boolean,
): StructuredDocumentEditingState {
  switch (state.status) {
    case "locked":
      return canWrite ? VIEWING : state;
    case "waiting-for-write-access":
      return canWrite ? EDITING : state;
    case "viewing":
    case "editing":
      return canWrite ? state : LOCKED;
    default:
      return assertNever(state);
  }
}

function assertNever(value: never): never {
  throw new Error(
    `Unhandled structured document editing value: ${JSON.stringify(value)}`,
  );
}
