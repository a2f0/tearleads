import { expect, test } from "bun:test";
import type { UserKey } from "@tearleads/client-sdk";
import { primeDocumentStore } from "@tearleads/client-sdk/stores/documents";
import {
  createDocumentsWorkflowRuntime,
  defaultDocumentsPersistence,
  deletePersistedDocument,
} from "@tearleads/client-sdk/workflows/documents";
import { createMockApiClient } from "../../../test/helpers/createMockApiClient";
import { createSqlRuntimeBase } from "../../../test/helpers/createSqlRuntime";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { APP_DOCUMENT_PROJECTOR_REGISTRY } from "../../document-types/projectors";
import { type ContactsRuntime, createContactsStore } from "./contactStore";

type SqlRuntimeBase = Awaited<ReturnType<typeof createSqlRuntimeBase>>;

interface ContactProjectionRow {
  encapsulation_public_key: unknown;
  first_name: unknown;
  last_name: unknown;
  local_id: unknown;
  user_id: unknown;
}

interface DocumentProjectionRow {
  document_kind: unknown;
  local_id: unknown;
  title: unknown;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readContactProjectionRows(rows: ContactProjectionRow[]) {
  return rows.map((row) => ({
    encapsulationPublicKey: readString(row.encapsulation_public_key),
    firstName: readString(row.first_name),
    id: readString(row.local_id),
    lastName: readString(row.last_name),
    userId: readString(row.user_id),
  }));
}

function readDocumentProjectionRows(rows: DocumentProjectionRow[]) {
  return rows.map((row) => ({
    documentKind: readString(row.document_kind),
    id: readString(row.local_id),
    title: readString(row.title),
  }));
}

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
    containerId: null,
    documentProjectors: APP_DOCUMENT_PROJECTOR_REGISTRY,
    userId: "self-user",
  });

  return {
    close,
    deleteLocalDocument: async (localId) => {
      await deletePersistedDocument({
        documentProjectors: APP_DOCUMENT_PROJECTOR_REGISTRY,
        execSql: runtimeInputBase.execSql,
        localId,
        persistence: defaultDocumentsPersistence,
      });
      return true;
    },
    documents,
    execSql: runtimeInputBase.execSql,
    primeDocumentStore: (input) =>
      primeDocumentStore(
        documents.domainScope,
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

    const contactRows = (await runtime.execSql(`
      SELECT local_id, first_name, last_name, user_id, encapsulation_public_key
      FROM contact_projection
      ORDER BY local_id
    `)) as unknown as ContactProjectionRow[];
    const contactProjections = readContactProjectionRows(contactRows);
    expect(contactRows).toHaveLength(2);
    expect(contactProjections).toContainEqual({
      encapsulationPublicKey: "",
      firstName: "Ada",
      id: createdContactId,
      lastName: "Lovelace",
      userId: "ada-user",
    });
    expect(contactProjections).toContainEqual({
      encapsulationPublicKey: peerKey.encapsulationPublicKey,
      firstName: "",
      id: peerKey.userId,
      lastName: "",
      userId: peerKey.userId,
    });

    const documentRows = (await runtime.execSql(`
      SELECT local_id, document_kind, title
      FROM document_projection
      ORDER BY local_id
    `)) as unknown as DocumentProjectionRow[];
    expect(readDocumentProjectionRows(documentRows)).toEqual([
      {
        documentKind: "contact",
        id: createdContactId,
        title: "Ada Lovelace",
      },
      {
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
