import { expect, test } from "bun:test";
import {
  encodeVersionVector,
  exportUpdatesSince,
  satisfiesVersionVector,
  versionVectorsEqual,
} from "@tearleads/loro";
import { createCoverageFixture } from "../../../../../test/helpers/stores/syncOutgoingCoverage";
import { createPendingUpdateFields } from "../../../../data/documents/documentSync";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import { enqueuePendingDocumentUpdate } from "../../../../workflows/documents";
import { persistDocument } from "../persistence";
import { prepareDocumentOutgoingCoverage } from "./syncOutgoingCoverage";
import { mergeQueuedDocumentUpdates } from "./syncQueueMerge";
import { extendDocumentVersionCoverage } from "./versionCoverage";

type Fixture = Awaited<ReturnType<typeof createCoverageFixture>>;

const queued = (fixture: Fixture) =>
  sqlDocumentsPersistence.listPendingUpdates(fixture.execSql, fixture.localId);

/**
 * A sync pass that listed the queue before a local write's row committed:
 * it sees none of that row, and reads the live document after the write
 * applied its edit.
 */
const prepareFromStaleListing = (fixture: Fixture) =>
  prepareDocumentOutgoingCoverage({
    currentDoc: fixture.document,
    generation: fixture.generation,
    pendingUpdates: [],
    state: fixture.state,
  });

/** Whether the queued rows, from the fixture's base, cover `version`. */
async function queueCovers(fixture: Fixture, version: string) {
  const coverage = extendDocumentVersionCoverage({
    baseVersion: fixture.baseVersion,
    documentVersion: version,
    spans: await queued(fixture),
  });
  return satisfiesVersionVector(coverage, version);
}

// The issue's order: the local write's row commits after the pass listed
// the queue, but before the pass enqueues. The pass exports the same delta
// the write queued, byte for byte, and queues nothing (#3230).
test("a pass racing a local write's row does not queue the edit again", async () => {
  const fixture = await createCoverageFixture("coverage-race-row-first", true);
  try {
    const [local] = await queued(fixture);
    if (!local) throw new Error("Expected the local write's row");

    const prepared = await prepareFromStaleListing(fixture);

    expect(prepared?.pendingUpdates.map(({ id }) => id)).toEqual([local.id]);
    expect(await queued(fixture)).toEqual([local]);
    expect(
      versionVectorsEqual(
        fixture.state.pendingBaseVersion,
        fixture.documentVersion,
      ),
    ).toBe(true);
  } finally {
    fixture.close();
  }
});

// A queued row holding some of the delta's operations, not all of them, is
// no reason to skip: the pass queues the whole delta, so nothing goes
// unqueued, at the cost of sending the overlap twice.
test("a queued row overlapping the delta does not stop the pass queuing it", async () => {
  const fixture = await createCoverageFixture("coverage-race-overlap", false);
  try {
    // A local write queued the first edit; a second edit is on the live
    // document only.
    await enqueuePendingDocumentUpdate({
      execSql: fixture.execSql,
      localId: fixture.localId,
      persistence: sqlDocumentsPersistence,
      update: exportUpdatesSince(fixture.document, fixture.baseVersion),
    });
    fixture.document.getText("text").update("local edit, and another");
    fixture.document.commit();
    const documentVersion = encodeVersionVector(fixture.document);

    await prepareFromStaleListing(fixture);

    const rows = await queued(fixture);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.updateData).toBe(
      createPendingUpdateFields(
        exportUpdatesSince(fixture.document, fixture.baseVersion),
      )?.updateData,
    );
    expect(await queueCovers(fixture, documentVersion)).toBe(true);
  } finally {
    fixture.close();
  }
});

// Only a local row stands for the delta: an outbox row holding the same
// bytes has no history-tail role, so the pass still queues a local one.
test("an outbox row with the same bytes does not stop the pass queuing", async () => {
  const fixture = await createCoverageFixture("coverage-race-outbox", true);
  try {
    await fixture.execSql(
      "UPDATE document_history_updates SET origin = 'outbox'",
    );

    await prepareFromStaleListing(fixture);

    expect((await queued(fixture)).map(({ origin }) => origin)).toEqual([
      "outbox",
      "local",
    ]);
  } finally {
    fixture.close();
  }
});

// The other order, which the enqueue cannot see: the pass queues the delta
// first, and the local write that exported the same delta before the pass
// ran commits its row after. The pass's queue merge, before it sends,
// collapses the two into one update.
test("a local write's row landing after the pass's row merges with it", async () => {
  const fixture = await createCoverageFixture(
    "coverage-race-pass-first",
    false,
  );
  try {
    const update = exportUpdatesSince(fixture.document, fixture.baseVersion);
    const pendingUpdate = createPendingUpdateFields(update);
    if (!pendingUpdate) throw new Error("Expected the local delta");

    const prepared = await prepareFromStaleListing(fixture);
    expect(prepared?.pendingUpdates).toHaveLength(1);
    await persistDocument(
      fixture.state,
      fixture.document,
      { snapshotEndVersion: fixture.documentVersion },
      { pendingUpdate, preserveSnapshotText: true },
      fixture.generation,
    );
    const rows = await queued(fixture);
    expect(rows.map(({ updateData }) => updateData)).toEqual([
      pendingUpdate.updateData,
      pendingUpdate.updateData,
    ]);

    const merged = await mergeQueuedDocumentUpdates({
      currentDoc: fixture.document,
      generation: fixture.generation,
      pendingUpdates: rows,
      state: fixture.state,
    });

    expect(merged).toHaveLength(1);
    expect(await queued(fixture)).toEqual(merged);
    expect(merged[0]?.updateData).toBe(pendingUpdate.updateData);
    expect(await queueCovers(fixture, fixture.documentVersion)).toBe(true);
  } finally {
    fixture.close();
  }
});
