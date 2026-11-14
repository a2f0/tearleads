import { expect, test } from "bun:test";
import {
  defaultDocumentsPersistence,
  deriveStableDocumentId,
} from "@tearleads/client-sdk";
import {
  createRecoveryContactsRuntime,
  seedDuplicateSelfContacts,
  setPersistedContactDocumentIdentity,
} from "../../../test/helpers/contactStoreRecovery";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { type ContactsRuntime, createContactsStore } from "./contactStore";

async function durable(runtime: ContactsRuntime, ids: string[]) {
  const execSql = runtime.documents.infra.execSql;
  return Promise.all(
    ids.map(async (id) => ({
      record: await defaultDocumentsPersistence.loadDocument(execSql, id),
      history: await defaultDocumentsPersistence.loadHistoryRestoreState(
        execSql,
        id,
      ),
    })),
  );
}

test("Me ensure never adopts or syncs an unavailable distinct same-user remote contact", async () => {
  const base = await createRecoveryContactsRuntime({
    signingFingerprint: "offline-self",
    userId: "self-user",
  });
  const localId = await seedDuplicateSelfContacts(base);
  await setPersistedContactDocumentIdentity(
    base,
    localId,
    await deriveStableDocumentId(localId),
  );
  await setPersistedContactDocumentIdentity(
    base,
    "recovered-self",
    await deriveStableDocumentId("recovered-self"),
  );
  const ids = [localId, "recovered-self"];
  const before = await durable(base, ids);
  let distinctSyncs = 0;
  const runtime: ContactsRuntime = {
    ...base,
    openDocumentStore: (input) => {
      const document = base.openDocumentStore(input);
      if (input.localId !== "recovered-self") return document;
      return {
        ...document,
        requestRemoteSyncAndWait: async () => {
          distinctSyncs += 1;
          return false;
        },
      };
    },
  };
  const errors: unknown[] = [];
  const store = createContactsStore(runtime, {
    resolveVerified: async () => null,
    logError: (message, cause) => errors.push({ message, cause }),
  });
  try {
    store.updateRuntime(runtime);
    await waitForCondition(
      () => store.getSnapshot().ready,
      "Contacts did not load",
    );
    expect(
      await store.ensureSelfContact({
        localId,
        userId: "self-user",
        encapsulationPublicKey: "self-key",
        deferRemoteSync: true,
      }),
    ).toBe(localId);
    expect(before.every((entry) => entry.history !== null)).toBe(true);
    expect(await durable(base, ids)).toEqual(before);
    expect(distinctSyncs).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    base.close();
  }
});

test("already-persisted aliases of canonical D retain their separate records and histories", async () => {
  const runtime = await createRecoveryContactsRuntime({
    runtimeKey: "contacts-same-remote-alias",
    signingFingerprint: "offline-self",
    userId: "self-user",
  });
  const localId = await seedDuplicateSelfContacts(runtime);
  const documentId = await deriveStableDocumentId(localId);
  const ids = [localId, "recovered-self"];
  const errors: unknown[] = [];
  try {
    for (const id of ids)
      await setPersistedContactDocumentIdentity(runtime, id, documentId);
    const before = await durable(runtime, ids);
    expect(before.every((entry) => entry.history !== null)).toBe(true);
    const store = createContactsStore(runtime, {
      resolveVerified: async () => null,
      logError: (message, cause) => errors.push({ message, cause }),
    });
    store.updateRuntime(runtime);
    expect(
      await store.ensureSelfContact({
        localId,
        userId: "self-user",
        encapsulationPublicKey: "self-key",
        deferRemoteSync: true,
      }),
    ).toBe(localId);
    expect(await durable(runtime, ids)).toEqual(before);
    expect(
      store
        .getSnapshot()
        .entries.map((entry) => entry.id)
        .sort(),
    ).toEqual(ids.sort());
    expect(errors).toEqual([]);
  } finally {
    runtime.close();
  }
});
