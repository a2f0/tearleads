import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  importSnapshot,
  importUpdates,
} from "@tearleads/loro";
import {
  assertExactDocumentHistory,
  RotationHistoryMismatchError,
} from "./rotationProvenance";

/** Whether the comparison blames an update left out with `end`. */
function heldLeftOut(input: {
  currentDocument: Awaited<ReturnType<typeof createDocument>>;
  end: string;
  rebuiltDocument: Awaited<ReturnType<typeof createDocument>>;
}): boolean {
  try {
    assertExactDocumentHistory({ ...input, leftOutEnds: [input.end] });
  } catch (error) {
    if (error instanceof RotationHistoryMismatchError) {
      return error.heldLeftOut;
    }
    throw error;
  }
  throw new Error("Expected the histories to differ");
}

// A rebuild that leaves an update out and differs from the live document
// blames it only when the live document holds counters the rebuild lacks
// within the update's declared span. A span forged over counters other
// updates committed is covered by the rebuild, so a difference there is
// someone else's.
test("a difference blames a left-out update only for counters it alone holds", async () => {
  const base = await createDocument("held-left-out-base");
  base.getText("text").update("base");
  base.commit();
  const baseVersion = encodeVersionVector(base);
  const current = await createDocument("held-left-out-current");
  importSnapshot(current, exportFullHistorySnapshot(base));
  current.getText("text").update("base and the left-out edit");
  current.commit();
  const heldEnd = encodeVersionVector(current);
  const rebuilt = await createDocument("held-left-out-rebuilt");
  importSnapshot(rebuilt, exportFullHistorySnapshot(base));
  const unheld = await createDocument("held-left-out-elsewhere");
  unheld.getText("text").update("never in the live document");
  unheld.commit();
  try {
    // The live document holds the left-out edit's counters.
    expect(
      heldLeftOut({
        currentDocument: current,
        end: heldEnd,
        rebuiltDocument: rebuilt,
      }),
    ).toBe(true);
    // A span the rebuild already covers, as a forged one would be.
    expect(
      heldLeftOut({
        currentDocument: current,
        end: baseVersion,
        rebuiltDocument: rebuilt,
      }),
    ).toBe(false);
    // A span the live document does not cover.
    expect(
      heldLeftOut({
        currentDocument: current,
        end: encodeVersionVector(unheld),
        rebuiltDocument: rebuilt,
      }),
    ).toBe(false);
  } finally {
    for (const doc of [base, current, rebuilt, unheld]) doc.free();
  }
});

// Loro groups consecutive inserts by the path that brought them. A writer
// holds what it typed across two uploads as one operation once a checkpoint
// regroups it, while a rebuild from those uploads holds two.
test("a writer whose inserts were uploaded in parts matches the rebuild of those uploads", async () => {
  // Inserts join only inside one change, which spans at most a second. Of
  // three attempts made back to back, at most one straddles a boundary.
  const operationCounts: { rebuilt: number; writer: number }[] = [];
  const operationCount = (doc: Awaited<ReturnType<typeof createDocument>>) =>
    doc
      .exportJsonUpdates(undefined, undefined, false)
      .changes.reduce((count, change) => count + change.ops.length, 0);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const writer = await createDocument(`uploaded-in-parts-${attempt}`);
    writer.getText("text").insert(0, "a".repeat(5));
    writer.commit();
    const first = exportUpdatesSince(writer);
    const held = encodeVersionVector(writer);
    writer.getText("text").insert(5, "b".repeat(30));
    writer.commit();
    const second = exportUpdatesSince(writer, held);
    // A save's checkpoint.
    exportFullHistorySnapshot(writer);
    const rebuilt = await createDocument(
      `uploaded-in-parts-rebuilt-${attempt}`,
    );
    importUpdates(rebuilt, [first]);
    importUpdates(rebuilt, [second]);

    expect(() =>
      assertExactDocumentHistory({
        currentDocument: writer,
        rebuiltDocument: rebuilt,
      }),
    ).not.toThrow();
    operationCounts.push({
      rebuilt: operationCount(rebuilt),
      writer: operationCount(writer),
    });
    writer.free();
    rebuilt.free();
  }
  // At least one attempt met the case: one operation against two.
  expect(operationCounts).toContainEqual({ rebuilt: 2, writer: 1 });
});
