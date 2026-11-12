import {
  CONTACT_ADDRESS_FIELD_DESCRIPTORS,
  type ContactAddressFieldKey,
  type ContactAddressFields,
} from "./contactAddressModel";

type AddressDraft = {
  id: string | null;
  intent: object;
  submitted: Partial<ContactAddressFields> | null;
  base: ContactAddressFields;
  values: ContactAddressFields;
};
export type ContactAddressEditorState =
  | { status: "idle" }
  | { status: "removeFailed"; id: string; error: string }
  | { status: "removing"; id: string; requestId: number }
  | { status: "editing"; draft: AddressDraft; error: string | null }
  | { status: "saving"; draft: AddressDraft; requestId: number };

type EditorEvent =
  | { type: "cancel" }
  | { type: "edit"; id: string | null; values: ContactAddressFields }
  | { type: "change"; key: ContactAddressFieldKey; value: string }
  | { type: "save"; requestId: number }
  | { type: "remove"; id: string; requestId: number }
  | { type: "failed"; requestId: number; error: string }
  | { type: "saved"; requestId: number };

export function transitionContactAddressEditor(
  state: ContactAddressEditorState,
  event: EditorEvent,
): ContactAddressEditorState {
  switch (event.type) {
    case "cancel":
      return state.status === "editing" && state.draft.submitted === null
        ? { status: "idle" }
        : state;
    case "edit":
      return state.status === "idle"
        ? {
            status: "editing",
            draft: {
              id: event.id,
              intent: event,
              submitted: null,
              base: event.values,
              values: event.values,
            },
            error: null,
          }
        : state;
    case "change":
      return state.status === "editing"
        ? {
            ...state,
            error: null,
            draft: {
              ...state.draft,
              values: { ...state.draft.values, [event.key]: event.value },
            },
          }
        : state;
    case "save":
      return saveDraft(state, event.requestId);
    case "failed":
      return finishOperation(state, event);
    case "remove":
      return state.status === "idle" ||
        (state.status === "removeFailed" && state.id === event.id)
        ? { status: "removing", id: event.id, requestId: event.requestId }
        : state;
    case "saved":
      return finishOperation(state, event);
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

function saveDraft(
  state: ContactAddressEditorState,
  requestId: number,
): ContactAddressEditorState {
  if (state.status !== "editing") return state;
  if (
    !CONTACT_ADDRESS_FIELD_DESCRIPTORS.some(
      ({ key }) => key !== "label" && state.draft.values[key].trim(),
    )
  ) {
    return {
      ...state,
      error: "Enter at least one address field besides the label.",
    };
  }
  return {
    status: "saving",
    draft: { ...state.draft, submitted: retryPatch(state.draft) },
    requestId: requestId,
  };
}

function finishOperation(
  state: ContactAddressEditorState,
  event: Extract<EditorEvent, { type: "saved" | "failed" }>,
): ContactAddressEditorState {
  if (state.status !== "saving" && state.status !== "removing") return state;
  if (state.requestId !== event.requestId) return state;
  if (event.type === "saved") return { status: "idle" };
  return state.status === "saving"
    ? { status: "editing", draft: state.draft, error: event.error }
    : { status: "removeFailed", id: state.id, error: event.error };
}

function retryPatch(draft: AddressDraft): Partial<ContactAddressFields> {
  const patch = contactAddressPatch(draft.base, draft.values);
  // A failed write may already live in Loro. Include previously submitted cells
  // even if the user reverted them to their original values before retrying.
  for (const { key } of CONTACT_ADDRESS_FIELD_DESCRIPTORS) {
    if (draft.submitted && key in draft.submitted)
      patch[key] = draft.values[key].trim();
  }
  return patch;
}

export function contactAddressPatch(
  base: ContactAddressFields,
  values: ContactAddressFields,
): Partial<ContactAddressFields> {
  const patch: Partial<ContactAddressFields> = {};
  for (const { key } of CONTACT_ADDRESS_FIELD_DESCRIPTORS) {
    if (values[key] !== base[key]) patch[key] = values[key].trim();
  }
  return patch;
}
