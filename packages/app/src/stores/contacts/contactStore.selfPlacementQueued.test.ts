import { expect, spyOn, test } from "bun:test";
import {
  createDocumentStore,
  deriveStableDocumentId,
  type PendingWriteQueueItem,
} from "@tearleads/client-sdk";
import {
  createRecoveryContactsRuntime,
  setPersistedContactDocumentIdentity,
} from "../../../test/helpers/contactStoreRecovery";
import {
  item,
  operation,
} from "../../../test/helpers/explorer/syncPanelFixtures";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import {
  type ContactsRuntime,
  createContactsStore,
  getSelfContactLocalId,
} from "./contactStore";
import * as ContactWriteQueue from "./contactStoreWriteQueue";

async function createQueuedPlacementFixture(
  status: PendingWriteQueueItem["status"],
) {
  const base = await createRecoveryContactsRuntime({
    runtimeKey: "self-placement-after-selection",
    signingFingerprint: "placement-queued-self",
    userId: "self-user",
  });
  const canonicalId = getSelfContactLocalId("placement-queued-self");
  const documentId = await deriveStableDocumentId(canonicalId);
  const blockerId = "placement-write-blocker";
  for (const id of [canonicalId, blockerId]) {
    await base.openDocumentStore({ localId: id }).setStructuredFields(
      "contact",
      id === canonicalId
        ? {
            isSelf: "1",
            userId: "self-user",
            encapsulationPublicKey: "self-key",
          }
        : { firstName: "Blocker" },
      { deferRemoteSync: true },
    );
  }
  await setPersistedContactDocumentIdentity(base, canonicalId, documentId);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const enqueued = Promise.withResolvers<void>();
  let pending: ReadonlyArray<PendingWriteQueueItem> = [];
  const runtime: ContactsRuntime = {
    ...base,
    listPendingWrites: async () => pending,
    openDocumentStore: (input) => {
      const document = base.openDocumentStore(input);
      return {
        ...document,
        setStructuredFields: async (...args) => {
          if (
            input.localId === blockerId &&
            Object.entries(args[1]).some(
              ([key, value]) =>
                key === "firstName" && value === "Blocking edit",
            )
          ) {
            entered.resolve();
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
  const errors: unknown[] = [];
  const store = createContactsStore(runtime, {
    resolveVerified: async () => null,
    logError: (message, cause) => errors.push({ message, cause }),
  });
  return {
    base,
    blockerId,
    canonicalId,
    entered,
    enqueued,
    errors,
    observer,
    release,
    runtime,
    store,
    introducePlacement: () => {
      pending = [
        item({
          localId: canonicalId,
          remoteId: documentId,
          status,
          operations: [
            operation({
              kind: "move",
              status: status === "blocked" ? "blocked" : "pending",
              lastError: status === "error" ? "Placement denied" : null,
            }),
          ],
        }),
      ];
    },
  };
}

test.each(["pending", "blocked", "error"] as const)(
  "self write rechecks %s placement after selection while queued",
  async (status) => {
    const f = await createQueuedPlacementFixture(status);
    let blockerWrite: Promise<void> | undefined;
    let ensuring: Promise<string | null> | undefined;
    try {
      f.store.updateRuntime(f.runtime);
      await waitForCondition(
        () => f.store.getSnapshot().ready,
        "Contacts not ready",
      );
      blockerWrite = f.store.updateContact(f.blockerId, {
        firstName: "Blocking edit",
      });
      await Promise.race([
        f.entered.promise,
        blockerWrite.then(() => {
          throw new Error("Blocker settled before entering its write");
        }),
      ]);
      // Selection sees no placement; its real queued work cannot run yet.
      ensuring = f.store.ensureSelfContact({
        localId: f.canonicalId,
        userId: "self-user",
        encapsulationPublicKey: "self-key-after-placement",
        deferRemoteSync: true,
      });
      await Promise.race([
        f.enqueued.promise,
        ensuring.then(() => {
          throw new Error("Ensure settled before joining the write queue");
        }),
      ]);
      f.introducePlacement();
      f.release.resolve();
      const [acknowledged] = await Promise.all([ensuring, blockerWrite]);
      // Bypass the registry and reopen SQLite, not the mutable live snapshot.
      const reopened = createDocumentStore(f.canonicalId, f.runtime.documents);
      expect(await reopened.ensureInitialized()).toBe(true);
      expect({
        acknowledged,
        durableFields: reopened.getSnapshot().structuredFields,
      }).toMatchObject({
        acknowledged: null,
        durableFields: {
          isSelf: "1",
          userId: "self-user",
          encapsulationPublicKey: "self-key",
        },
      });
      expect(f.errors).toEqual([]);
    } finally {
      f.release.resolve();
      f.observer.mockRestore();
      try {
        await Promise.all([blockerWrite, ensuring]);
      } finally {
        f.store.updateRuntime({
          ...f.runtime,
          documents: {
            ...f.runtime.documents,
            infra: { ...f.runtime.documents.infra, dbStatus: "terminated" },
          },
        });
        f.base.close();
      }
    }
  },
);
