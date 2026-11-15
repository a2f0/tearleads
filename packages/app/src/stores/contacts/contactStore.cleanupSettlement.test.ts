import { expect, spyOn, test } from "bun:test";
import { createDocumentStore } from "@tearleads/client-sdk";
import {
  createRecoveryContactsRuntime,
  seedDuplicateSelfContacts,
} from "../../../test/helpers/contactStoreRecovery";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { type ContactsRuntime, createContactsStore } from "./contactStore";
import * as ContactWriteQueue from "./contactStoreWriteQueue";

test("a scalar edit queued behind a write stays on its original document", async () => {
  const base = await createRecoveryContactsRuntime({
    signingFingerprint: "offline-self",
    userId: "self-user",
  });
  const localId = await seedDuplicateSelfContacts(base);
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const enqueued = Promise.withResolvers<void>();
  let observingEdit = false;
  const queue = ContactWriteQueue.queueContactWrite;
  const observe: typeof queue = (state, message, work) => {
    const result = queue(state, message, work);
    if (observingEdit && message === "Contacts: failed to update contact.")
      enqueued.resolve();
    return result;
  };
  const observer = spyOn(
    ContactWriteQueue,
    "queueContactWrite",
  ).mockImplementation(observe);
  const errors: unknown[] = [];
  const runtime: ContactsRuntime = {
    ...base,
    openDocumentStore: (input) => {
      const document = base.openDocumentStore(input);
      return {
        ...document,
        setStructuredFields: async (...args) => {
          const { nickname } = args[1];
          if (input.localId === localId && nickname === "Blocker") {
            started.resolve();
            await release.promise;
          }
          return document.setStructuredFields(...args);
        },
      };
    },
  };
  const store = createContactsStore(runtime, {
    resolveVerified: async () => null,
    logError: (message, cause) => errors.push({ message, cause }),
  });
  let blocker: Promise<void> | undefined;
  let edit: Promise<void> | undefined;
  try {
    store.updateRuntime(runtime);
    await waitForCondition(
      () => store.getSnapshot().ready,
      "Contacts not ready",
    );
    blocker = store.updateContact(localId, { nickname: "Blocker" });
    await Promise.race([
      started.promise,
      blocker.then(() => {
        throw new Error("Blocker settled before entering its write");
      }),
    ]);
    observingEdit = true;
    edit = store.updateContact(localId, { firstName: "Queued edit" });
    await Promise.race([
      enqueued.promise,
      edit.then(() => {
        throw new Error("Edit settled before joining the write queue");
      }),
    ]);
    release.resolve();
    await Promise.all([blocker, edit]);
    const original = createDocumentStore(localId, base.documents);
    const distinct = createDocumentStore("recovered-self", base.documents);
    expect(await original.ensureInitialized()).toBe(true);
    expect(await distinct.ensureInitialized()).toBe(true);
    expect(original.getSnapshot().structuredFields).toMatchObject({
      firstName: "Queued edit",
      nickname: "Blocker",
    });
    expect(distinct.getSnapshot().structuredFields).toMatchObject({
      firstName: "Recovered",
    });
    expect(errors).toEqual([]);
  } finally {
    release.resolve();
    await Promise.allSettled([blocker, edit]);
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
