import { expect, test } from "bun:test";
import {
  createDocumentStore,
  createDocumentsWorkflowRuntime,
  openDocumentStore,
} from "@tearleads/client-sdk";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createMockApiClient } from "@tearleads/test-utils";
import { createSqlRuntimeBase } from "../../../test/helpers/createSqlRuntime";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { CONTACT_PHOTOS } from "../../document-types/contact/contactDocumentDefinition";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../document-types/projectors";
import {
  AVATAR_PHOTO_FIELD,
  isDocumentPhoto,
  selectDocumentAvatar,
} from "../../document-types/shared/documentPhotos";
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
    documents,
    listPendingWrites: async () => [],
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

test("switching and clearing a contact avatar preserves both original photos after reopening", async () => {
  const runtime = await createContactsRuntime();
  const store = createContactsStore(runtime, {
    resolveVerified: () => Promise.resolve(null),
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

    const document = store.getContactDocumentStore(contactId);
    if (!document) throw new Error("Missing contact document");
    const original = new Uint8Array([1, 2, 3]);
    const crop = new Uint8Array([4, 5]);
    const upload = (name: string, bytes: Uint8Array<ArrayBuffer>) =>
      selectDocumentAvatar(document, "contact", CONTACT_PHOTOS, {
        photo: { bytes, name, mimeType: "image/jpeg" },
        crop: new Blob([crop], { type: "image/png" }),
      });
    const avatar = () =>
      store.getSnapshot().entries.find((entry) => entry.id === contactId)
        ?.avatar;
    await upload("portrait.jpg", original);
    await waitForCondition(
      () => Boolean(avatar()?.storageKey),
      "Avatar crop did not appear",
    );
    expect(avatar()?.mimeType).toBe("image/png");
    expect(
      await runtime.documents.infra.blobStore.readBytes(
        avatar()?.storageKey ?? "",
      ),
    ).toEqual(crop);
    const firstSlot =
      document.getSnapshot().structuredFields[AVATAR_PHOTO_FIELD];
    if (!firstSlot) throw new Error("Missing initial selection");
    await upload("second.jpg", new Uint8Array([6, 7]));
    const secondSlot =
      document.getSnapshot().structuredFields[AVATAR_PHOTO_FIELD];
    expect(secondSlot).toBeTruthy();
    expect(secondSlot).not.toBe(firstSlot);
    await selectDocumentAvatar(document, "contact", CONTACT_PHOTOS, {
      slotId: firstSlot,
    });
    expect(document.getSnapshot().structuredFields[AVATAR_PHOTO_FIELD]).toBe(
      firstSlot,
    );
    await selectDocumentAvatar(document, "contact", CONTACT_PHOTOS, null);
    await waitForCondition(() => !avatar(), "Avatar was not cleared");
    const reopened = createDocumentStore(contactId, runtime.documents);
    expect(await reopened.ensureInitialized()).toBe(true);
    const after = reopened.getSnapshot();
    expect(after.structuredFields[AVATAR_PHOTO_FIELD]).toBeFalsy();
    expect(
      after.attachments
        .filter((item) => isDocumentPhoto(CONTACT_PHOTOS, item))
        .map((item) => item.name)
        .sort(),
    ).toEqual(["portrait.jpg", "second.jpg"]);
    expect(
      await runtime.documents.infra.blobStore.readBytes(
        after.attachmentStorageKeyBySlotId[firstSlot] ?? "",
      ),
    ).toEqual(original);
    expect(
      await runtime.documents.infra.blobStore.readBytes(
        after.attachmentStorageKeyBySlotId[secondSlot ?? ""] ?? "",
      ),
    ).toEqual(new Uint8Array([6, 7]));
  } finally {
    runtime.close();
  }
});
