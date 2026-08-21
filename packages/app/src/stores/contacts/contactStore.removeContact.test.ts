import { expect, test } from "bun:test";
import type { DocumentSummary } from "@symcrypt/client-sdk";
import {
  createDocumentsWorkflowRuntime,
  defaultDocumentsPersistence,
  deletePersistedDocument,
  openDocumentStore,
} from "@symcrypt/client-sdk";
import { createMockApiClient } from "@symcrypt/test-utils";
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
    loadDocumentSummary: (localId) =>
      loadContactDocumentSummaryForTest(documents, localId),
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
    resolveTrashContainerForDocument: async () => TRASH_CONTAINER_ID,
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

async function loadContactDocumentSummaryForTest(
  documents: ContactsRuntime["documents"],
  localId: string,
): Promise<DocumentSummary | null> {
  const containerId = documents.state.containerId;
  if (!containerId) {
    return null;
  }

  const documentSummaries =
    await defaultDocumentsPersistence.listDocumentsByContainerIdsOrDocumentIds(
      documents.infra.execSql,
      {
        containerIds: [containerId],
        documentIds: [],
      },
    );
  return (
    documentSummaries.find(
      (documentSummary) => documentSummary.id === localId,
    ) ?? null
  );
}

function createStore(runtime: ContactsRuntime) {
  return createContactsStore(runtime, {
    resolveUserIdentity: async () => null,
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

test("contacts store leaves a contact in place when no Trash can be resolved", async () => {
  const runtime = await createContactsRuntime();
  runtime.resolveTrashContainerForDocument = async () => null;
  let moveCount = 0;
  runtime.moveDocumentToTrash = async () => {
    moveCount += 1;
    return null;
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

    // No Trash resolved -> removal is a no-op (matching the Explorer): the contact
    // is neither moved nor dropped, and its document keeps its container.
    expect(moveCount).toBe(0);
    expect(
      store.getSnapshot().entries.some((entry) => entry.id === contactId),
    ).toBe(true);
    expect(
      await defaultDocumentsPersistence.loadDocument(
        runtime.documents.infra.execSql,
        contactId,
      ),
    ).toEqual(expect.objectContaining({ containerId: CONTACTS_CONTAINER_ID }));
  } finally {
    runtime.close();
  }
});
