import { expect, test } from "bun:test";
import { createContactAddressHarness } from "../../../test/helpers/contacts/contactAddressHarness";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { createContactsStore } from "./contactStore";

for (const recordType of ["postalAddress", "future"]) {
  test(`keeps duplicate self contacts carrying ${recordType} rows`, async () => {
    const harness = await createContactAddressHarness();
    try {
      const id = await harness.store.createContact({ isSelf: true });
      if (!id) throw new Error("Missing duplicate");
      await harness.documentStores
        .get(id)
        ?.addRow({ recordType, street: "Main" });
      await harness.store.ensureSelfContact({ localId: "primary" });
      expect(harness.deleted).not.toContain(id);
      expect(
        harness.store.getSnapshot().entries.some((entry) => entry.id === id),
      ).toBe(true);
    } finally {
      harness.close();
    }
  });
}

for (const content of ["address", "unknown", "empty", "incomplete"] as const) {
  test(`hydrates projection-only ${content} duplicate before cleanup`, async () => {
    const harness = await createContactAddressHarness();
    try {
      const id = await harness.store.createContact({ isSelf: true });
      if (!id) throw new Error("Missing duplicate");
      if (content !== "empty" && content !== "incomplete") {
        await harness.documentStores.get(id)?.addRow({
          recordType: content === "address" ? "postalAddress" : "future",
          street: "Main",
        });
      }
      let hydrated = false;
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
            ensureInitialized: async () => {
              hydrated = true;
              return content === "incomplete"
                ? false
                : document.ensureInitialized();
            },
          };
        },
      };
      const store = createContactsStore(runtime, {
        resolveVerified: async () => null,
        logError: () => {},
      });
      store.updateRuntime(runtime);
      await waitForCondition(
        () => store.getSnapshot().ready,
        "Projection did not load",
      );
      expect(
        store.getSnapshot().entries.find((entry) => entry.id === id)?.rows,
      ).toBeUndefined();
      await store.ensureSelfContact({ localId: "primary" });
      expect(hydrated).toBe(true);
      expect(harness.deleted.includes(id)).toBe(content === "empty");
    } finally {
      harness.close();
    }
  });
}

test("rechecks live rows before deleting a candidate whose snapshot entry is stale", async () => {
  const harness = await createContactAddressHarness((document) => ({
    ...document,
    subscribe: () => () => {},
  }));
  try {
    const id = await harness.store.createContact({ isSelf: true });
    if (!id) throw new Error("Missing duplicate");
    const laterEmptyId = await harness.store.createContact({ isSelf: true });
    if (!laterEmptyId) throw new Error("Missing later empty duplicate");
    const runtime = {
      ...harness.runtime,
      loadDocumentSummary: async (localId: string) => {
        if (localId === id)
          await harness.documentStores.get(id)?.addRow({
            recordType: "future",
            content: "arrived during cleanup",
          });
        return null;
      },
    };
    harness.store.updateRuntime(runtime);
    await harness.store.ensureSelfContact({ localId: "primary" });
    expect(harness.deleted).not.toContain(id);
    expect(harness.deleted).toContain(laterEmptyId);
  } finally {
    harness.close();
  }
});

test("a protected projection-only candidate does not block later empty duplicate cleanup", async () => {
  const harness = await createContactAddressHarness();
  try {
    const protectedId = await harness.store.createContact({ isSelf: true });
    const emptyId = await harness.store.createContact({ isSelf: true });
    if (!protectedId || !emptyId) throw new Error("Missing duplicates");
    await harness.documentStores
      .get(protectedId)
      ?.addRow({ recordType: "future" });
    const runtime = {
      ...harness.runtime,
      openDocumentStore: (
        input: Parameters<typeof harness.runtime.openDocumentStore>[0],
      ) => ({
        ...harness.runtime.openDocumentStore(input),
        subscribe: () => () => {},
      }),
    };
    const store = createContactsStore(runtime, {
      resolveVerified: async () => null,
      logError: () => {},
    });
    store.updateRuntime(runtime);
    await waitForCondition(
      () => store.getSnapshot().ready,
      "Projection did not load",
    );
    await store.ensureSelfContact({ localId: "primary" });
    expect(harness.deleted).not.toContain(protectedId);
    expect(harness.deleted).toContain(emptyId);
  } finally {
    harness.close();
  }
});

test("does not delete a duplicate with unsaved rows absent from its persisted snapshot", async () => {
  let dirty = false;
  const harness = await createContactAddressHarness((document) => ({
    ...document,
    hasUnsavedLocalEdits: () => dirty || document.hasUnsavedLocalEdits(),
  }));
  try {
    const id = await harness.store.createContact({ isSelf: true });
    if (!id) throw new Error("Missing duplicate");
    dirty = true;
    await harness.store.ensureSelfContact({ localId: "primary" });
    expect(harness.deleted).not.toContain(id);
  } finally {
    harness.close();
  }
});
