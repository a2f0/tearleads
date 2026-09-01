import { expect, test } from "bun:test";
import {
  createDocumentsWorkflowRuntime,
  type DocumentsRuntime,
} from "@tearleads/client-sdk";
import { createMockApiClient } from "@tearleads/test-utils";
import { createSqlRuntimeBase } from "../../../test/helpers/createSqlRuntime";
import { type ContactsRuntime, getOrCreateContactsStore } from "./contactStore";
import type { ContactsStoreDependencies } from "./contactStoreTypes";

function contactsRuntime(documents: DocumentsRuntime): ContactsRuntime {
  return {
    deleteDocument: () => Promise.resolve(true),
    documents,
    loadDocumentSummary: () => Promise.resolve(null),
    moveDocumentToTrash: () => Promise.resolve(null),
    openDocumentStore: () => {
      throw new Error("Unexpected document open in registry test");
    },
  };
}

test("contacts store cache isolates different containers in one domain scope", async () => {
  const runtimeBase = await createSqlRuntimeBase(
    "contacts-store-registry-test",
  );
  const { close, ...runtimeInput } = runtimeBase;
  const createDocumentsRuntime = (containerId: string | null) =>
    createDocumentsWorkflowRuntime({
      ...runtimeInput,
      apiClient: createMockApiClient(),
      state: { ...runtimeInput.state, containerId },
    });
  const personalRuntime = contactsRuntime(
    createDocumentsRuntime("personal-contacts"),
  );
  const customRuntime = contactsRuntime(
    createDocumentsRuntime("custom-contacts"),
  );
  const unavailableRuntime = contactsRuntime(createDocumentsRuntime(null));
  const dependencies: ContactsStoreDependencies = {
    resolveUserIdentity: () => Promise.resolve(null),
    logError: () => undefined,
  };

  try {
    const personalStore = getOrCreateContactsStore(
      personalRuntime.documents.state.domainScope,
      personalRuntime,
      dependencies,
    );
    const samePersonalStore = getOrCreateContactsStore(
      personalRuntime.documents.state.domainScope,
      personalRuntime,
      dependencies,
    );
    const customStore = getOrCreateContactsStore(
      customRuntime.documents.state.domainScope,
      customRuntime,
      dependencies,
    );
    const unavailableStore = getOrCreateContactsStore(
      unavailableRuntime.documents.state.domainScope,
      unavailableRuntime,
      dependencies,
    );

    expect(samePersonalStore).toBe(personalStore);
    expect(customStore).not.toBe(personalStore);
    expect(unavailableStore).not.toBe(personalStore);
    expect(unavailableStore).not.toBe(customStore);
  } finally {
    close();
  }
});
