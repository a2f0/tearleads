import type { DocumentRow } from "@tearleads/client-sdk";
import { useEffect, useReducer, useRef } from "react";
import {
  type ContactAddressEditorState,
  contactAddressPatch,
  transitionContactAddressEditor,
} from "./contactAddressEditorMachine";
import {
  CONTACT_ADDRESS_FIELD_DESCRIPTORS,
  type ContactAddressFields,
  isContactAddressRow,
} from "./contactAddressModel";

export interface ContactAddressEditorInput {
  rows: ReadonlyArray<DocumentRow> | undefined;
  disabled: boolean;
  isEditing: boolean;
  // Adapters must acknowledge persistence, not merely resolution of SDK calls.
  onAddAddress: (fields: ContactAddressFields) => Promise<string | null>;
  onUpdateAddress: (
    id: string,
    patch: Partial<ContactAddressFields>,
  ) => Promise<void>;
  onRemoveAddress: (id: string) => Promise<void>;
}

async function applyAddressOperation(
  input: ContactAddressEditorInput,
  state: Extract<ContactAddressEditorState, { status: "saving" | "removing" }>,
) {
  if (input.disabled || !input.isEditing || input.rows === undefined)
    throw new Error("Address editing is unavailable.");
  if (state.status === "removing") return input.onRemoveAddress(state.id);
  const { id, values, base } = state.draft;
  if (
    id !== null &&
    !input.rows.some((row) => row.id === id && isContactAddressRow(row))
  )
    throw new Error(
      "This address is no longer available. Cancel to discard the draft.",
    );
  if (id === null) {
    const fields = { ...values };
    for (const { key } of CONTACT_ADDRESS_FIELD_DESCRIPTORS)
      fields[key] = fields[key].trim();
    if (!(await input.onAddAddress(fields)))
      throw new Error("Address was not saved. Please try again.");
  } else {
    const patch = contactAddressPatch(base, values);
    if (Object.keys(patch).length > 0) await input.onUpdateAddress(id, patch);
  }
}

export function useContactAddressEditor(input: ContactAddressEditorInput) {
  const [state, dispatch] = useReducer(transitionContactAddressEditor, {
    status: "idle",
  } as ContactAddressEditorState);
  const requestId = useRef(0);
  const latest = useRef(input);
  latest.current = input;
  useEffect(() => {
    if (state.status !== "saving" && state.status !== "removing") return;
    let cancelled = false;
    void applyAddressOperation(latest.current, state)
      .then(() => {
        if (!cancelled) dispatch({ type: "saved", requestId: state.requestId });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          dispatch({
            type: "failed",
            requestId: state.requestId,
            error:
              error instanceof Error
                ? error.message
                : "Address was not saved. Please try again.",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [state]);
  const writable =
    !input.disabled && input.isEditing && input.rows !== undefined;
  return {
    state,
    dispatch,
    writable,
    save: () => {
      if (writable) dispatch({ type: "save", requestId: ++requestId.current });
    },
    remove: (id: string) => {
      if (writable)
        dispatch({ type: "remove", id, requestId: ++requestId.current });
    },
  };
}
