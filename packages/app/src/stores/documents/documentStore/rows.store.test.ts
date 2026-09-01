import { expect, test } from "bun:test";
import { createDocumentStore } from "@tearleads/client-sdk";
import {
  createDocumentStorePersistence,
  createDocumentStoreRuntime,
} from "../../../../test/helpers/documentStoreFixtures";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

test("blood pressure store adds, updates, and removes readings via the row axis", async () => {
  const persistence = createDocumentStorePersistence();
  const runtime = createDocumentStoreRuntime();
  const store = createDocumentStore(
    "bp-rows",
    runtime,
    persistence,
    null,
    "",
    "blood_pressure",
  );

  store.updateRuntime(runtime);
  await waitForCondition(
    () => store.getSnapshot().ready,
    "Blood pressure store did not become ready.",
  );
  expect(store.getSnapshot().rows).toEqual([]);

  const readingId = await store.addRow({
    systolic: "120",
    diastolic: "80",
    pulse: "72",
    measuredAt: "2026-07-16T08:30",
    notes: "Before coffee",
  });
  await waitForCondition(
    () => store.getSnapshot().rows.length === 1,
    "Reading was not added.",
  );

  const added = store.getSnapshot().rows[0];
  expect(added?.id).toBe(readingId);
  expect(added?.fields).toEqual({
    systolic: "120",
    diastolic: "80",
    pulse: "72",
    measuredAt: "2026-07-16T08:30",
    notes: "Before coffee",
  });
  // Attribution is stamped even though the test runtime is unauthenticated.
  expect((added?.updatedAt ?? "").length).toBeGreaterThan(0);
  expect(store.getSnapshot().title).toBe("Blood Pressure Tracker");

  const readingCell = (field: string): string | undefined =>
    store.getSnapshot().rows[0]?.fields[field];

  await store.updateRowFields(readingId, { systolic: "130" });
  await waitForCondition(
    () => readingCell("systolic") === "130",
    "Reading was not updated.",
  );
  // Only the edited cell changes; the rest of the row is preserved.
  expect(readingCell("diastolic")).toBe("80");

  await store.setStructuredFields("blood_pressure", {
    trackerName: "Home log",
  });
  await waitForCondition(
    () => store.getSnapshot().title === "Home log",
    "Tracker name did not drive the title.",
  );

  await store.removeRow(readingId);
  await waitForCondition(
    () => store.getSnapshot().rows.length === 0,
    "Reading was not removed.",
  );
});

test("row mutations are no-ops without write access", async () => {
  const persistence = createDocumentStorePersistence();
  const writableRuntime = createDocumentStoreRuntime();
  const writableStore = createDocumentStore(
    "bp-readonly",
    writableRuntime,
    persistence,
    null,
    "",
    "blood_pressure",
  );

  writableStore.updateRuntime(writableRuntime);
  await waitForCondition(
    () => writableStore.getSnapshot().ready,
    "Writable store did not become ready.",
  );

  const readingId = await writableStore.addRow({
    systolic: "120",
    diastolic: "80",
    pulse: "",
    measuredAt: "",
    notes: "",
  });
  await waitForCondition(
    () => writableStore.getSnapshot().rows.length === 1,
    "Reading was not persisted.",
  );

  // Downgrade the persisted record to read-only, then reload it in a fresh
  // store. The client-side gate is a UX guard — the API independently rejects
  // unauthorized writes — that stops a read-only viewer from making a local
  // change that could never be flushed.
  const persisted = persistence.getState().document;
  if (!persisted) {
    throw new Error("expected a persisted document record");
  }
  persistence.getState().document = {
    ...persisted,
    effectiveAccessLevel: "read",
  };

  const readOnlyRuntime = createDocumentStoreRuntime();
  const readOnlyStore = createDocumentStore(
    "bp-readonly",
    readOnlyRuntime,
    persistence,
    null,
    "",
    "blood_pressure",
  );
  readOnlyStore.updateRuntime(readOnlyRuntime);
  await waitForCondition(
    () => readOnlyStore.getSnapshot().ready,
    "Read-only store did not become ready.",
  );

  expect(readOnlyStore.getSnapshot().canWrite).toBe(false);
  expect(readOnlyStore.getSnapshot().effectiveAccessLevel).toBe("read");
  // The reading persisted by the writable store reloads through the row axis.
  expect(readOnlyStore.getSnapshot().rows).toHaveLength(1);

  const pendingUpdatesBefore = persistence.getState().pendingUpdates.length;

  await readOnlyStore.addRow({
    systolic: "200",
    diastolic: "100",
    pulse: "",
    measuredAt: "",
    notes: "",
  });
  await readOnlyStore.updateRowFields(readingId, { systolic: "200" });
  await readOnlyStore.removeRow(readingId);

  // No mutation landed: the row list is untouched and nothing was enqueued.
  const rows = readOnlyStore.getSnapshot().rows;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ fields: { systolic: "120" } });
  expect(persistence.getState().pendingUpdates.length).toBe(
    pendingUpdatesBefore,
  );
});
