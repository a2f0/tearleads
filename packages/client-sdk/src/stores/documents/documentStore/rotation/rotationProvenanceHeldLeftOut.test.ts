import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  importSnapshot,
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
