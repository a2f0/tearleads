import { expect, test } from "bun:test";
import { defaultDocumentsPersistence } from "@tearleads/client-sdk";
import {
  CONTACTS_CONTAINER_ID,
  createRecoveryContactsRuntime,
  seedDuplicateSelfContacts,
} from "../../../test/helpers/contactStoreRecovery";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { loadProjectedContacts } from "./contactProjection";
import { type ContactsRuntime, createContactsStore } from "./contactStore";

test("an edit queued during duplicate deletion keeps its retained-contact target", async () => {
  const base = await createRecoveryContactsRuntime({
    signingFingerprint: "offline-self",
    userId: "self-user",
  });
  const localId = await seedDuplicateSelfContacts(base);
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let edit: Promise<void> | undefined;
  const runtime: ContactsRuntime = {
    ...base,
    documents: {
      ...base.documents,
      state: { ...base.documents.state, online: true },
    },
    openDocumentStore: (input) => ({
      ...base.openDocumentStore(input),
      subscribe: () => () => {},
    }),
    loadDocumentSummary: async (id) =>
      id === localId
        ? {
            id,
            containerId: CONTACTS_CONTAINER_ID,
            documentId: "remote-fallback",
            title: "self-user",
            updatedAt: "2026-09-05T00:00:00.000Z",
          }
        : null,
    purgeDocument: async () => {
      await defaultDocumentsPersistence.deleteDocument(
        base.documents.infra.execSql,
        localId,
      );
      return true;
    },
    deleteDocument: async (id) => {
      started.resolve();
      await release.promise;
      return base.deleteDocument(id);
    },
  };
  const store = createContactsStore(runtime, {
    resolveUserIdentity: async () => null,
    logError: () => {},
  });
  try {
    store.updateRuntime(runtime);
    await started.promise;
    edit = store.updateContact(localId, {
      firstName: "Queued during settlement",
    });
    release.resolve();
    await edit;
    await waitForCondition(
      () => !store.getSnapshot().entries.some((entry) => entry.id === localId),
      "Duplicate did not settle",
    );
    expect(
      (
        await loadProjectedContacts(
          base.documents.infra.execSql,
          CONTACTS_CONTAINER_ID,
        )
      ).find((entry) => entry.id === "recovered-self")?.firstName,
    ).toBe("Queued during settlement");
    expect(
      await defaultDocumentsPersistence.loadDocument(
        base.documents.infra.execSql,
        localId,
      ),
    ).toBeNull();
  } finally {
    release.resolve();
    await edit;
    store.updateRuntime({
      ...base,
      documents: {
        ...base.documents,
        infra: { ...base.documents.infra, dbStatus: "terminated" },
      },
    });
    base.close();
  }
});
