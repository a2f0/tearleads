import { expect, test } from "bun:test";
import {
  createDocumentStore,
  defaultDocumentsPersistence,
} from "@tearleads/client-sdk";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createRecoveryContactsRuntime,
  seedDuplicateSelfContacts,
} from "../../../test/helpers/contactStoreRecovery";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { getContactAvatarRef } from "../../document-types/contact/contactAvatarSlot";
import { type ContactsRuntime, createContactsStore } from "./contactStore";

for (const reconnect of ["before", "after", "database"] as const) {
  test(`local edits retain distinct contacts across ${reconnect} reconnect`, async () => {
    const base = await createRecoveryContactsRuntime({
      signingFingerprint: "offline-self",
      userId: "self-user",
    });
    const localId = await seedDuplicateSelfContacts(base);
    const execSql = base.documents.infra.execSql;
    const history = await defaultDocumentsPersistence.loadHistoryRestoreState(
      execSql,
      "recovered-self",
    );
    expect(history).not.toBeNull();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const errors: unknown[] = [];
    const runtime: ContactsRuntime = {
      ...base,
      openDocumentStore: (input) => {
        const document = base.openDocumentStore(input);
        return {
          ...document,
          setStructuredFields: async (...args) => {
            const { firstName } = args[1];
            if (input.localId === localId && firstName === "Offline edit") {
              started.resolve();
              await release.promise;
            }
            return document.setStructuredFields(...args);
          },
        };
      },
    };
    const reconnected: ContactsRuntime = {
      ...runtime,
      documents: {
        ...runtime.documents,
        state: { ...runtime.documents.state, online: true },
      },
    };
    const store = createContactsStore(runtime, {
      resolveVerified: async () => {
        throw new Error("Unexpected remote key lookup");
      },
      logError: (message, cause) => errors.push({ message, cause }),
    });
    let edit: Promise<void> | undefined;
    try {
      store.updateRuntime(runtime);
      await waitForCondition(
        () => store.getSnapshot().ready,
        "Contacts did not load locally",
      );
      edit = store.updateContact(localId, { firstName: "Offline edit" });
      await Promise.race([
        started.promise,
        edit.then(() => {
          throw new Error("Edit settled before entering the write barrier");
        }),
      ]);
      if (reconnect === "before") store.updateRuntime(reconnected);
      release.resolve();
      await edit;
      if (reconnect === "database") {
        store.updateRuntime({
          ...runtime,
          documents: {
            ...runtime.documents,
            infra: { ...runtime.documents.infra, dbStatus: "idle" },
          },
        });
      }
      store.updateRuntime(reconnected);
      await waitForCondition(
        () => store.getSnapshot().ready,
        "Contacts did not reconnect",
      );
      expect(
        await store.ensureSelfContact({
          localId,
          userId: "self-user",
          encapsulationPublicKey: "self-key",
          deferRemoteSync: true,
        }),
      ).toBe(localId);
      const reopened = createDocumentStore(localId, base.documents);
      expect(await reopened.ensureInitialized()).toBe(true);
      expect(reopened.getSnapshot().structuredFields).toMatchObject({
        firstName: "Offline edit",
      });
      expect(
        await defaultDocumentsPersistence.loadDocument(
          execSql,
          "recovered-self",
        ),
      ).not.toBeNull();
      expect(
        await defaultDocumentsPersistence.loadHistoryRestoreState(
          execSql,
          "recovered-self",
        ),
      ).toEqual(history);
      expect(errors).toEqual([]);
    } finally {
      release.resolve();
      await Promise.allSettled([edit]);
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
}

test("offline Me bootstrap keeps distinct same-user documents without remote key lookup", async () => {
  const runtime = await createRecoveryContactsRuntime({
    signingFingerprint: "offline-self",
    userId: "self-user",
  });
  const localId = await seedDuplicateSelfContacts(runtime);
  let requests = 0;
  const errors: unknown[] = [];
  const store = createContactsStore(runtime, {
    resolveVerified: async () => {
      requests += 1;
      return null;
    },
    logError: (message, cause) => errors.push({ message, cause }),
  });
  const execSql = runtime.documents.infra.execSql;
  const ids = [localId, "recovered-self"];
  const before = await Promise.all(
    ids.map((id) => defaultDocumentsPersistence.loadDocument(execSql, id)),
  );
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
    ).toBe(localId);
    expect(
      await store.ensureSelfContact({ localId, userId: "self-user" }),
    ).toBeNull();
    expect(requests).toBe(0);
    expect(
      await Promise.all(
        ids.map((id) => defaultDocumentsPersistence.loadDocument(execSql, id)),
      ),
    ).toEqual(before);
    expect(errors).toEqual([]);
  } finally {
    runtime.close();
  }
});

for (const target of ["canonical", "distinct"] as const) {
  test(`scalar and avatar edits stay on the ${target} document`, async () => {
    const base = await createRecoveryContactsRuntime({
      signingFingerprint: "offline-self",
      userId: "self-user",
    });
    const localId = await seedDuplicateSelfContacts(base);
    const targetId = target === "canonical" ? localId : "recovered-self";
    const otherId = target === "canonical" ? "recovered-self" : localId;
    const runtime: ContactsRuntime = {
      ...base,
      documents: {
        ...base.documents,
        crypto: {
          ...base.documents.crypto,
          encapsulationKeyPair: generateKemSeedAndKeyPair(),
        },
      },
      openDocumentStore: (input) => {
        const document = base.openDocumentStore(input);
        document.updateRuntime(runtime.documents);
        return document;
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
        "Contacts not ready",
      );
      expect(
        await store.ensureSelfContact({
          localId,
          userId: "self-user",
          encapsulationPublicKey: "self-key",
          deferRemoteSync: true,
        }),
      ).toBe(localId);
      const execSql = base.documents.infra.execSql;
      const otherBefore =
        await defaultDocumentsPersistence.loadHistoryRestoreState(
          execSql,
          otherId,
        );
      expect(otherBefore).not.toBeNull();
      await store.updateContact(targetId, { firstName: "Saved on original" });
      // This fixture's open swaps crypto runtimes. Capture the store before
      // the fire-and-forget avatar write so its generation stays current.
      const document = runtime.openDocumentStore({ localId: targetId });
      const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      await store.setContactAvatar(targetId, {
        bytes,
        mimeType: "image/png",
        name: "self.png",
      });
      await waitForCondition(
        () =>
          Boolean(
            store.getSnapshot().entries.find((entry) => entry.id === targetId)
              ?.avatar?.storageKey,
          ) &&
          !document.hasQueuedWrites() &&
          !document.hasUnsavedLocalEdits(),
        "Avatar did not persist on its original document",
      );
      const reopened = createDocumentStore(targetId, runtime.documents);
      expect(await reopened.ensureInitialized()).toBe(true);
      const snapshot = reopened.getSnapshot();
      expect(snapshot.structuredFields).toMatchObject({
        firstName: "Saved on original",
      });
      const avatar = getContactAvatarRef(
        snapshot.attachments,
        snapshot.attachmentStorageKeyBySlotId,
      );
      if (!avatar?.storageKey)
        throw new Error("Durable original avatar missing");
      expect(
        await base.documents.infra.blobStore.readBytes(avatar.storageKey),
      ).toEqual(bytes);
      expect(
        await defaultDocumentsPersistence.loadHistoryRestoreState(
          execSql,
          otherId,
        ),
      ).toEqual(otherBefore);
      expect(errors).toEqual([]);
    } finally {
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
}
