import { expect, test } from "bun:test";
import { defaultDocumentsPersistence } from "@tearleads/client-sdk";
import {
  createRecoveryContactsRuntime,
  seedDuplicateSelfContacts,
} from "../../../test/helpers/contactStoreRecovery";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { type ContactsRuntime, createContactsStore } from "./contactStore";

test("self import waits for canonical hydration without adopting an unnamed same-user document", async () => {
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
  const execSql = base.documents.infra.execSql;
  const before = await defaultDocumentsPersistence.loadHistoryRestoreState(
    execSql,
    "recovered-self",
  );
  expect(before).not.toBeNull();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const runtime: ContactsRuntime = {
    ...base,
    openDocumentStore: (input) => {
      const document = base.openDocumentStore(input);
      if (input.localId !== localId) return document;
      return {
        ...document,
        ensureInitialized: async () => {
          started.resolve();
          await release.promise;
          return document.ensureInitialized();
        },
      };
    },
  };
  const errors: unknown[] = [];
  const store = createContactsStore(runtime, {
    resolveVerified: async () => ({
      userId: "self-user",
      encapsulationPublicKey: "self-key",
      encapsulationKeyFingerprint: "self-kem-fingerprint",
      signingKeyFingerprint: "offline-self",
      signingPublicKey: "self-signing-key",
    }),
    logError: (message, cause) => errors.push({ message, cause }),
  });
  let importing: Promise<string | null> | undefined;
  try {
    store.updateRuntime(runtime);
    await waitForCondition(
      () => store.getSnapshot().ready,
      "Contacts not ready",
    );
    importing = store.importVerifiedUser("self-user");
    await Promise.race([
      started.promise,
      importing.then(() => {
        throw new Error("Import settled without hydrating canonical Me");
      }),
    ]);
    release.resolve();
    expect(await importing).toBe(localId);
    expect(await store.importVerifiedUser("self-user")).toBe(localId);
    expect(
      await defaultDocumentsPersistence.loadHistoryRestoreState(
        execSql,
        "recovered-self",
      ),
    ).toEqual(before);
    expect(
      store
        .getSnapshot()
        .entries.map((entry) => entry.id)
        .sort(),
    ).toEqual([localId, "recovered-self"].sort());
    expect(errors).toEqual([]);
  } finally {
    release.resolve();
    await Promise.allSettled([importing]);
    store.updateRuntime({
      ...runtime,
      documents: {
        ...runtime.documents,
        infra: { ...runtime.documents.infra, dbStatus: "terminated" },
      },
    });
    base.close();
  }
});
