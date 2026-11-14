import { expect, test } from "bun:test";
import {
  createDocumentStore,
  defaultDocumentsPersistence,
} from "@tearleads/client-sdk";
import { createContactAddressHarness } from "../../../test/helpers/contacts/contactAddressHarness";

test("deferred self retry persists dirty identity before acknowledging it", async () => {
  const harness = await createContactAddressHarness();
  const localId = harness.selfContactId;
  const original = defaultDocumentsPersistence.commitDocumentMutation;
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let first: Promise<string | null> | undefined;
  let failures = 0;
  try {
    // Match deferred bootstrap's empty birth, and hold only its later patch.
    const document = harness.runtime.openDocumentStore({ localId });
    expect(await document.ensureInitialized()).toBe(true);
    expect(document.getSnapshot().structuredFields).not.toHaveProperty(
      "isSelf",
    );
    defaultDocumentsPersistence.commitDocumentMutation = async (...args) => {
      if (failures === 0) {
        failures += 1;
        entered.resolve();
        await release.promise;
        throw new Error("Injected self identity persistence failure");
      }
      return original(...args);
    };
    const ensure = () =>
      harness.store.ensureSelfContact({ localId, deferRemoteSync: true });
    first = ensure();
    await Promise.race([
      entered.promise,
      first.then(() => {
        throw new Error("Ensure settled before entering persistence");
      }),
    ]);
    release.resolve();
    expect(await first).toBeNull();
    expect(failures).toBe(1);
    expect(document.getSnapshot().structuredFields).toMatchObject({
      isSelf: "1",
    });
    expect(document.hasQueuedWrites()).toBe(false);
    expect(document.hasUnsavedLocalEdits()).toBe(true);
    defaultDocumentsPersistence.commitDocumentMutation = original;

    const retry = await ensure();
    // Bypass the registry: inspect SQLite, not the dirty live backing store.
    const reopened = createDocumentStore(localId, harness.runtime.documents);
    expect(await reopened.ensureInitialized()).toBe(true);
    expect({
      acknowledged: retry,
      durableFields: reopened.getSnapshot().structuredFields,
      unsaved: document.hasUnsavedLocalEdits(),
    }).toMatchObject({
      acknowledged: localId,
      durableFields: { isSelf: "1" },
      unsaved: false,
    });
  } finally {
    release.resolve();
    defaultDocumentsPersistence.commitDocumentMutation = original;
    try {
      await first;
    } finally {
      harness.close();
    }
  }
});
