import { expect, test } from "bun:test";
import { defaultDocumentsPersistence } from "@tearleads/client-sdk";
import {
  CONTACTS_CONTAINER_ID,
  createRecoveryContactsRuntime,
} from "../../../test/helpers/contactStoreRecovery";
import { createDeferred } from "../../../test/helpers/databaseRuntimeFactories";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import {
  type ContactsRuntime,
  createContactsStore,
  getSelfContactLocalId,
} from "./contactStore";

async function seedDuplicates(runtime: ContactsRuntime) {
  const localId = getSelfContactLocalId("offline-self");
  for (const id of [localId, "recovered-self"]) {
    const doc = runtime.openDocumentStore({
      localId: id,
      initialDocumentKind: "contact",
    });
    await doc.setStructuredFields(
      "contact",
      {
        encapsulationPublicKey: "self-key",
        isSelf: "1",
        userId: "self-user",
        ...(id === "recovered-self" ? { firstName: "Recovered" } : {}),
      },
      { deferRemoteSync: true },
    );
  }
  return localId;
}

for (const reconnectBeforeFailure of [false, true]) {
  test(`local edits finish during a stalled purge and retry when reconnect ${reconnectBeforeFailure ? "precedes" : "follows"} its failure`, async () => {
    const base = await createRecoveryContactsRuntime({
      signingFingerprint: "offline-self",
      userId: "self-user",
    });
    const localId = await seedDuplicates(base);
    const purgeStarted = createDeferred();
    const releasePurge = createDeferred<boolean>();
    let attempts = 0;
    const runtime: ContactsRuntime = {
      ...base,
      // Documents remain locally seeded; only the duplicate cleanup gets an
      // online runtime. A lost API response is held independently of local I/O.
      documents: {
        ...base.documents,
        state: { ...base.documents.state, online: true },
      },
      loadDocumentSummary: async (id) =>
        id === localId
          ? {
              id,
              containerId: CONTACTS_CONTAINER_ID,
              documentId: "remote-fallback",
              documentKind: "contact",
              title: "self-user",
              updatedAt: "2026-09-05T00:00:00.000Z",
            }
          : null,
      purgeDocument: async () => {
        attempts += 1;
        purgeStarted.resolve(undefined);
        return releasePurge.promise;
      },
    };
    let reloads = 0;
    const reconnected: ContactsRuntime = {
      ...runtime,
      loadDocumentSummary: async (id) => {
        reloads += 1;
        return runtime.loadDocumentSummary(id);
      },
      purgeDocument: async () => {
        attempts += 1;
        return true;
      },
    };
    const store = createContactsStore(runtime, {
      resolveUserIdentity: async () => {
        throw new Error("Unexpected remote key lookup");
      },
      logError: (message, cause) => {
        throw new Error(String(message), { cause });
      },
    });
    try {
      store.updateRuntime(runtime);
      await waitForCondition(
        () => store.getSnapshot().ready,
        "Contacts did not load locally",
      );
      await purgeStarted.promise;
      let ensured = false;
      const ensure = store
        .ensureSelfContact({
          localId,
          userId: "self-user",
          encapsulationPublicKey: "self-key",
          deferRemoteSync: true,
        })
        .then(() => {
          ensured = true;
        });
      await waitForCondition(
        () => ensured,
        "Self bootstrap waited for remote cleanup",
      );
      await ensure;
      const created = await store.createContact({ firstName: "Offline edit" });
      expect(created).not.toBeNull();
      expect(attempts).toBe(1);
      expect(
        await defaultDocumentsPersistence.loadDocument(
          base.documents.infra.execSql,
          localId,
        ),
      ).not.toBeNull();

      if (reconnectBeforeFailure) {
        store.updateRuntime(base);
        store.updateRuntime(reconnected);
        expect(attempts).toBe(1);
      }
      releasePurge.resolve(false);
      await releasePurge.promise;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (!reconnectBeforeFailure) {
        store.updateRuntime(base);
        expect(attempts).toBe(1);
        store.updateRuntime(reconnected);
      }
      await waitForCondition(
        () =>
          !store.getSnapshot().entries.some((entry) => entry.id === localId),
        "Remote cleanup did not retry after reconnect",
      );
      expect(attempts).toBe(2);
      expect(reloads).toBeGreaterThan(0);
      expect(
        await defaultDocumentsPersistence.loadDocument(
          base.documents.infra.execSql,
          localId,
        ),
      ).toBeNull();
    } finally {
      releasePurge.resolve(false);
      base.close();
    }
  });
}

test("offline self bootstrap retains synced duplicates without calling purge or resolving keys remotely", async () => {
  const base = await createRecoveryContactsRuntime({
    signingFingerprint: "offline-self",
    userId: "self-user",
  });
  const localId = await seedDuplicates(base);
  let requests = 0;
  const runtime: ContactsRuntime = {
    ...base,
    loadDocumentSummary: async (id) => ({
      id,
      containerId: CONTACTS_CONTAINER_ID,
      documentId: "remote-fallback",
      title: "self-user",
      updatedAt: "2026-09-05T00:00:00.000Z",
    }),
    purgeDocument: async () => {
      requests += 1;
      return false;
    },
  };
  const store = createContactsStore(runtime, {
    resolveUserIdentity: async () => {
      requests += 1;
      return null;
    },
    logError: (message, cause) => {
      throw new Error(String(message), { cause });
    },
  });
  try {
    store.updateRuntime(runtime);
    await waitForCondition(
      () => store.getSnapshot().ready,
      "Contacts did not load offline",
    );
    expect(
      await store.ensureSelfContact({
        localId,
        userId: "self-user",
        encapsulationPublicKey: "self-key",
        deferRemoteSync: true,
      }),
    ).toBe("recovered-self");
    expect(
      await store.ensureSelfContact({ localId, userId: "self-user" }),
    ).toBeNull();
    expect(requests).toBe(0);
    expect(
      await defaultDocumentsPersistence.loadDocument(
        base.documents.infra.execSql,
        localId,
      ),
    ).not.toBeNull();
  } finally {
    base.close();
  }
});
