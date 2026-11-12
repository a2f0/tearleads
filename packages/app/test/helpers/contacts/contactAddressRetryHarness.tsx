import { expect } from "bun:test";
import {
  createDomainScope,
  type DocumentStore,
  defaultDocumentsPersistence,
  openDocumentStore,
} from "@tearleads/client-sdk";
import { renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import {
  type ContactAddressFields,
  readContactAddressFields,
} from "../../../src/document-types/contact/contactAddressModel";
import { useContactDocumentAddresses } from "../../../src/document-types/contact/useContactDocumentAddresses";
import {
  DocumentContext,
  DocumentReadOnlyContext,
  DocumentWriteScopeContext,
} from "../../../src/stores/documents/DocumentsProvider";
import { createContactAddressHarness } from "./contactAddressHarness";

export const retryFields = readContactAddressFields({
  street: "1 Main Street",
  postalCode: "00123",
});
export const addressSurfaces = ["contacts", "explorer"] as const;

export async function createAddressRetryHarness(
  surface: (typeof addressSurfaces)[number],
  wrap: (store: DocumentStore) => DocumentStore = (store) => store,
) {
  const generatedIds: string[] = [];
  const h = await createContactAddressHarness((store) =>
    wrap({
      ...store,
      async addRow(fields) {
        const id = await store.addRow(fields);
        generatedIds.push(id);
        return id;
      },
    }),
  );
  const contactId = await h.store.createContact({ firstName: "Ada" });
  if (!contactId) throw new Error("Missing contact");
  const document = h.documentStores.get(contactId);
  if (!document) throw new Error("Missing document");
  let writeScope: object = {};
  let readOnly = false;
  const hook =
    surface === "explorer"
      ? renderHook(useContactDocumentAddresses, {
          wrapper: ({ children }: PropsWithChildren) => (
            <DocumentWriteScopeContext.Provider value={writeScope}>
              <DocumentContext.Provider value={document}>
                <DocumentReadOnlyContext.Provider value={readOnly}>
                  {children}
                </DocumentReadOnlyContext.Provider>
              </DocumentContext.Provider>
            </DocumentWriteScopeContext.Provider>
          ),
        })
      : null;
  const originalCommit = defaultDocumentsPersistence.commitDocumentMutation;
  let failuresRemaining = 0;
  let commitsBeforeFailure = 0;
  let failures = 0;
  defaultDocumentsPersistence.commitDocumentMutation = async (...args) => {
    if (commitsBeforeFailure > 0) commitsBeforeFailure -= 1;
    else if (failuresRemaining > 0) {
      failuresRemaining -= 1;
      failures += 1;
      throw new Error("Injected address storage failure");
    }
    return originalCommit(...args);
  };
  const actions = {
    onAddAddress: (
      fields: ContactAddressFields,
      intent: object = {},
      isCurrent?: () => boolean,
    ) =>
      hook
        ? hook.result.current.actions.onAddAddress(fields, intent, isCurrent)
        : h.store.addContactAddress(contactId, fields, intent, isCurrent),
    onUpdateAddress: (
      id: string,
      patch: Partial<ContactAddressFields>,
      isCurrent?: () => boolean,
    ) =>
      hook
        ? hook.result.current.actions.onUpdateAddress(id, patch, isCurrent)
        : h.store.updateContactAddress(contactId, id, patch, isCurrent),
    onRemoveAddress: (id: string, isCurrent?: () => boolean) =>
      hook
        ? hook.result.current.actions.onRemoveAddress(id, isCurrent)
        : h.store.removeContactAddress(contactId, id, isCurrent),
  };
  return {
    ...h,
    contactId,
    document,
    generatedIds,
    actions,
    hook,
    changeWriteScope() {
      writeScope = {};
      hook?.rerender();
    },
    makeReadOnly() {
      readOnly = true;
      hook?.rerender();
    },
    fail(count = 1, afterCommits = 0) {
      failuresRemaining = count;
      commitsBeforeFailure = afterCommits;
    },
    failures: () => failures,
    async reopen() {
      const runtime = h.runtime.documents;
      const domainScope = createDomainScope();
      const fresh = openDocumentStore(
        domainScope,
        contactId,
        {
          ...runtime,
          state: { ...runtime.state, domainScope },
        },
        null,
        undefined,
        "contact",
      );
      expect(await fresh.ensureInitialized()).toBe(true);
      expect(fresh.hasUnsavedLocalEdits()).toBe(false);
      return fresh.getSnapshot();
    },
    close() {
      defaultDocumentsPersistence.commitDocumentMutation = originalCommit;
      hook?.unmount();
      h.close();
    },
  };
}
