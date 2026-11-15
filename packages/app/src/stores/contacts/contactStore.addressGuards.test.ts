import { expect, test } from "bun:test";
import { createContactAddressHarness } from "../../../test/helpers/contacts/contactAddressHarness";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { readContactAddressFields } from "../../document-types/contact/contactAddressModel";
import { ContactAddressWriteRefusal } from "../../document-types/contact/contactAddressWriteRefusal";
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
      addRow: async (...args) => {
        mutations++;
        return document.addRow(...args);
      },
      updateRowFields: async (...args) => {
        mutations++;
        await document.updateRowFields(...args);
      },
      removeRow: async (...args) => {
        mutations++;
        await document.removeRow(...args);
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
      // Pre-effect: the editor may dismiss the draft, and nothing is logged.
      expect(await result).toBeInstanceOf(ContactAddressWriteRefusal);
      expect(mutations).toBe(0);
      expect(harness.errors).toEqual([]);
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
      addRow: async (...args) => {
        writes++;
        return document.addRow(...args);
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
      expect(await result).toBeInstanceOf(ContactAddressWriteRefusal);
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
    await expect(
      harness.store.addContactAddress(id, fields),
    ).rejects.toBeInstanceOf(ContactAddressWriteRefusal);
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
    addRow: async (...args) => {
      writes++;
      return document.addRow(...args);
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

for (const operation of ["update", "remove"] as const) {
  test(`queued ${operation} refuses a row retyped before SDK admission`, async () => {
    let retypeId: string | null = null;
    const harness = await createContactAddressHarness((document) => {
      // A concurrent change lands after the writer's preflight, while the
      // SDK write queue has not yet admitted the row mutation.
      const retype = async () => {
        const id = retypeId;
        retypeId = null;
        if (id) await document.updateRowFields(id, { recordType: "future" });
      };
      return {
        ...document,
        updateRowFields: async (id, patch, options) => {
          await retype();
          await document.updateRowFields(id, patch, options);
        },
        removeRow: async (id, options) => {
          await retype();
          await document.removeRow(id, options);
        },
      };
    });
    try {
      const id = await harness.store.createContact({ firstName: "Ada" });
      if (!id) throw new Error("Missing contact");
      const row = await harness.store.addContactAddress(id, fields);
      if (!row) throw new Error("Missing address");
      retypeId = row;
      await expect(
        operation === "update"
          ? harness.store.updateContactAddress(id, row, { street: "Other" })
          : harness.store.removeContactAddress(id, row),
      ).rejects.toThrow();
      const rows = harness.documentStores.get(id)?.getSnapshot().rows;
      expect(rows?.map((entry) => entry.fields)).toEqual([
        { ...fields, recordType: "future" },
      ]);
    } finally {
      harness.close();
    }
  });
}
