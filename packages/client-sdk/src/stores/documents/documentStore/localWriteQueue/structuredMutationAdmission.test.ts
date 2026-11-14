import { expect, test } from "bun:test";
import { createMutationAdmissionFixture } from "../../../../../test/helpers/mutationAdmission";

for (const guarded of [false, true]) {
  test(`a refused guarded patch cannot supersede an earlier ${guarded ? "guarded" : "coalescible"} write`, async () => {
    const f = await createMutationAdmissionFixture(
      `admission-coalescing-${guarded}`,
    );
    try {
      expect(await f.store.ensureInitialized()).toBe(true);
      const hold = f.holdCommit();
      const blocker = f.store.setText("held predecessor");
      await hold.entered;
      const earlier = f.store.setStructuredFields(
        "contact",
        { firstName: "valid" },
        guarded ? { stillCurrent: () => true } : undefined,
      );
      let current = true;
      const later = f.store.setStructuredFields(
        "contact",
        { firstName: "refused" },
        {
          stillCurrent: () => current,
        },
      );
      current = false;
      hold.release();
      await Promise.all([blocker, earlier, later]);
      expect(f.store.getSnapshot().structuredFields).toHaveProperty(
        "firstName",
        "valid",
      );
      expect((await f.reopen()).structuredFields).toHaveProperty(
        "firstName",
        "valid",
      );
      expect((await f.readOutgoing()).structuredFields).toHaveProperty(
        "firstName",
        "valid",
      );
      expect(f.store.hasQueuedWrites()).toBe(false);
      expect(f.store.hasUnsavedLocalEdits()).toBe(false);
    } finally {
      f.close();
    }
  });
}

test("guarded structured fields never publish or persist after queue authority expires", async () => {
  const f = await createMutationAdmissionFixture("admission-structured-queue");
  try {
    expect(await f.store.ensureInitialized()).toBe(true);
    await f.store.setStructuredFields("contact", { firstName: "original" });
    const published: (string | undefined)[] = [];
    const unsubscribe = f.store.subscribe(() => {
      const { firstName } = f.store.getSnapshot().structuredFields;
      published.push(firstName);
    });
    const hold = f.holdCommit();
    const blocker = f.store.setText("held predecessor");
    await hold.entered;
    let current = true;
    const write = f.store.setStructuredFields(
      "contact",
      { firstName: "refused" },
      {
        stillCurrent: () => current,
      },
    );
    current = false;
    hold.release();
    await Promise.all([blocker, write]);
    unsubscribe();
    expect(f.store.hasQueuedWrites()).toBe(false);
    expect(f.store.hasUnsavedLocalEdits()).toBe(false);
    expect(f.store.getSnapshot().structuredFields).toHaveProperty(
      "firstName",
      "original",
    );
    expect((await f.reopen()).structuredFields).toHaveProperty(
      "firstName",
      "original",
    );
    expect((await f.readOutgoing()).structuredFields).toHaveProperty(
      "firstName",
      "original",
    );
    expect(published).not.toContain("refused");
    await f.store.setText("accepted successor");
    expect((await f.reopen()).structuredFields).toHaveProperty(
      "firstName",
      "original",
    );
  } finally {
    f.close();
  }
});
