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

for (const reconnect of ["before", "after", "database"] as const) {
  const reconnectBeforeFailure = reconnect === "before";
  test(`local edits finish during a stalled purge and recover on ${reconnect} reconnect`, async () => {
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
        if (reconnect === "database") {
          store.updateRuntime({
            ...reconnected,
            documents: {
              ...reconnected.documents,
              infra: { ...reconnected.documents.infra, dbStatus: "idle" },
            },
          });
        }
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

test("a confirmed duplicate purge retries local cleanup without purging its missing remote document", async () => {
  const base = await createRecoveryContactsRuntime({
    signingFingerprint: "offline-self",
    userId: "self-user",
  });
  const localId = await seedDuplicates(base);
  let purges = 0;
  let localDeletes = 0;
  const errors: string[] = [];
  const runtime: ContactsRuntime = {
    ...base,
    documents: {
      ...base.documents,
      state: { ...base.documents.state, online: true },
    },
    loadDocumentSummary: async (id) =>
      id === localId && purges === 0
        ? {
            id,
            containerId: CONTACTS_CONTAINER_ID,
            documentId: "remote-fallback",
            title: "self-user",
            updatedAt: "2026-09-05T00:00:00.000Z",
          }
        : null,
    purgeDocument: async () => {
      purges += 1;
      // Model the purge workflow's durable removal before the app settles its cache.
      await defaultDocumentsPersistence.deleteDocument(
        base.documents.infra.execSql,
        localId,
      );
      return true;
    },
    deleteDocument: async (id) => {
      localDeletes += 1;
      return localDeletes === 1 ? false : base.deleteDocument(id);
    },
  };
  const store = createContactsStore(runtime, {
    resolveUserIdentity: async () => null,
    logError: (message) => {
      errors.push(String(message));
    },
  });
  try {
    store.updateRuntime(runtime);
    await waitForCondition(
      () => errors.length === 1,
      "Local cleanup did not reach its injected failure",
    );
    expect(purges).toBe(1);
    expect(localDeletes).toBe(1);
    expect(
      store.getSnapshot().entries.some((entry) => entry.id === localId),
    ).toBe(true);
    expect(
      await defaultDocumentsPersistence.loadDocument(
        base.documents.infra.execSql,
        localId,
      ),
    ).toBeNull();
    store.updateRuntime(base);
    store.updateRuntime(runtime);
    await waitForCondition(
      () => !store.getSnapshot().entries.some((entry) => entry.id === localId),
      "Acknowledged purge did not finish its local cleanup",
      1500,
    );
    expect(purges).toBe(1);
    expect(localDeletes).toBe(2);
  } finally {
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
