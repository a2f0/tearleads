import { expect, test } from "bun:test";
import { createMutationAdmissionFixture } from "../../../../../test/helpers/mutationAdmission";

for (const operation of ["row retry", "empty structured flush"] as const) {
  test(`expired ${operation} cannot flush a failed predecessor's pending delta`, async () => {
    const f = await createMutationAdmissionFixture(
      `admission-retry-${operation}`,
    );
    try {
      expect(await f.store.ensureInitialized()).toBe(true);
      const id = await f.store.addRow({ value: "original" });
      const originalRows = [...f.store.getSnapshot().rows];
      const queue = await f.queued();
      const hold = f.holdCommit(true);
      const failed = f.store.updateRowFields(id, { value: "unsaved" });
      await hold.entered;
      let current = true;
      const options = { stillCurrent: () => current };
      const refused =
        operation === "row retry"
          ? f.store.updateRowFields(id, { value: "unsaved" }, options)
          : f.store.setStructuredFields("contact", {}, options);
      await f.store.ensureInitialized();
      current = false;
      hold.release();
      await Promise.all([failed, refused]);
      expect(f.errors).toHaveLength(1);
      expect(f.store.hasQueuedWrites()).toBe(false);
      expect(f.store.hasUnsavedLocalEdits()).toBe(true);
      expect(await f.queued()).toEqual(queue);
      expect((await f.reopen()).rows).toEqual(originalRows);
      expect((await f.readOutgoing()).rows).toEqual(originalRows);
      // Admission is not a rollback: the earlier failed edit remains retryable.
      await f.store.setStructuredFields(
        "contact",
        {},
        { stillCurrent: () => true },
      );
      expect(f.store.hasUnsavedLocalEdits()).toBe(false);
      expect((await f.reopen()).rows[0]?.fields).toHaveProperty(
        "value",
        "unsaved",
      );
      expect((await f.readOutgoing()).rows[0]?.fields).toHaveProperty(
        "value",
        "unsaved",
      );
    } finally {
      f.close();
    }
  });
}

test("guarded deferred fields stay history-only until an admitted flush", async () => {
  const f = await createMutationAdmissionFixture("admission-deferred-flush");
  try {
    expect(await f.store.ensureInitialized()).toBe(true);
    const queue = await f.queued();
    await f.store.setStructuredFields(
      "contact",
      { firstName: "deferred" },
      {
        stillCurrent: () => true,
        deferRemoteSync: true,
      },
    );
    expect((await f.reopen()).structuredFields).toHaveProperty(
      "firstName",
      "deferred",
    );
    expect(await f.queued()).toEqual(queue);
    await f.store.setStructuredFields(
      "contact",
      {},
      { stillCurrent: () => false },
    );
    expect(await f.queued()).toEqual(queue);
    await f.store.setStructuredFields(
      "contact",
      {},
      { stillCurrent: () => true },
    );
    expect((await f.readOutgoing()).structuredFields).toHaveProperty(
      "firstName",
      "deferred",
    );
  } finally {
    f.close();
  }
});
