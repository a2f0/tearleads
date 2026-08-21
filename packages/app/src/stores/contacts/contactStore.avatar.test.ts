import { expect, test } from "bun:test";
import {
  createDocumentsWorkflowRuntime,
  openDocumentStore,
} from "@symcrypt/client-sdk";
import { generateKemSeedAndKeyPair } from "@symcrypt/crypto";
import { createMockApiClient } from "@symcrypt/test-utils";
import { createSqlRuntimeBase } from "../../../test/helpers/createSqlRuntime";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../document-types/projectors";
import { type ContactsRuntime, createContactsStore } from "./contactStore";

const CONTACTS_CONTAINER_ID = "builtin-contacts-container";

// Attachment writes require an encapsulation key pair (canAttachFiles), unlike
// the structured-field tests that run without one.
async function createContactsRuntime(): Promise<
  ContactsRuntime & { close: () => void }
> {
  const runtimeBase = await createSqlRuntimeBase("contacts-avatar-test");
  const { close, ...runtimeInputBase } = runtimeBase;
  const documents = createDocumentsWorkflowRuntime({
    ...runtimeInputBase,
    apiClient: createMockApiClient(),
    auth: {
      ...runtimeInputBase.auth,
      userId: "self-user",
    },
    crypto: {
      ...runtimeInputBase.crypto,
      encapsulationKeyPair: generateKemSeedAndKeyPair(),
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
    deleteDocument: () => Promise.resolve(true),
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

test("contacts store binds, reads back, and removes a contact avatar", async () => {
  const runtime = await createContactsRuntime();
  const store = createContactsStore(runtime, {
    resolveUserIdentity: () => Promise.resolve(null),
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

    const contactId = await store.createContact({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    if (!contactId) {
      throw new Error("Contact creation returned no id.");
    }

    const avatarBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    await store.setContactAvatar(contactId, {
      bytes: avatarBytes,
      mimeType: "image/png",
      name: "avatar.png",
    });

    await waitForCondition(() => {
      const entry = store
        .getSnapshot()
        .entries.find((candidate) => candidate.id === contactId);
      return Boolean(entry?.avatar?.storageKey);
    }, "Contact avatar did not appear in the store snapshot.");

    const entry = store
      .getSnapshot()
      .entries.find((candidate) => candidate.id === contactId);
    expect(entry?.avatar?.mimeType).toBe("image/png");
    expect(entry?.avatar?.byteLength).toBe(avatarBytes.byteLength);

    const storageKey = entry?.avatar?.storageKey;
    if (!storageKey) {
      throw new Error("Avatar storage key missing.");
    }
    const storedBytes =
      await runtime.documents.infra.blobStore.readBytes(storageKey);
    expect(storedBytes).toEqual(avatarBytes);

    await store.removeContactAvatar(contactId);
    await waitForCondition(() => {
      const current = store
        .getSnapshot()
        .entries.find((candidate) => candidate.id === contactId);
      return Boolean(current) && !current?.avatar;
    }, "Contact avatar was not removed from the store snapshot.");
  } finally {
    runtime.close();
  }
});
