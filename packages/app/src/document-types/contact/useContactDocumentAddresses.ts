import type { DocumentRow, DocumentStore } from "@tearleads/client-sdk";
import { useContext, useMemo, useRef } from "react";
import {
  DocumentContext,
  useDocumentReadOnly,
} from "../../stores/documents/DocumentsProvider";
import {
  CONTACT_ADDRESS_ROW_TYPE,
  type ContactAddressFields,
  isContactAddressRow,
} from "./contactAddressModel";

const SAVE_FAILURE = "Address changes could not be saved. Please try again.";

function createAddressActions(
  store: DocumentStore,
  isCurrentWritable: () => boolean,
) {
  function snapshot() {
    const current = store.getSnapshot();
    if (!isCurrentWritable() || !current.ready || !current.canWrite)
      throw new Error(SAVE_FAILURE);
    return current;
  }
  function existingAddress(id: string) {
    const row = snapshot().rows.find((entry) => entry.id === id);
    if (!row || !isContactAddressRow(row)) throw new Error(SAVE_FAILURE);
    return row;
  }
  function acknowledged(
    matches: (rows: ReadonlyArray<DocumentRow>) => boolean,
  ) {
    const current = snapshot();
    if (store.hasUnsavedLocalEdits() || !matches(current.rows))
      throw new Error(SAVE_FAILURE);
  }
  function matchesFields(
    row: DocumentRow | undefined,
    fields: Partial<ContactAddressFields>,
  ) {
    return (
      row !== undefined &&
      isContactAddressRow(row) &&
      Object.entries(fields).every(([key, value]) => row.fields[key] === value)
    );
  }
  return {
    onAddAddress: async (fields: ContactAddressFields) => {
      snapshot();
      const id = await store.addRow({
        ...fields,
        recordType: CONTACT_ADDRESS_ROW_TYPE,
      });
      acknowledged((rows) =>
        matchesFields(
          rows.find((row) => row.id === id),
          fields,
        ),
      );
      return id;
    },
    onUpdateAddress: async (
      id: string,
      patch: Partial<ContactAddressFields>,
    ) => {
      existingAddress(id);
      await store.updateRowFields(id, patch);
      acknowledged((rows) =>
        matchesFields(
          rows.find((row) => row.id === id),
          patch,
        ),
      );
    },
    onRemoveAddress: async (id: string) => {
      existingAddress(id);
      await store.removeRow(id);
      acknowledged((rows) => !rows.some((row) => row.id === id));
    },
  };
}

export function useContactDocumentAddresses() {
  const store = useContext(DocumentContext);
  const readOnly = useDocumentReadOnly();
  const current = useRef({ store, readOnly });
  const identity = useRef({ store, version: 0 });
  if (identity.current.store !== store)
    identity.current = { store, version: identity.current.version + 1 };
  current.current = { store, readOnly };
  const actions = useMemo(() => {
    if (!store) throw new Error("Contact addresses require a document store.");
    return createAddressActions(
      store,
      () => current.current.store === store && !current.current.readOnly,
    );
  }, [store]);
  return { actions, identityKey: identity.current.version };
}
