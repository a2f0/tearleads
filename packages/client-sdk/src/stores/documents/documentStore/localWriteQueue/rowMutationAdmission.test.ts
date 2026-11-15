import { expect, test } from "bun:test";
import { createMutationAdmissionFixture } from "../../../../../test/helpers/mutationAdmission";

for (const operation of ["add", "update", "remove"] as const) {
  test(`row ${operation} refuses expired authority at real queue execution`, async () => {
    const f = await createMutationAdmissionFixture(
      `admission-row-${operation}`,
    );
    try {
      expect(await f.store.ensureInitialized()).toBe(true);
      const rowId = await f.store.addRow({ value: "original" });
      const originalRows = [...f.store.getSnapshot().rows];
      const hold = f.holdCommit();
      const blocker = f.store.setText("held predecessor");
      await hold.entered;
      let current = true;
      const options = { stillCurrent: () => current };
      const write =
        operation === "add"
          ? f.store.addRow({ value: "refused" }, options)
          : operation === "update"
            ? f.store.updateRowFields(rowId, { value: "refused" }, options)
            : f.store.removeRow(rowId, options);
      // Let the row's readiness continuation enqueue behind the real commit.
      await f.store.ensureInitialized();
      current = false;
      hold.release();
      const [, result] = await Promise.all([blocker, write]);
      if (operation === "add") expect(result).toEqual(expect.any(String));
      expect(f.store.hasQueuedWrites()).toBe(false);
      expect(f.store.hasUnsavedLocalEdits()).toBe(false);
      expect(f.store.getSnapshot().rows).toEqual(originalRows);
      expect((await f.reopen()).rows).toEqual(originalRows);
      expect((await f.readOutgoing()).rows).toEqual(originalRows);
      // A later valid edit also exposes any hidden live-Loro mutation.
      await f.store.setText("accepted successor");
      expect((await f.reopen()).rows).toEqual(originalRows);
    } finally {
      f.close();
    }
  });
}
