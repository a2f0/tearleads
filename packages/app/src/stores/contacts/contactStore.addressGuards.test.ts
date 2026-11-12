import { expect, test } from "bun:test";
import { createContactAddressHarness } from "../../../test/helpers/contacts/contactAddressHarness";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { readContactAddressFields } from "../../document-types/contact/contactAddressModel";
import type { ContactsStore } from "./contactStoreTypes";

const fields = readContactAddressFields({ street: "Main" });
const operations = [
  {
    name: "add",
    run: (store: ContactsStore, id: string, _row: string) =>
      store.addContactAddress(id, fields),
  },
  {
    name: "update",
    run: (store: ContactsStore, id: string, row: string) =>
      store.updateContactAddress(id, row, { street: "Other" }),
  },
  {
    name: "remove",
    run: (store: ContactsStore, id: string, row: string) =>
      store.removeContactAddress(id, row),
  },
];

for (const operation of operations) {
  test(`${operation.name} waits for hydration and refuses newly read-only documents`, async () => {
    const hydration = Promise.withResolvers<boolean>();
    let held = false;
    let canWrite = true;
    let waiting = false;
    let mutations = 0;
    const harness = await createContactAddressHarness((document) => ({
      ...document,
      ensureInitialized: () => {
        if (!held) return document.ensureInitialized();
        waiting = true;
        return hydration.promise;
      },
      getSnapshot: () => ({
        ...document.getSnapshot(),
        ready: held ? false : document.getSnapshot().ready,
        canWrite,
      }),
      addRow: async (fields) => {
        mutations++;
        return document.addRow(fields);
      },
      updateRowFields: async (id, patch) => {
        mutations++;
        await document.updateRowFields(id, patch);
      },
      removeRow: async (id) => {
        mutations++;
        await document.removeRow(id);
      },
    }));
    try {
      const id = await harness.store.createContact({ firstName: "Ada" });
      if (!id) throw new Error("Missing contact");
      const row = await harness.store.addContactAddress(id, fields);
      if (!row) throw new Error("Missing address");
      mutations = 0;
      held = true;
      const result = operation.run(harness.store, id, row).then(
        () => null,
        (error: unknown) => error,
      );
      await waitForCondition(
        () => waiting || mutations > 0,
        "Operation did not start",
      );
      expect(mutations).toBe(0);
      canWrite = false;
      held = false;
      hydration.resolve(true);
      expect(await result).toBeInstanceOf(Error);
      expect(mutations).toBe(0);
    } finally {
      hydration.resolve(false);
      harness.close();
    }
  });
}

for (const change of ["user", "fingerprint", "container"] as const) {
  test(`refuses ${change} changes while hydration is pending`, async () => {
    const hydration = Promise.withResolvers<boolean>();
    let held = false;
    let started = false;
    let writes = 0;
    const harness = await createContactAddressHarness((document) => ({
      ...document,
      ensureInitialized: () => {
        if (!held) return document.ensureInitialized();
        started = true;
        return hydration.promise;
      },
      addRow: async (fields) => {
        writes++;
        return document.addRow(fields);
      },
    }));
    try {
      const id = await harness.store.createContact({ firstName: "Ada" });
      if (!id) throw new Error("Missing contact");
      held = true;
      const result = harness.store.addContactAddress(id, fields).then(
        () => null,
        (error: unknown) => error,
      );
      await waitForCondition(
        () => started || writes > 0,
        "Operation did not start",
      );
      expect(writes).toBe(0);
      const documents = harness.runtime.documents;
      harness.store.updateRuntime({
        ...harness.runtime,
        documents: {
          ...documents,
          auth: {
            ...documents.auth,
            userId: change === "user" ? "other" : documents.auth.userId,
          },
          crypto: {
            ...documents.crypto,
            signingFingerprint:
              change === "fingerprint"
                ? "other"
                : documents.crypto.signingFingerprint,
          },
          state: {
            ...documents.state,
            containerId:
              change === "container" ? "other" : documents.state.containerId,
          },
        },
      });
      held = false;
      hydration.resolve(true);
      expect(await result).toBeInstanceOf(Error);
      expect(writes).toBe(0);
    } finally {
      hydration.resolve(false);
      harness.close();
    }
  });
}

test("incomplete hydration cannot create an address", async () => {
  let incomplete = false;
  const harness = await createContactAddressHarness((document) => ({
    ...document,
    ensureInitialized: () =>
      incomplete ? Promise.resolve(false) : document.ensureInitialized(),
  }));
  try {
    const id = await harness.store.createContact({ firstName: "Ada" });
    if (!id) throw new Error("Missing contact");
    incomplete = true;
    await expect(harness.store.addContactAddress(id, fields)).rejects.toThrow();
    expect(harness.documentStores.get(id)?.getSnapshot().rows).toEqual([]);
  } finally {
    harness.close();
  }
});

test("rechecks scope at the effect after hydration returns", async () => {
  let onHydratedSnapshot: (() => void) | undefined;
  let writes = 0;
  const harness = await createContactAddressHarness((document) => ({
    ...document,
    getSnapshot: () => {
      const callback = onHydratedSnapshot;
      onHydratedSnapshot = undefined;
      if (callback) queueMicrotask(callback);
      return document.getSnapshot();
    },
    addRow: async (fields) => {
      writes++;
      return document.addRow(fields);
    },
  }));
  try {
    const id = await harness.store.createContact({ firstName: "Ada" });
    if (!id) throw new Error("Missing contact");
    onHydratedSnapshot = () =>
      harness.store.updateRuntime({
        ...harness.runtime,
        documents: {
          ...harness.runtime.documents,
          auth: { ...harness.runtime.documents.auth, userId: "other" },
        },
      });
    const result = await harness.store.addContactAddress(id, fields).then(
      () => null,
      (error: unknown) => error,
    );
    expect(result).toBeInstanceOf(Error);
    expect(writes).toBe(0);
  } finally {
    harness.close();
  }
});
