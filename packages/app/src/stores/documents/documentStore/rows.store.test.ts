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
  // The count-based title is derived from the row axis, not structured fields.
  expect(store.getSnapshot().title).toBe("Blood Pressure (1 reading)");

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
