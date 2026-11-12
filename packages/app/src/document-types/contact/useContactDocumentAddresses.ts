import type { DocumentStore } from "@tearleads/client-sdk";
import { useContext, useEffect, useMemo, useRef } from "react";
import {
  addContactAddressRow,
  removeContactAddressRow,
  updateContactAddressRow,
} from "../../stores/documents/contactAddressWrites";
import {
  DocumentContext,
  DocumentWriteScopeContext,
  useDocumentReadOnly,
} from "../../stores/documents/DocumentsProvider";
import type { ContactAddressFields } from "./contactAddressModel";

function createAddressActions(store: DocumentStore, current: () => boolean) {
  return {
    onAddAddress: (
      fields: ContactAddressFields,
      intent: object = {},
      isCurrent: () => boolean = () => true,
    ) =>
      addContactAddressRow(
        store,
        fields,
        intent,
        () => current() && isCurrent(),
      ),
    onUpdateAddress: (
      id: string,
      patch: Partial<ContactAddressFields>,
      isCurrent: () => boolean = () => true,
    ) =>
      updateContactAddressRow(store, id, patch, () => current() && isCurrent()),
    onRemoveAddress: (id: string, isCurrent: () => boolean = () => true) =>
      removeContactAddressRow(store, id, () => current() && isCurrent()),
  };
}

export function useContactDocumentAddresses() {
  const store = useContext(DocumentContext);
  const readOnly = useDocumentReadOnly();
  const writeScope = useContext(DocumentWriteScopeContext);
  const current = useRef({ store, readOnly });
  const identity = useRef({ store, writeScope, version: 0 });
  if (
    identity.current.store !== store ||
    identity.current.writeScope !== writeScope
  )
    identity.current = {
      store,
      writeScope,
      version: identity.current.version + 1,
    };
  current.current = { store, readOnly };
  const lifetime = useMemo(
    () => ({ active: true, store, writeScope }),
    [store, writeScope],
  );
  useEffect(() => {
    lifetime.active = true;
    return () => {
      lifetime.active = false;
    };
  }, [lifetime]);
  const actions = useMemo(() => {
    if (!store) throw new Error("Contact addresses require a document store.");
    const captured = identity.current;
    return createAddressActions(
      store,
      () =>
        lifetime.active &&
        identity.current === captured &&
        current.current.store === store &&
        !current.current.readOnly,
    );
  }, [lifetime, store]);
  return { actions, identityKey: identity.current.version };
}
