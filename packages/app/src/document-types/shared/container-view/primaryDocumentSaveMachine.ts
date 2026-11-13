export type PrimaryDocumentSaveState =
  | { status: "idle" }
  | { status: "saving"; request: object }
  | { status: "failed"; error: string };
export type PrimaryDocumentSaveEvent =
  | { type: "save"; request: object }
  | { type: "saved"; request: object }
  | { type: "failed"; request: object; error: string };
export function transitionPrimaryDocumentSave(
  state: PrimaryDocumentSaveState,
  event: PrimaryDocumentSaveEvent,
): PrimaryDocumentSaveState {
  if (event.type === "save")
    return state.status === "saving"
      ? state
      : { status: "saving", request: event.request };
  if (state.status !== "saving" || state.request !== event.request)
    return state;
  switch (event.type) {
    case "saved":
      return { status: "idle" };
    case "failed":
      return { status: "failed", error: event.error };
  }
}
