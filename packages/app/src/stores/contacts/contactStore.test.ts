import { expect, test } from "bun:test";
import type { UserKey } from "@tearleads/client-sdk";
import {
  createDocumentsWorkflowRuntime,
  defaultDocumentsPersistence,
  deletePersistedDocument,
  primeDocumentStore,
} from "@tearleads/client-sdk";
import { getSQLitePersistenceRuntime } from "@tearleads/client-sdk/sqlite";
import { createMockApiClient } from "@tearleads/test-utils";
import { createSqlRuntimeBase } from "../../../test/helpers/createSqlRuntime";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import {
  APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  contactProjection,
} from "../../document-types/projectors";
import { type ContactsRuntime, createContactsStore } from "./contactStore";

type SqlRuntimeBase = Awaited<ReturnType<typeof createSqlRuntimeBase>>;
const CONTACTS_CONTAINER_ID = "builtin-contacts-container";

async function createContactsRuntime(): Promise<
  ContactsRuntime & { close: () => void }
> {
  const runtimeBase: SqlRuntimeBase = await createSqlRuntimeBase(
    "contacts-store-test",
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
    deleteLocalDocument: async (localId) => {
      await deletePersistedDocument({
        documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
        execSql: runtimeInputBase.infra.execSql,
        localId,
        persistence: defaultDocumentsPersistence,
      });
      return true;
    },
    documents,
    primeDocumentStore: (input) =>
      primeDocumentStore(
        documents.state.domainScope,
        input.localId,
        documents,
        input.documentId ?? null,
        input.initialText,
        input.initialDocumentKind,
      ),
  };
}

test("contacts store persists contacts as documents with app-owned projections", async () => {
  const runtime = await createContactsRuntime();
  const peerKey: UserKey = {
    encapsulationPublicKey: "peer-encapsulation-public-key",
    signingKeyFingerprint: "peer-signing-fingerprint",
    signingPublicKey: "peer-signing-public-key",
    userId: "peer-user-1",
  };
  const store = createContactsStore(runtime, {
    fetchUserKey: async (userId) =>
      userId === peerKey.userId ? peerKey : null,
    logError: (message, cause) => {
      throw new Error(String(message), { cause });
    },
  });

  try {
    store.updateRuntime(runtime);
    await waitForCondition(
      () => store.getSnapshot().ready,
      "Contacts store did not initialize.",
    );

    const createdContactId = await store.createContact({
      firstName: "Ada",
      lastName: "Lovelace",
      userId: "ada-user",
    });
    const importedContactId = await store.importKey(peerKey.userId);

    if (!createdContactId) {
      throw new Error("Contact creation returned no id.");
    }
    if (!importedContactId) {
      throw new Error("Contact import returned no id.");
    }
    expect(importedContactId).toBe(peerKey.userId);
    await waitForCondition(
      () =>
        store
          .getSnapshot()
          .entries.some((entry) => entry.firstName === "Ada") &&
        store
          .getSnapshot()
          .entries.some((entry) => entry.userId === peerKey.userId),
      "Contacts did not appear in the store snapshot.",
    );

    const { db } = getSQLitePersistenceRuntime(runtime.documents.infra.execSql);
    const contactProjections = await db
      .select({
        containerId: contactProjection.containerId,
        documentId: contactProjection.documentId,
        encapsulationPublicKey: contactProjection.encapsulationPublicKey,
        firstName: contactProjection.firstName,
        id: contactProjection.localId,
        lastName: contactProjection.lastName,
        userId: contactProjection.userId,
      })
      .from(contactProjection)
      .orderBy(contactProjection.localId);
    expect(contactProjections).toHaveLength(2);
    expect(contactProjections).toContainEqual({
      containerId: CONTACTS_CONTAINER_ID,
      documentId: null,
      encapsulationPublicKey: null,
      firstName: "Ada",
      id: createdContactId,
      lastName: "Lovelace",
      userId: "ada-user",
    });
    expect(contactProjections).toContainEqual({
      containerId: CONTACTS_CONTAINER_ID,
      documentId: null,
      encapsulationPublicKey: peerKey.encapsulationPublicKey,
      firstName: "",
      id: peerKey.userId,
      lastName: "",
      userId: peerKey.userId,
    });

    const documentProjections = await defaultDocumentsPersistence.listDocuments(
      runtime.documents.infra.execSql,
    );
    expect(
      documentProjections
        .map((row) => ({
          documentKind: row.documentKind,
          containerId: row.containerId,
          id: row.id,
          title: row.title,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    ).toEqual([
      {
        containerId: CONTACTS_CONTAINER_ID,
        documentKind: "contact",
        id: createdContactId,
        title: "Ada Lovelace",
      },
      {
        containerId: CONTACTS_CONTAINER_ID,
        documentKind: "contact",
        id: peerKey.userId,
        title: peerKey.userId,
      },
    ]);
  } finally {
    runtime.close();
  }
});

test("contacts store keeps live snapshots in projection order", async () => {
  const runtime = await createContactsRuntime();
  const store = createContactsStore(runtime, {
    fetchUserKey: async () => null,
    logError: (message, cause) => {
      throw new Error(String(message), { cause });
    },
  });

  try {
    store.updateRuntime(runtime);
    await waitForCondition(
      () => store.getSnapshot().ready,
      "Contacts store did not initialize.",
    );

    await store.createContact({ firstName: "Alice", lastName: "Zephyr" });
    await store.createContact({ firstName: "Carol", lastName: "Yellow" });
    await store.createContact({ firstName: "Bob", lastName: "Yellow" });

    await waitForCondition(
      () => store.getSnapshot().entries.length === 3,
      "Contacts did not appear in the store snapshot.",
    );

    expect(
      store
        .getSnapshot()
        .entries.map((entry) => `${entry.firstName} ${entry.lastName}`),
    ).toEqual(["Bob Yellow", "Carol Yellow", "Alice Zephyr"]);
  } finally {
    runtime.close();
  }
});
