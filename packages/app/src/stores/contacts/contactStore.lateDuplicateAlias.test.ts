import { expect, spyOn, test } from "bun:test";
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
import * as ContactWriteQueue from "./contactStoreWriteQueue";

test("a canonical alias admitted while Me ensure is queued keeps both histories", async () => {
  const base = await createRecoveryContactsRuntime({
    runtimeKey: "contacts-late-canonical-alias",
    signingFingerprint: "offline-self",
    userId: "self-user",
  });
  const localId = await seedDuplicateSelfContacts(base);
  const documentId = await deriveStableDocumentId(localId);
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const enqueued = Promise.withResolvers<void>();
  const runtime: ContactsRuntime = {
    ...base,
    openDocumentStore: (input) => {
      const document = base.openDocumentStore(input);
      return {
        ...document,
        setStructuredFields: async (...args) => {
          const { firstName } = args[1];
          if (input.localId === "blocker" && firstName === "Blocking") {
            started.resolve();
            await release.promise;
          }
          return document.setStructuredFields(...args);
        },
      };
    },
  };
  const queue = ContactWriteQueue.queueContactWrite;
  const observe: typeof queue = (state, message, work) => {
    const result = queue(state, message, work);
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
  const histories = () =>
    Promise.all(
      [localId, "recovered-self"].map((id) =>
        defaultDocumentsPersistence.loadHistoryRestoreState(
          base.documents.infra.execSql,
          id,
        ),
      ),
    );
  let blocker: Promise<void> | undefined;
  let ensuring: Promise<string | null> | undefined;
  try {
    await base
      .openDocumentStore({ localId: "blocker" })
      .setStructuredFields(
        "contact",
        { firstName: "Blocker" },
        { deferRemoteSync: true },
      );
    store.updateRuntime(runtime);
    await waitForCondition(
      () => store.getSnapshot().ready,
      "Contacts not ready",
    );
    blocker = store.updateContact("blocker", { firstName: "Blocking" });
    await Promise.race([
      started.promise,
      blocker.then(() => {
        throw new Error("Blocker bypassed its write barrier");
      }),
    ]);
    ensuring = store.ensureSelfContact({
      localId,
      userId: "self-user",
      encapsulationPublicKey: "self-key",
      deferRemoteSync: true,
    });
    await Promise.race([
      enqueued.promise,
      ensuring.then(() => {
        throw new Error("Ensure bypassed the write queue");
      }),
    ]);
    // Already-admitted local identity only: no production registry rebinding.
    await setPersistedContactDocumentIdentity(
      base,
      "recovered-self",
      documentId,
    );
    const before = await histories();
    expect(before.every((history) => history !== null)).toBe(true);
    release.resolve();
    expect(await ensuring).toBe(localId);
    await blocker;
    expect(await histories()).toEqual(before);
    expect(
      (
        await defaultDocumentsPersistence.loadDocument(
          base.documents.infra.execSql,
          "recovered-self",
        )
      )?.documentId,
    ).toBe(documentId);
    expect(errors).toEqual([]);
  } finally {
    release.resolve();
    await Promise.allSettled([blocker, ensuring]);
    observer.mockRestore();
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
