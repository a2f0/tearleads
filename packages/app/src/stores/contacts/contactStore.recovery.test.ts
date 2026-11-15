import { expect, spyOn, test } from "bun:test";
import {
  defaultDocumentsPersistence,
  deriveStableDocumentId,
  type ResolvedUserIdentity,
} from "@tearleads/client-sdk";
import {
  createRecoveryContactsRuntime,
  setPersistedContactDocumentIdentity,
} from "../../../test/helpers/contactStoreRecovery";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import {
  type ContactsRuntime,
  createContactsStore,
  getSelfContactLocalId,
} from "./contactStore";
import * as ContactWriteQueue from "./contactStoreWriteQueue";

const SELF: ResolvedUserIdentity = {
  encapsulationKeyFingerprint: "self-encapsulation-fingerprint",
  encapsulationPublicKey: "self-encapsulation-public-key",
  signingKeyFingerprint: "self-signing-fingerprint",
  signingPublicKey: "self-signing-public-key",
  userId: "self-user",
};

function selfInput(localId: string) {
  return {
    localId,
    userId: SELF.userId,
    encapsulationPublicKey: SELF.encapsulationPublicKey,
    deferRemoteSync: true,
  };
}

async function durable(runtime: ContactsRuntime, id: string) {
  const execSql = runtime.documents.infra.execSql;
  return {
    record: await defaultDocumentsPersistence.loadDocument(execSql, id),
    history: await defaultDocumentsPersistence.loadHistoryRestoreState(
      execSql,
      id,
    ),
  };
}

test("named canonical remote Me survives recovery and a signed-out no-write ensure", async () => {
  const runtime = await createRecoveryContactsRuntime({
    signingFingerprint: SELF.signingKeyFingerprint,
    userId: SELF.userId,
  });
  const localId = getSelfContactLocalId(SELF.signingKeyFingerprint);
  const remoteId = await deriveStableDocumentId(localId);
  const errors: unknown[] = [];
  try {
    await runtime.openDocumentStore({ localId: remoteId }).setStructuredFields(
      "contact",
      {
        encapsulationPublicKey: SELF.encapsulationPublicKey,
        firstName: "Recovered",
        lastName: "User",
        nickname: "Primary",
        isSelf: "1",
        userId: SELF.userId,
      },
      { deferRemoteSync: true },
    );
    await setPersistedContactDocumentIdentity(runtime, remoteId, remoteId);
    const before = await durable(runtime, remoteId);
    expect(before.history).not.toBeNull();
    const store = createContactsStore(runtime, {
      resolveVerified: async () => {
        throw new Error("Unexpected remote self key lookup");
      },
      logError: (message, cause) => errors.push({ message, cause }),
    });
    store.updateRuntime(runtime);
    await waitForCondition(
      () => store.getSnapshot().ready,
      "Contacts not ready",
    );
    expect(await store.ensureSelfContact(selfInput(localId))).toBe(remoteId);
    const signedOut: ContactsRuntime = {
      ...runtime,
      documents: {
        ...runtime.documents,
        auth: {
          ...runtime.documents.auth,
          isAuthenticated: false,
          userId: null,
        },
      },
    };
    store.updateRuntime(signedOut);
    expect(
      await store.ensureSelfContact({ localId, deferRemoteSync: true }),
    ).toBe(remoteId);
    expect(await durable(runtime, remoteId)).toEqual(before);
    expect((await durable(runtime, localId)).record).toBeNull();
    expect(store.getSnapshot().entries).toEqual([
      expect.objectContaining({
        id: remoteId,
        firstName: "Recovered",
        lastName: "User",
        nickname: "Primary",
        userId: SELF.userId,
      }),
    ]);
    expect(errors).toEqual([]);
  } finally {
    runtime.close();
  }
});

test("a late distinct same-user remote contact cannot replace promoted canonical Me", async () => {
  const runtime = await createRecoveryContactsRuntime({
    signingFingerprint: SELF.signingKeyFingerprint,
    userId: SELF.userId,
  });
  const localId = getSelfContactLocalId(SELF.signingKeyFingerprint);
  const errors: unknown[] = [];
  const store = createContactsStore(runtime, {
    resolveVerified: async () => null,
    logError: (message, cause) => errors.push({ message, cause }),
  });
  try {
    store.updateRuntime(runtime);
    expect(await store.ensureSelfContact(selfInput(localId))).toBe(localId);
    const canonicalBefore = await durable(runtime, localId);
    const remoteId = await deriveStableDocumentId("distinct-same-user-contact");
    await runtime.openDocumentStore({ localId: remoteId }).setStructuredFields(
      "contact",
      {
        encapsulationPublicKey: SELF.encapsulationPublicKey,
        isSelf: "1",
        userId: SELF.userId,
      },
      { deferRemoteSync: true },
    );
    await setPersistedContactDocumentIdentity(runtime, remoteId, remoteId);
    await waitForCondition(
      () => store.getSnapshot().entries.some((entry) => entry.id === remoteId),
      "Late distinct contact was not discovered",
    );
    const distinctBefore = await durable(runtime, remoteId);
    expect(await store.ensureSelfContact(selfInput(localId))).toBe(localId);
    expect(await durable(runtime, localId)).toEqual(canonicalBefore);
    expect(await durable(runtime, remoteId)).toEqual(distinctBefore);
    expect(store.getSnapshot().entries).toHaveLength(2);
    expect(errors).toEqual([]);
  } finally {
    runtime.close();
  }
});

test("a synced canonical Me and a distinct same-user stream both retain their histories", async () => {
  const runtime = await createRecoveryContactsRuntime({
    signingFingerprint: SELF.signingKeyFingerprint,
    userId: SELF.userId,
  });
  const localId = getSelfContactLocalId(SELF.signingKeyFingerprint);
  const canonicalRemoteId = await deriveStableDocumentId(localId);
  const otherId = await deriveStableDocumentId("other-self-labelled-document");
  const ids = [localId, otherId];
  const errors: unknown[] = [];
  try {
    for (const id of ids) {
      await runtime.openDocumentStore({ localId: id }).setStructuredFields(
        "contact",
        {
          encapsulationPublicKey: SELF.encapsulationPublicKey,
          isSelf: "1",
          userId: SELF.userId,
        },
        { deferRemoteSync: true },
      );
      await setPersistedContactDocumentIdentity(
        runtime,
        id,
        id === localId ? canonicalRemoteId : otherId,
      );
    }
    const before = await Promise.all(ids.map((id) => durable(runtime, id)));
    expect(before.every((entry) => entry.history !== null)).toBe(true);
    const store = createContactsStore(runtime, {
      resolveVerified: async () => null,
      logError: (message, cause) => errors.push({ message, cause }),
    });
    store.updateRuntime(runtime);
    expect(await store.ensureSelfContact(selfInput(localId))).toBe(localId);
    expect(await Promise.all(ids.map((id) => durable(runtime, id)))).toEqual(
      before,
    );
    expect(errors).toEqual([]);
  } finally {
    runtime.close();
  }
});

test("self ensure stops after an identity lookup crosses runtimes", async () => {
  const stale = await createRecoveryContactsRuntime({
    signingFingerprint: SELF.signingKeyFingerprint,
    userId: SELF.userId,
  });
  const replacement = await createRecoveryContactsRuntime({
    containerId: "replacement-contacts",
    runtimeKey: "replacement-lookup",
    signingFingerprint: "replacement-fingerprint",
    userId: "replacement-user",
  });
  const started = Promise.withResolvers<void>();
  const result = Promise.withResolvers<ResolvedUserIdentity | null>();
  const errors: unknown[] = [];
  const store = createContactsStore(stale, {
    resolveVerified: async () => null,
    getLocalUserIdentity: async () => {
      started.resolve();
      return result.promise;
    },
    logError: (message, cause) => errors.push({ message, cause }),
  });
  const localId = getSelfContactLocalId(SELF.signingKeyFingerprint);
  let ensuring: Promise<string | null> | undefined;
  try {
    store.updateRuntime(stale);
    await waitForCondition(
      () => store.getSnapshot().ready,
      "Contacts not ready",
    );
    ensuring = store.ensureSelfContact({
      localId,
      userId: SELF.userId,
      deferRemoteSync: true,
    });
    await Promise.race([
      started.promise,
      ensuring.then(() => {
        throw new Error("Ensure bypassed the identity lookup barrier");
      }),
    ]);
    store.updateRuntime(replacement);
    await waitForCondition(
      () => store.getSnapshot().ready,
      "Replacement not ready",
    );
    result.resolve(SELF);
    expect(await ensuring).toBeNull();
    expect((await durable(stale, localId)).record).toBeNull();
    expect((await durable(replacement, localId)).record).toBeNull();
    expect(store.getSnapshot().entries).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    result.resolve(null);
    await Promise.allSettled([ensuring]);
    stale.close();
    replacement.close();
  }
});

test("self ensure rechecks its runtime inside the real write chain", async () => {
  const stale = await createRecoveryContactsRuntime({
    signingFingerprint: SELF.signingKeyFingerprint,
    userId: SELF.userId,
  });
  const replacement = await createRecoveryContactsRuntime({
    containerId: "replacement-contacts",
    runtimeKey: "replacement-queued",
    signingFingerprint: "replacement-fingerprint",
    userId: "replacement-user",
  });
  const localId = getSelfContactLocalId(SELF.signingKeyFingerprint);
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const enqueued = Promise.withResolvers<void>();
  const errors: unknown[] = [];
  const runtime: ContactsRuntime = {
    ...stale,
    openDocumentStore: (input) => {
      const document = stale.openDocumentStore(input);
      return {
        ...document,
        setStructuredFields: async (...args) => {
          const { firstName } = args[1];
          if (input.localId === "blocker" && firstName === "Blocked") {
            started.resolve();
            await release.promise;
          }
          return document.setStructuredFields(...args);
        },
      };
    },
  };
  const original = ContactWriteQueue.queueContactWrite;
  const observe: typeof original = (state, message, work) => {
    const result = original(state, message, work);
    if (message === "Contacts: failed to ensure self contact.")
      enqueued.resolve();
    return result;
  };
  const observer = spyOn(
    ContactWriteQueue,
    "queueContactWrite",
  ).mockImplementation(observe);
  const store = createContactsStore(runtime, {
    resolveVerified: async () => null,
    logError: (message, cause) => errors.push({ message, cause }),
  });
  let blocker: Promise<void> | undefined;
  let ensuring: Promise<string | null> | undefined;
  try {
    await stale.openDocumentStore({ localId }).setStructuredFields(
      "contact",
      {
        isSelf: "1",
        userId: SELF.userId,
        encapsulationPublicKey: SELF.encapsulationPublicKey,
      },
      { deferRemoteSync: true },
    );
    await stale
      .openDocumentStore({ localId: "blocker" })
      .setStructuredFields(
        "contact",
        { firstName: "Blocker" },
        { deferRemoteSync: true },
      );
    const before = await durable(stale, localId);
    store.updateRuntime(runtime);
    await waitForCondition(
      () => store.getSnapshot().ready,
      "Contacts not ready",
    );
    blocker = store.updateContact("blocker", { firstName: "Blocked" });
    await Promise.race([
      started.promise,
      blocker.then(() => {
        throw new Error("Blocker did not enter its write");
      }),
    ]);
    ensuring = store.ensureSelfContact({
      ...selfInput(localId),
      encapsulationPublicKey: "changed-key",
    });
    await Promise.race([
      enqueued.promise,
      ensuring.then(() => {
        throw new Error("Ensure did not join the write queue");
      }),
    ]);
    store.updateRuntime(replacement);
    await waitForCondition(
      () => store.getSnapshot().ready,
      "Replacement not ready",
    );
    release.resolve();
    expect(await ensuring).toBeNull();
    await blocker;
    expect(await durable(stale, localId)).toEqual(before);
    expect((await durable(replacement, localId)).record).toBeNull();
    expect(store.getSnapshot().entries).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    release.resolve();
    await Promise.allSettled([blocker, ensuring]);
    observer.mockRestore();
    stale.close();
    replacement.close();
  }
});
