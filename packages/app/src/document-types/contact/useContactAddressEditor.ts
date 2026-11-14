import type { DocumentRow } from "@tearleads/client-sdk";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import {
  type ContactAddressEditorState,
  transitionContactAddressEditor,
} from "./contactAddressEditorMachine";
import {
  CONTACT_ADDRESS_FIELD_DESCRIPTORS,
  type ContactAddressFields,
  isContactAddressRow,
} from "./contactAddressModel";
import { ContactAddressWriteRefusal } from "./contactAddressWriteRefusal";

export interface ContactAddressEditorInput {
  rows: ReadonlyArray<DocumentRow> | undefined;
  disabled: boolean;
  isEditing: boolean;
  // Adapters must acknowledge persistence, not merely resolution of SDK calls.
  // Only a proven pre-effect refusal may throw ContactAddressWriteRefusal.
  onAddAddress: (
    fields: ContactAddressFields,
    intent: object,
    isCurrent?: () => boolean,
  ) => Promise<string | null>;
  onUpdateAddress: (
    id: string,
    patch: Partial<ContactAddressFields>,
    isCurrent?: () => boolean,
  ) => Promise<void>;
  onRemoveAddress: (id: string, isCurrent?: () => boolean) => Promise<void>;
}

async function applyAddressOperation(
  input: ContactAddressEditorInput,
  state: Extract<ContactAddressEditorState, { status: "saving" | "removing" }>,
  isCurrent: () => boolean,
) {
  if (input.disabled || !input.isEditing || input.rows === undefined)
    throw new ContactAddressWriteRefusal("Address editing is unavailable.");
  if (state.status === "removing")
    return input.onRemoveAddress(state.id, isCurrent);
  const { id, values, intent, submitted } = state.draft;
  if (
    id !== null &&
    !input.rows.some((row) => row.id === id && isContactAddressRow(row))
  )
    throw new ContactAddressWriteRefusal(
      "This address is no longer available. Reload this contact to review its current state.",
    );
  if (id === null) {
    const fields = { ...values };
    for (const { key } of CONTACT_ADDRESS_FIELD_DESCRIPTORS)
      fields[key] = fields[key].trim();
    if (!(await input.onAddAddress(fields, intent, isCurrent)))
      throw new Error("Address was not saved. Please try again.");
  } else {
    const patch = submitted ?? {};
    if (Object.keys(patch).length > 0)
      await input.onUpdateAddress(id, patch, isCurrent);
  }
}

export function useContactAddressEditor(input: ContactAddressEditorInput) {
  const [state, dispatch] = useReducer(transitionContactAddressEditor, {
    status: "idle",
  });
  const requestId = useRef(0);
  const latest = useRef(input);
  // A speculative read-only/loading render must not cancel the visible save.
  useLayoutEffect(() => {
    latest.current = input;
  }, [input]);
  const mounted = useRef(true);
  const isCurrent = useCallback(
    () =>
      mounted.current &&
      !latest.current.disabled &&
      latest.current.isEditing &&
      latest.current.rows !== undefined,
    [],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (state.status !== "saving" && state.status !== "removing") return;
    let cancelled = false;
    void applyAddressOperation(latest.current, state, isCurrent)
      .then(() => {
        if (!cancelled) dispatch({ type: "saved", requestId: state.requestId });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          dispatch({
            type:
              error instanceof ContactAddressWriteRefusal
                ? "refused"
                : "failed",
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
  }, [isCurrent, state]);
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
