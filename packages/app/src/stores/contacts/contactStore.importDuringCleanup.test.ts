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

test("importing a self key during purge retains the surviving unnamed contact", async () => {
  const base = await createRecoveryContactsRuntime({
    signingFingerprint: "offline-self",
    userId: "self-user",
  });
  const localId = await seedDuplicateSelfContacts(base);
  await base
    .openDocumentStore({ localId: "recovered-self" })
    .setStructuredFields(
      "contact",
      { firstName: "" },
      { deferRemoteSync: true },
    );
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const purged: string[] = [];
  const runtime: ContactsRuntime = {
    ...base,
    documents: {
      ...base.documents,
      state: { ...base.documents.state, online: true },
    },
    loadDocumentSummary: async (id) =>
      (await defaultDocumentsPersistence.loadDocument(
        base.documents.infra.execSql,
        id,
      ))
        ? {
            id,
            containerId: CONTACTS_CONTAINER_ID,
            documentId: `remote-${id}`,
            title: "self-user",
            updatedAt: "2026-09-05T00:00:00.000Z",
          }
        : null,
    purgeDocument: async (summary) => {
      purged.push(summary.id);
      started.resolve();
      await release.promise;
      await base.deleteDocument(summary.id);
      return true;
    },
  };
  const store = createContactsStore(runtime, {
    resolveUserIdentity: async () => ({
      userId: "self-user",
      encapsulationPublicKey: "self-key",
      encapsulationKeyFingerprint: "self-kem-fingerprint",
      signingKeyFingerprint: "offline-self",
      signingPublicKey: "self-signing-key",
    }),
    logError: () => {},
  });
  try {
    store.updateRuntime(runtime);
    await started.promise;
    let imported: string | null | undefined;
    const importing = store.importKey("self-user").then((id) => {
      imported = id;
    });
    await waitForCondition(
      () => imported !== undefined,
      "Key import waited for duplicate purge",
    );
    await importing;
    expect(imported).toBe("recovered-self");
    expect(purged).toEqual([localId]);
    release.resolve();
    await waitForCondition(
      () => !store.getSnapshot().entries.some((entry) => entry.id === localId),
      "Fallback purge did not settle",
    );
    const contacts = await loadProjectedContacts(
      base.documents.infra.execSql,
      CONTACTS_CONTAINER_ID,
    );
    expect(contacts.map((entry) => entry.id)).toEqual(["recovered-self"]);
    expect(contacts[0]?.encapsulationPublicKey).toBe("self-key");
    expect(purged).toEqual([localId]);
  } finally {
    release.resolve();
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
