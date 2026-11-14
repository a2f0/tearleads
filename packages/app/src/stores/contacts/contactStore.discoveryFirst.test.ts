import { expect, test } from "bun:test";
import {
  createDocumentStore,
  defaultDocumentsPersistence,
  deriveStableDocumentId,
  type ResolvedUserIdentity,
} from "@tearleads/client-sdk";
import { emptyVersionVector } from "@tearleads/loro";
import {
  CONTACTS_CONTAINER_ID,
  createRecoveryContactsRuntime,
} from "../../../test/helpers/contactStoreRecovery";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { createContactsStore, getSelfContactLocalId } from "./contactStore";

const SELF: ResolvedUserIdentity = {
  encapsulationKeyFingerprint: "discovery-first-kem-fingerprint",
  encapsulationPublicKey: "discovery-first-kem-key",
  signingKeyFingerprint: "discovery-first-self",
  signingPublicKey: "discovery-first-signing-key",
  userId: "discovery-first-user",
};

test("contact creation does not acknowledge a refused store open", async () => {
  const runtime = await createRecoveryContactsRuntime({
    runtimeKey: "contact-create-refusal",
    signingFingerprint: SELF.signingKeyFingerprint,
    userId: SELF.userId,
  });
  const refusal = new Error("Store is unavailable");
  const errors: unknown[] = [];
  const store = createContactsStore(
    {
      ...runtime,
      openDocumentStore: () => {
        throw refusal;
      },
    },
    {
      logError: (_message, cause) => errors.push(cause),
      resolveVerified: async () => null,
    },
  );
  try {
    expect(await store.createContact({ firstName: "Not saved" })).toBeNull();
    expect(errors).toEqual([refusal]);
  } finally {
    runtime.close();
  }
});

for (const [shell, snapshotEndVersion] of [
  ["unopened", ""],
  ["opened", emptyVersionVector()],
] as const) {
  for (const operation of ["bootstrap", "import"] as const) {
    test(`self ${operation} refuses an ${shell} shell and retries the hydrated backing record`, async () => {
      const runtime = await createRecoveryContactsRuntime({
        runtimeKey: `discovery-first-contact-${operation}-${shell}`,
        signingFingerprint: SELF.signingKeyFingerprint,
        userId: SELF.userId,
      });
      const errors: unknown[] = [];
      const store = createContactsStore(runtime, {
        logError: (message, cause) => errors.push({ message, cause }),
        resolveVerified: async () => SELF,
      });
      const execSql = runtime.documents.infra.execSql;
      const localId = getSelfContactLocalId(SELF.signingKeyFingerprint);
      const documentId = await deriveStableDocumentId(localId);
      const ensure = () =>
        operation === "import"
          ? store.importVerifiedUser(SELF.userId)
          : store.ensureSelfContact({
              deferRemoteSync: true,
              encapsulationPublicKey: SELF.encapsulationPublicKey,
              localId,
              userId: SELF.userId,
            });
      try {
        await defaultDocumentsPersistence.upsertDiscoveredDocument(execSql, {
          accessEpoch: 1,
          containerId: CONTACTS_CONTAINER_ID,
          createdAt: "2026-11-01T00:00:00.000Z",
          documentId,
          effectiveAccessLevel: "write",
          linkedContainerIds: [CONTACTS_CONTAINER_ID],
        });
        const before = await defaultDocumentsPersistence.loadDocument(
          execSql,
          documentId,
        );
        if (!before) throw new Error("Discovery did not create its shell");
        // Opening a still-unhydrated shell can persist a nonempty encoding of
        // the empty frontier; string length does not prove content exists.
        before.snapshotEndVersion = snapshotEndVersion;
        await defaultDocumentsPersistence.saveDocument(execSql, before);
        store.updateRuntime(runtime);
        const refused = await ensure();
        expect(refused).toBeNull();
        expect(
          await defaultDocumentsPersistence.loadDocument(execSql, localId),
        ).toBeNull();
        expect(
          await defaultDocumentsPersistence.loadDocument(execSql, documentId),
        ).toEqual(before);

        // Exercise ordinary local publication after the discovery shell gains
        // content. This is a real SQLite/store retry, not proof of authenticated
        // remote hydration or permission to rebind the canonical facade.
        const backing = runtime.openDocumentStore({
          documentId,
          localId: documentId,
        });
        await backing.setStructuredFields("contact", {
          encapsulationPublicKey: SELF.encapsulationPublicKey,
          firstName: "Existing",
          isSelf: "1",
          userId: SELF.userId,
        });
        const addressId = await backing.addRow({
          label: "Home",
          recordType: "postalAddress",
          street: "12 Existing Street",
        });
        await waitForCondition(
          () =>
            store
              .getSnapshot()
              .entries.some((entry) => entry.id === documentId),
          "Hydrated self contact was not published",
        );
        expect(await ensure()).toBe(documentId);
        await store.updateContact(documentId, { nickname: "Recovered" });
        expect(store.getSnapshot().entries.map((entry) => entry.id)).toEqual([
          documentId,
        ]);
        expect(
          await defaultDocumentsPersistence.loadDocument(execSql, localId),
        ).toBeNull();
        const reopened = createDocumentStore(
          documentId,
          runtime.documents,
          defaultDocumentsPersistence,
          documentId,
        );
        expect(await reopened.ensureInitialized()).toBe(true);
        expect(reopened.getSnapshot()).toMatchObject({
          documentId,
          structuredFields: { firstName: "Existing", nickname: "Recovered" },
          rows: [{ id: addressId, fields: { street: "12 Existing Street" } }],
        });
        expect(errors).toEqual([]);
      } finally {
        runtime.close();
      }
    });
  }
}
