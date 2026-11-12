import { expect, test } from "bun:test";
import { defaultDocumentsPersistence } from "@tearleads/client-sdk";
import {
  CONTACTS_CONTAINER_ID,
  createRecoveryContactsRuntime,
  seedDuplicateSelfContacts,
} from "../../../test/helpers/contactStoreRecovery";
import { readContactAddressFields } from "../../document-types/contact/contactAddressModel";
import { createContactsStore } from "./contactStore";
import type { ContactsRuntime } from "./contactStoreTypes";

for (const operation of ["add", "update", "remove"] as const) {
  test(`${operation} retains its replacement target when queued during duplicate settlement`, async () => {
    const base = await createRecoveryContactsRuntime({
      signingFingerprint: "offline-self",
      userId: "self-user",
    });
    const localId = await seedDuplicateSelfContacts(base);
    const retained = base.openDocumentStore({
      localId: "recovered-self",
      initialDocumentKind: "contact",
    });
    const address = await retained.addRow({
      recordType: "postalAddress",
      street: "Main",
    });
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
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
              title: "Self",
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
      resolveVerified: async () => null,
      logError: () => {},
    });
    try {
      store.updateRuntime(runtime);
      await started.promise;
      const edit =
        operation === "add"
          ? store.addContactAddress(
              localId,
              readContactAddressFields({ street: "Other" }),
            )
          : operation === "update"
            ? store.updateContactAddress(localId, address, { street: "Other" })
            : store.removeContactAddress(localId, address);
      release.resolve();
      await edit;
      const rows = retained.getSnapshot().rows;
      if (operation === "add")
        expect(
          rows.map((row) => readContactAddressFields(row.fields).street),
        ).toEqual(["Main", "Other"]);
      if (operation === "update")
        expect(readContactAddressFields(rows[0]?.fields ?? {}).street).toBe(
          "Other",
        );
      if (operation === "remove") expect(rows).toEqual([]);
      expect(
        await defaultDocumentsPersistence.loadDocument(
          base.documents.infra.execSql,
          localId,
        ),
      ).toBeNull();
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
}
