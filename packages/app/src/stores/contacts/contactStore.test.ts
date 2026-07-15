import { expect, test } from "bun:test";
import type { ResolvedUserIdentity } from "@tearleads/client-sdk";
import {
  createDocumentsWorkflowRuntime,
  defaultDocumentsPersistence,
  deletePersistedDocument,
  openDocumentStore,
} from "@tearleads/client-sdk";
import { getSQLitePersistenceRuntime } from "@tearleads/client-sdk/sqlite";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createMockApiClient } from "@tearleads/test-utils";
import { createSqlRuntimeBase } from "../../../test/helpers/createSqlRuntime";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { contactProjection } from "../../document-projectors/contactClientProjection";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../document-types/projectors";
import {
  type ContactsRuntime,
  createContactsStore,
  getSelfContactLocalId,
} from "./contactStore";

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
    loadDocumentSummary: () => Promise.resolve(null),
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
  };
}

test("contacts store persists contacts as documents with app-owned projections", async () => {
  const runtime = await createContactsRuntime();
  const peerKey: ResolvedUserIdentity = {
    encapsulationKeyFingerprint: "peer-encapsulation-fingerprint",
    encapsulationPublicKey: "peer-encapsulation-public-key",
    signingKeyFingerprint: "peer-signing-fingerprint",
    signingPublicKey: "peer-signing-public-key",
    userId: "peer-user-1",
  };
  const store = createContactsStore(runtime, {
    resolveUserIdentity: async (userId) =>
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
      nickname: "Countess",
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
        nickname: contactProjection.nickname,
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
      nickname: "Countess",
      userId: "ada-user",
    });
    expect(contactProjections).toContainEqual({
      containerId: CONTACTS_CONTAINER_ID,
      documentId: null,
      encapsulationPublicKey: peerKey.encapsulationPublicKey,
      firstName: "",
      id: peerKey.userId,
      lastName: "",
      nickname: "",
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
        title: "Countess",
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

test("contacts store imports self keys without a synthetic nickname", async () => {
  const runtime = await createContactsRuntime();
  const selfKey: ResolvedUserIdentity = {
    encapsulationKeyFingerprint: "self-encapsulation-fingerprint",
    encapsulationPublicKey: "self-encapsulation-public-key",
    signingKeyFingerprint: "self-signing-fingerprint",
    signingPublicKey: "self-signing-public-key",
    userId: "self-user",
  };
  const store = createContactsStore(runtime, {
    resolveUserIdentity: async (userId) =>
      userId === selfKey.userId ? selfKey : null,
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

    const contactId = await store.importKey(selfKey.userId);
    expect(contactId).toBe(selfKey.userId);

    await waitForCondition(
      () =>
        store
          .getSnapshot()
          .entries.some((entry) => entry.id === selfKey.userId),
      "Self contact did not appear in the store snapshot.",
    );

    expect(store.getSnapshot().entries).toContainEqual({
      canWrite: true,
      encapsulationPublicKey: selfKey.encapsulationPublicKey,
      firstName: "",
      id: selfKey.userId,
      isSelf: true,
      lastName: "",
      nickname: "",
      userId: selfKey.userId,
    });

    const documentProjections = await defaultDocumentsPersistence.listDocuments(
      runtime.documents.infra.execSql,
    );
    expect(documentProjections).toContainEqual(
      expect.objectContaining({
        id: selfKey.userId,
        title: selfKey.userId,
      }),
    );
  } finally {
    runtime.close();
  }
});

test("contacts store ensures self contact from deterministic local identity", async () => {
  const runtime = await createContactsRuntime();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const selfKey: ResolvedUserIdentity = {
    encapsulationKeyFingerprint: await toFingerprint(
      encapsulationKeyPair.publicKey,
    ),
    encapsulationPublicKey: bytesToBase64(encapsulationKeyPair.publicKey),
    signingKeyFingerprint: await toFingerprint(signingKeyPair.signingPublicKey),
    signingPublicKey: bytesToBase64(signingKeyPair.signingPublicKey),
    userId: "self-user",
  };
  const store = createContactsStore(runtime, {
    resolveUserIdentity: async () => {
      throw new Error("unexpected remote self key fetch");
    },
    getLocalUserIdentity: async (userId) =>
      userId === selfKey.userId ? selfKey : null,
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

    const selfContactId = getSelfContactLocalId(selfKey.signingKeyFingerprint);
    const provisionalContactId = await store.ensureSelfContact({
      encapsulationPublicKey: selfKey.encapsulationPublicKey,
      localId: selfContactId,
    });
    expect(provisionalContactId).toBe(selfContactId);

    await waitForCondition(
      () =>
        store
          .getSnapshot()
          .entries.some(
            (entry) => entry.id === selfContactId && entry.userId === null,
          ),
      "Self contact did not appear in the store snapshot.",
    );

    const registeredContactId = await store.ensureSelfContact({
      encapsulationPublicKey: selfKey.encapsulationPublicKey,
      localId: selfContactId,
      userId: selfKey.userId,
    });
    expect(registeredContactId).toBe(selfContactId);

    expect(store.getSnapshot().entries).toContainEqual({
      canWrite: true,
      encapsulationPublicKey: selfKey.encapsulationPublicKey,
      firstName: "",
      id: selfContactId,
      isSelf: true,
      lastName: "",
      nickname: "",
      userId: selfKey.userId,
    });

    const { db } = getSQLitePersistenceRuntime(runtime.documents.infra.execSql);
    const contactProjections = await db
      .select({
        containerId: contactProjection.containerId,
        id: contactProjection.localId,
        isSelf: contactProjection.isSelf,
        userId: contactProjection.userId,
      })
      .from(contactProjection);
    expect(contactProjections).toEqual([
      {
        containerId: CONTACTS_CONTAINER_ID,
        id: selfContactId,
        isSelf: 1,
        userId: selfKey.userId,
      },
    ]);
  } finally {
    runtime.close();
  }
});

test("contacts store does not reseed a You nickname for existing self contacts", async () => {
  const runtime = await createContactsRuntime();
  const selfKey: ResolvedUserIdentity = {
    encapsulationKeyFingerprint: "self-encapsulation-fingerprint",
    encapsulationPublicKey: "self-encapsulation-public-key",
    signingKeyFingerprint: "self-signing-fingerprint",
    signingPublicKey: "self-signing-public-key",
    userId: "self-user",
  };
  const store = createContactsStore(runtime, {
    resolveUserIdentity: async (userId) =>
      userId === selfKey.userId ? selfKey : null,
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

    const existingContactId = await store.createContact({
      firstName: "Local",
      lastName: "User",
      nickname: "",
      userId: selfKey.userId,
    });
    expect(existingContactId).not.toBeNull();

    const importedContactId = await store.importKey(selfKey.userId);
    expect(importedContactId).toBe(existingContactId);

    await waitForCondition(
      () =>
        store
          .getSnapshot()
          .entries.some(
            (entry) =>
              entry.id === existingContactId &&
              entry.isSelf &&
              entry.encapsulationPublicKey === selfKey.encapsulationPublicKey,
          ),
      "Existing self contact was not updated from key import.",
    );

    expect(
      store
        .getSnapshot()
        .entries.find((entry) => entry.id === existingContactId)?.nickname,
    ).toBe("");
  } finally {
    runtime.close();
  }
});

test("contacts store keeps live snapshots in projection order", async () => {
  const runtime = await createContactsRuntime();
  const store = createContactsStore(runtime, {
    resolveUserIdentity: async () => null,
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
    await store.createContact({
      firstName: "Carol",
      lastName: "Yellow",
      nickname: "Ace",
    });
    await store.createContact({ firstName: "Bob", lastName: "Yellow" });

    await waitForCondition(
      () => store.getSnapshot().entries.length === 3,
      "Contacts did not appear in the store snapshot.",
    );

    expect(
      store
        .getSnapshot()
        .entries.map(
          (entry) => entry.nickname || `${entry.firstName} ${entry.lastName}`,
        ),
    ).toEqual(["Ace", "Bob Yellow", "Alice Zephyr"]);
  } finally {
    runtime.close();
  }
});
