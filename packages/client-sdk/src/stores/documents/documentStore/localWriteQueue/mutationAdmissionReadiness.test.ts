import { expect, test } from "bun:test";
import { createMutationAdmissionFixture } from "../../../../../test/helpers/mutationAdmission";
import type { DocumentMutationGuard, DocumentStore } from "../../types";

const operations = ["add", "update", "remove", "structured"] as const;
type Operation = (typeof operations)[number];

function mutate(
  store: DocumentStore,
  operation: Operation,
  id: string,
  options: DocumentMutationGuard,
) {
  if (operation === "add") return store.addRow({ value: "new" }, options);
  if (operation === "update")
    return store.updateRowFields(id, { value: "new" }, options);
  if (operation === "remove") return store.removeRow(id, options);
  return store.setStructuredFields("contact", { firstName: "new" }, options);
}

for (const operation of operations) {
  test(`${operation} rechecks host authority after delayed readiness`, async () => {
    const f = await createMutationAdmissionFixture(
      `admission-ready-${operation}`,
    );
    try {
      expect(await f.store.ensureInitialized()).toBe(true);
      const id = await f.store.addRow({ value: "original" });
      const original = f.store.getSnapshot();
      const queue = await f.queued();
      const fresh = f.open();
      const hold = f.holdReadiness();
      let current = true;
      const options = { stillCurrent: () => current };
      const write = mutate(fresh, operation, id, options);
      await hold.entered;
      expect(fresh.getSnapshot().ready).toBe(false);
      current = false;
      hold.release();
      const result = await write;
      if (operation === "add") expect(result).toEqual(expect.any(String));
      expect(fresh.hasQueuedWrites()).toBe(false);
      expect(fresh.hasUnsavedLocalEdits()).toBe(false);
      expect(fresh.getSnapshot().rows).toEqual(original.rows);
      expect(fresh.getSnapshot().structuredFields).toEqual(
        original.structuredFields,
      );
      expect((await f.reopen()).rows).toEqual(original.rows);
      expect((await f.reopen()).structuredFields).toEqual(
        original.structuredFields,
      );
      expect(await f.queued()).toEqual(queue);
      current = true;
      await mutate(fresh, operation, id, options);
      const durable = await f.reopen();
      if (operation === "structured")
        expect(durable.structuredFields).toHaveProperty("firstName", "new");
      else if (operation === "remove") expect(durable.rows).toEqual([]);
      else
        expect(
          durable.rows.some(({ fields: { value } }) => value === "new"),
        ).toBe(true);
    } finally {
      f.close();
    }
  });
}

for (const phase of ["readiness", "queue"] as const) {
  for (const operation of operations) {
    test(`${operation} throwing admission at ${phase} leaves a usable write queue`, async () => {
      const f = await createMutationAdmissionFixture(
        `admission-throw-${phase}-${operation}`,
      );
      try {
        expect(await f.store.ensureInitialized()).toBe(true);
        const id = await f.store.addRow({ value: "original" });
        const original = f.store.getSnapshot();
        const hold = f.holdCommit();
        const blocker = f.store.setText("held predecessor");
        await hold.entered;
        const error = new Error("host admission failed");
        let throwing = phase === "readiness";
        const write = mutate(f.store, operation, id, {
          stillCurrent: () => {
            if (throwing) throw error;
            return true;
          },
        });
        await f.store.ensureInitialized();
        throwing = true;
        hold.release();
        await Promise.all([blocker, write]);
        expect(f.errors).toEqual([error]);
        expect(f.store.hasQueuedWrites()).toBe(false);
        expect(f.store.hasUnsavedLocalEdits()).toBe(false);
        expect(f.store.getSnapshot().rows).toEqual(original.rows);
        expect(f.store.getSnapshot().structuredFields).toEqual(
          original.structuredFields,
        );
        expect((await f.reopen()).rows).toEqual(original.rows);
        await f.store.setStructuredFields("contact", {
          firstName: "successor",
        });
        expect(f.store.getSnapshot().structuredFields).toHaveProperty(
          "firstName",
          "successor",
        );
        expect((await f.reopen()).structuredFields).toHaveProperty(
          "firstName",
          "successor",
        );
      } finally {
        f.close();
      }
    });
  }
}
