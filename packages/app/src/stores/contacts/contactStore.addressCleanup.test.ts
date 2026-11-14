import { expect, test } from "bun:test";
import {
  createDocumentStore,
  defaultDocumentsPersistence,
} from "@tearleads/client-sdk";
import { createContactAddressHarness } from "../../../test/helpers/contacts/contactAddressHarness";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { createContactsStore } from "./contactStore";

type Harness = Awaited<ReturnType<typeof createContactAddressHarness>>;

async function durableContact(harness: Harness, id: string) {
  const execSql = harness.runtime.documents.infra.execSql;
  return {
    record: await defaultDocumentsPersistence.loadDocument(execSql, id),
    history: await defaultDocumentsPersistence.loadHistoryRestoreState(
      execSql,
      id,
    ),
  };
}

for (const recordType of ["postalAddress", "future"]) {
  test(`keeps a distinct self-labelled contact carrying ${recordType} rows`, async () => {
    const harness = await createContactAddressHarness();
    try {
      const id = await harness.store.createContact({ isSelf: true });
      if (!id) throw new Error("Missing distinct contact");
      const document = harness.documentStores.get(id);
      if (!document) throw new Error("Missing document store");
      const rowId = await document.addRow({ recordType, street: "Main" });
      const before = await durableContact(harness, id);
      expect(before.history).not.toBeNull();
      expect(
        await harness.store.ensureSelfContact({
          localId: harness.selfContactId,
          deferRemoteSync: true,
        }),
      ).toBe(harness.selfContactId);
      expect(await durableContact(harness, id)).toEqual(before);
      const reopened = createDocumentStore(id, harness.runtime.documents);
      expect(await reopened.ensureInitialized()).toBe(true);
      expect(reopened.getSnapshot().rows).toEqual([
        expect.objectContaining({
          id: rowId,
          fields: { recordType, street: "Main" },
        }),
      ]);
      expect(harness.errors).toEqual([]);
    } finally {
      harness.close();
    }
  });
}

for (const content of ["address", "unknown", "empty", "incomplete"] as const) {
  test(`preserves a projection-only ${content} distinct contact during Me ensure`, async () => {
    const harness = await createContactAddressHarness();
    const errors: unknown[] = [];
    try {
      const id = await harness.store.createContact({ isSelf: true });
      if (!id) throw new Error("Missing distinct contact");
      if (content === "address" || content === "unknown") {
        await harness.documentStores.get(id)?.addRow({
          recordType: content === "address" ? "postalAddress" : "future",
          street: "Main",
        });
      }
      const before = await durableContact(harness, id);
      const runtime = {
        ...harness.runtime,
        openDocumentStore: (
          input: Parameters<typeof harness.runtime.openDocumentStore>[0],
        ) => {
          const document = harness.runtime.openDocumentStore(input);
          if (input.localId !== id) return document;
          return {
            ...document,
            subscribe: () => () => {},
            ensureInitialized: () =>
              content === "incomplete"
                ? Promise.resolve(false)
                : document.ensureInitialized(),
          };
        },
      };
      const store = createContactsStore(runtime, {
        resolveVerified: async () => null,
        logError: (message, cause) => errors.push({ message, cause }),
      });
      store.updateRuntime(runtime);
      await waitForCondition(
        () => store.getSnapshot().ready,
        "Projection did not load",
      );
      expect(
        store.getSnapshot().entries.find((entry) => entry.id === id)?.rows,
      ).toBeUndefined();
      expect(
        await store.ensureSelfContact({
          localId: harness.selfContactId,
          deferRemoteSync: true,
        }),
      ).toBe(harness.selfContactId);
      // Neither incomplete hydration nor an empty projection grants deletion.
      expect(await durableContact(harness, id)).toEqual(before);
      expect(store.getSnapshot().entries.some((entry) => entry.id === id)).toBe(
        true,
      );
      expect(errors).toEqual([]);
    } finally {
      harness.close();
    }
  });
}

test("preserves live rows absent from a stale Contacts snapshot and an empty sibling", async () => {
  const harness = await createContactAddressHarness((document) => ({
    ...document,
    subscribe: () => () => {},
  }));
  try {
    const id = await harness.store.createContact({ isSelf: true });
    const emptyId = await harness.store.createContact({ isSelf: true });
    if (!id || !emptyId) throw new Error("Missing distinct contacts");
    await harness.documentStores.get(id)?.addRow({
      recordType: "future",
      content: "arrived after publication",
    });
    expect(
      harness.store.getSnapshot().entries.find((entry) => entry.id === id)
        ?.rows,
    ).toEqual([]);
    const before = await Promise.all(
      [id, emptyId].map((value) => durableContact(harness, value)),
    );
    await harness.store.ensureSelfContact({
      localId: harness.selfContactId,
      deferRemoteSync: true,
    });
    expect(
      await Promise.all(
        [id, emptyId].map((value) => durableContact(harness, value)),
      ),
    ).toEqual(before);
    expect(harness.errors).toEqual([]);
  } finally {
    harness.close();
  }
});

test("preserves both unknown-row and empty projection-only contacts", async () => {
  const harness = await createContactAddressHarness();
  const errors: unknown[] = [];
  try {
    const protectedId = await harness.store.createContact({ isSelf: true });
    const emptyId = await harness.store.createContact({ isSelf: true });
    if (!protectedId || !emptyId) throw new Error("Missing distinct contacts");
    await harness.documentStores
      .get(protectedId)
      ?.addRow({ recordType: "future" });
    const ids = [protectedId, emptyId];
    const before = await Promise.all(
      ids.map((id) => durableContact(harness, id)),
    );
    const store = createContactsStore(harness.runtime, {
      resolveVerified: async () => null,
      logError: (message, cause) => errors.push({ message, cause }),
    });
    store.updateRuntime(harness.runtime);
    await waitForCondition(
      () => store.getSnapshot().ready,
      "Projection did not load",
    );
    await store.ensureSelfContact({
      localId: harness.selfContactId,
      deferRemoteSync: true,
    });
    expect(
      await Promise.all(ids.map((id) => durableContact(harness, id))),
    ).toEqual(before);
    expect(errors).toEqual([]);
  } finally {
    harness.close();
  }
});

test("keeps a distinct contact's real unsaved row and permits its durable retry", async () => {
  const harness = await createContactAddressHarness();
  const commit = defaultDocumentsPersistence.commitDocumentMutation;
  try {
    const id = await harness.store.createContact({ isSelf: true });
    if (!id) throw new Error("Missing distinct contact");
    const document = harness.documentStores.get(id);
    if (!document) throw new Error("Missing document store");
    const before = await durableContact(harness, id);
    defaultDocumentsPersistence.commitDocumentMutation = async () => {
      throw new Error("Injected row persistence failure");
    };
    const rowId = await document.addRow({
      recordType: "future",
      content: "Unsaved",
    });
    expect(document.hasUnsavedLocalEdits()).toBe(true);
    defaultDocumentsPersistence.commitDocumentMutation = commit;
    await harness.store.ensureSelfContact({
      localId: harness.selfContactId,
      deferRemoteSync: true,
    });
    expect(await durableContact(harness, id)).toEqual(before);
    expect(document.hasUnsavedLocalEdits()).toBe(true);
    await document.setStructuredFields(
      "contact",
      {},
      { deferRemoteSync: true },
    );
    expect(document.hasUnsavedLocalEdits()).toBe(false);
    const reopened = createDocumentStore(id, harness.runtime.documents);
    expect(await reopened.ensureInitialized()).toBe(true);
    expect(reopened.getSnapshot().rows).toEqual([
      expect.objectContaining({
        id: rowId,
        fields: { recordType: "future", content: "Unsaved" },
      }),
    ]);
    expect(harness.errors).toEqual([]);
  } finally {
    defaultDocumentsPersistence.commitDocumentMutation = commit;
    harness.close();
  }
});
