import { expect, test } from "bun:test";
import type { DocumentSummary } from "@tearleads/client-sdk";
import {
  createDocumentsWorkflowRuntime,
  defaultDocumentsPersistence,
  deletePersistedDocument,
  openDocumentStore,
} from "@tearleads/client-sdk";
import { createMockApiClient } from "@tearleads/test-utils";
import { createSqlRuntimeBase } from "../../../test/helpers/createSqlRuntime";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../document-types/projectors";
import { type ContactsRuntime, createContactsStore } from "./contactStore";

const CONTACTS_CONTAINER_ID = "builtin-contacts-container";
const TRASH_CONTAINER_ID = "builtin-trash-container";

async function createContactsRuntime(): Promise<
  ContactsRuntime & { close: () => void }
> {
  const runtimeBase = await createSqlRuntimeBase(
    "contacts-store-remove-contact-test",
  );
  const { close, ...runtimeInputBase } = runtimeBase;
  const documents = createDocumentsWorkflowRuntime({
    ...runtimeInputBase,
    apiClient: createMockApiClient(),
    auth: {
      ...runtimeInputBase.auth,
      userId: "self-user",
    },
    infra: {
      ...runtimeInputBase.infra,
      documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
    },
    state: {
      ...runtimeInputBase.state,
      containerId: CONTACTS_CONTAINER_ID,
    },
  });

  return {
    close,
    deleteDocument: async (localId) => {
      await deletePersistedDocument({
        documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
        execSql: runtimeInputBase.infra.execSql,
        localId,
        persistence: defaultDocumentsPersistence,
      });
      return true;
    },
    documents,
    moveDocumentToTrash: () => Promise.resolve(null),
    openDocumentStore: (input) =>
      openDocumentStore(
        documents.state.domainScope,
        input.localId,
        documents,
        input.documentId ?? null,
        input.initialText,
        input.initialDocumentKind,
      ),
    trashContainerId: TRASH_CONTAINER_ID,
  };
}

async function movePersistedDocumentToTrash(
  runtime: ContactsRuntime,
  note: DocumentSummary,
  trashContainerId: string,
): Promise<DocumentSummary | null> {
  const existingDocument = await defaultDocumentsPersistence.loadDocument(
    runtime.documents.infra.execSql,
    note.id,
  );
  if (!existingDocument) {
    return null;
  }

  return defaultDocumentsPersistence.relinkPersistedDocument(
    runtime.documents.infra.execSql,
    {
      accessEpoch: existingDocument.accessEpoch,
      containerId: trashContainerId,
      documentId: note.documentId,
      localId: note.id,
    },
  );
}

function createStore(runtime: ContactsRuntime) {
  return createContactsStore(runtime, {
    fetchUserKey: async () => null,
    logError: (message, cause) => {
      throw new Error(String(message), { cause });
    },
  });
}

async function createContact(
  store: ReturnType<typeof createContactsStore>,
  patch: { firstName: string; lastName: string },
): Promise<string> {
  const contactId = await store.createContact(patch);
  if (!contactId) {
    throw new Error("Contact creation returned no id.");
  }
  await waitForCondition(
    () => store.getSnapshot().entries.some((entry) => entry.id === contactId),
    "Contact did not appear in the store snapshot.",
  );

  return contactId;
}

async function waitForContactRemoval(
  store: ReturnType<typeof createContactsStore>,
  contactId: string,
): Promise<void> {
  await waitForCondition(
    () => !store.getSnapshot().entries.some((entry) => entry.id === contactId),
    "Contact was not removed from the store snapshot.",
  );
}

test("contacts store moves removed local-only contacts to trash", async () => {
  const runtime = await createContactsRuntime();
  const movedDocuments: Array<{
    note: DocumentSummary;
    trashContainerId: string;
  }> = [];
  let deletedDocumentCount = 0;
  runtime.deleteDocument = async () => {
    deletedDocumentCount += 1;
    return true;
  };
  runtime.moveDocumentToTrash = async (note, trashContainerId) => {
    movedDocuments.push({ note, trashContainerId });
    return movePersistedDocumentToTrash(runtime, note, trashContainerId);
  };
  const store = createStore(runtime);

  try {
    store.updateRuntime(runtime);
    await waitForCondition(
      () => store.getSnapshot().ready,
      "Contacts store did not initialize.",
    );

    const contactId = await createContact(store, {
      firstName: "Ada",
      lastName: "Lovelace",
    });

    await store.removeContact(contactId);

    await waitForContactRemoval(store, contactId);
    expect(deletedDocumentCount).toBe(0);
    expect(movedDocuments).toEqual([
      {
        note: expect.objectContaining({
          containerId: CONTACTS_CONTAINER_ID,
          documentId: null,
          documentKind: "contact",
          id: contactId,
        }),
        trashContainerId: TRASH_CONTAINER_ID,
      },
    ]);

    const document = await defaultDocumentsPersistence.loadDocument(
      runtime.documents.infra.execSql,
      contactId,
    );
    expect(document).toEqual(
      expect.objectContaining({
        containerId: TRASH_CONTAINER_ID,
        documentId: null,
        documentKind: "contact",
      }),
    );
  } finally {
    runtime.close();
  }
});

test("contacts store moves removed synced contacts to trash without direct delete", async () => {
  const runtime = await createContactsRuntime();
  const movedDocuments: Array<{
    note: DocumentSummary;
    trashContainerId: string;
  }> = [];
  let deletedDocumentCount = 0;
  runtime.deleteDocument = async () => {
    deletedDocumentCount += 1;
    return true;
  };
  runtime.moveDocumentToTrash = async (note, trashContainerId) => {
    movedDocuments.push({ note, trashContainerId });
    return movePersistedDocumentToTrash(runtime, note, trashContainerId);
  };
  const store = createStore(runtime);

  try {
    store.updateRuntime(runtime);
    await waitForCondition(
      () => store.getSnapshot().ready,
      "Contacts store did not initialize.",
    );

    const contactId = await createContact(store, {
      firstName: "Grace",
      lastName: "Hopper",
    });
    const existingDocument = await defaultDocumentsPersistence.loadDocument(
      runtime.documents.infra.execSql,
      contactId,
    );
    if (!existingDocument) {
      throw new Error("Contact document was not persisted.");
    }
    await defaultDocumentsPersistence.saveDocument(
      runtime.documents.infra.execSql,
      {
        ...existingDocument,
        documentId: "remote-contact-document",
      },
    );

    await store.removeContact(contactId);

    await waitForContactRemoval(store, contactId);
    expect(deletedDocumentCount).toBe(0);
    expect(movedDocuments).toEqual([
      {
        note: expect.objectContaining({
          containerId: CONTACTS_CONTAINER_ID,
          documentId: "remote-contact-document",
          documentKind: "contact",
          id: contactId,
        }),
        trashContainerId: TRASH_CONTAINER_ID,
      },
    ]);

    const document = await defaultDocumentsPersistence.loadDocument(
      runtime.documents.infra.execSql,
      contactId,
    );
    expect(document).toEqual(
      expect.objectContaining({
        containerId: TRASH_CONTAINER_ID,
        documentId: "remote-contact-document",
        documentKind: "contact",
      }),
    );
  } finally {
    runtime.close();
  }
});
