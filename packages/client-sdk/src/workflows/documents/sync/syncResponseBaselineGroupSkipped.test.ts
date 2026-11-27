// A baseline run says how far a pull has followed a group. Segments a page
// did not apply must never move it on as if it had: one that failed before
// the judge ran is carried as unapplied, and a page the judge deferred or
// held carries no run at all, because its pull starts over.
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  createDocument,
  emptyVersionVector,
  encodeVersionVectorCounters,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { servedBaselineGroup } from "../../../../test/helpers/workflows/servedBaselineGroupPass";
import type { BaselineGroupRun } from "../../../data/documents/shared/sync/baselineGroupMachine";
import { settleBaselineGroupVerdicts } from "../../../data/documents/shared/sync/baselineGroupProgress";
import {
  EVERY_OPERATION_UNAPPLIED,
  MAX_UNAPPLIED_BASELINE_SPANS,
} from "../../../data/documents/shared/sync/baselineGroupUnapplied";
import { isDocumentSyncUpdateIsolationError } from "../../../data/documents/shared/sync/documentSyncUpdateIsolation";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";

type ServedUpdate = DocumentSyncResponse["updates"][number];

let execSql: ExecSql;
let closeExecSql: () => void;

beforeEach(async () => {
  ({ close: closeExecSql, execSql } = await createTestExecSql(
    "baseline-group-skipped",
  ));
});

afterEach(() => closeExecSql());

const BASELINE = "baseline-1";

/** A served segment that declares operations `[start, end)` of `peerId`. */
function segment(
  index: number,
  peerId: string,
  start: number,
  end: number,
): ServedUpdate {
  return {
    accessEpoch: 2,
    authorFingerprint: "writer",
    baselineId: BASELINE,
    baselineSegmentIndex: index,
    createdAt: "2026-04-27T00:00:00.000Z",
    dependencyVersionVector: emptyVersionVector(),
    documentId: "6f1b1f8e-4f5a-4c4e-9a52-6f0a1b2c3d4e",
    encryptedData: "ciphertext",
    id: `segment-${index}`,
    partialEndVersionVector: encodeVersionVectorCounters({ [peerId]: end }),
    partialStartVersionVector:
      start === 0
        ? emptyVersionVector()
        : encodeVersionVectorCounters({ [peerId]: start }),
    plaintextHash: "plaintext",
    writeHeader: {},
  };
}

const runAt = (
  nextIndex: number,
  unapplied: BaselineGroupRun["unapplied"] = [],
): BaselineGroupRun => ({
  baselineId: BASELINE,
  digest: "ab".repeat(32),
  nextIndex,
  unapplied,
});

// A segment voided before the judge ran (its ciphertext does not open under
// the committed key) reaches the settlement as an update the page did not
// apply, with no missing operations named. Its declared span is carried, so
// the segment that builds on it is void for every reader instead of a
// segment the server withheld the base of.
test("a segment that failed to decrypt is carried as unapplied, never as applied", () => {
  const failed = segment(1, "7", 4, 9);
  const applied = segment(0, "7", 0, 4);
  const carried = settleBaselineGroupVerdicts({
    appliedUpdateIds: new Set([applied.id]),
    nextRun: runAt(2),
    run: null,
    updates: [applied, failed],
    // Decrypt voids are not import verdicts: the judge never saw the segment.
    voided: [],
  });
  expect(carried).toEqual(
    runAt(2, [{ endCounter: 9, peerId: "7", startCounter: 4 }]),
  );

  // The next page: a segment that lacks exactly those operations is void.
  const dependent = segment(2, "7", 9, 12);
  const missing = [{ endCounter: 9, peerId: "7", startCounter: 4 }];
  expect(
    settleBaselineGroupVerdicts({
      appliedUpdateIds: new Set(),
      nextRun: runAt(3),
      run: carried,
      updates: [dependent],
      voided: [{ missingOperations: missing, updateId: dependent.id }],
    }),
  ).toEqual(runAt(3, [{ endCounter: 12, peerId: "7", startCounter: 4 }]));
  // Had the failed segment been counted as applied, nothing would excuse the
  // dependent one, and the pass would fail on an honest server.
  expect(() =>
    settleBaselineGroupVerdicts({
      appliedUpdateIds: new Set(),
      nextRun: runAt(3),
      run: runAt(2),
      updates: [dependent],
      voided: [{ missingOperations: missing, updateId: dependent.id }],
    }),
  ).toThrow();
});

// The API bounds a segment's spans only by its stage's total, so a writing
// member can commit a group whose void segments name more peers than a run
// lists. Failing the pass on it stopped every reader of the document for
// good, for that one member's doing. The run carries every operation as
// unapplied instead: the pass goes on, and what of that writer's group
// cannot join is void.
test("a group whose void segments name more peers than a run lists does not fail the pass", () => {
  const peers = Array.from({ length: MAX_UNAPPLIED_BASELINE_SPANS }, (_, n) =>
    String(10_000_000 + n),
  );
  const full = runAt(
    2,
    peers.map((peerId) => ({ endCounter: 1, peerId, startCounter: 0 })),
  );
  const again = segment(2, peers[0] ?? "", 1, 2);
  // Another segment of a peer already carried adds no span.
  expect(
    settleBaselineGroupVerdicts({
      appliedUpdateIds: new Set(),
      nextRun: runAt(3),
      run: full,
      updates: [again],
      voided: [],
    })?.unapplied,
  ).toHaveLength(MAX_UNAPPLIED_BASELINE_SPANS);

  // One peer more than a run lists: every operation is carried.
  const onePeerMore = segment(2, "99999999", 0, 1);
  const over = settleBaselineGroupVerdicts({
    appliedUpdateIds: new Set(),
    nextRun: runAt(3),
    run: full,
    updates: [onePeerMore],
    voided: [],
  });
  expect(over).toEqual(runAt(3, EVERY_OPERATION_UNAPPLIED));

  // A later segment of the group that lacks operations no listed span
  // named is void, and the run stays as it is.
  const dependent = segment(3, "424242", 5, 9);
  const missing = [{ endCounter: 5, peerId: "424242", startCounter: 0 }];
  const settle = (run: BaselineGroupRun | null) =>
    settleBaselineGroupVerdicts({
      appliedUpdateIds: new Set(),
      nextRun: runAt(4),
      run,
      updates: [dependent],
      voided: [{ missingOperations: missing, updateId: dependent.id }],
    });
  expect(settle(over)).toEqual(runAt(4, EVERY_OPERATION_UNAPPLIED));
  // Under a run that lists its spans the same segment is one the server
  // served without what it builds on, which still fails the pass.
  let failure: unknown;
  try {
    settle(full);
  } catch (error) {
    failure = error;
  }
  if (!isDocumentSyncUpdateIsolationError(failure)) {
    throw new Error("Expected the pass to fail on its baseline group");
  }
  expect(failure.stage).toBe("baseline_group");
});

// A page that ends inside a group and applies all of it carries the run on.
// The same page with a segment deferred or held applies only part, so it
// carries no run and no cursor: its pull starts over, and the group is read
// from its first segment again.
test.each(["deferredUpdateIds", "heldUpdateIds"] as const)(
  "a page with %s carries no baseline run forward",
  async (skipped) => {
    const { pass, segments } = await servedBaselineGroup(execSql);
    const firstPage = segments.slice(0, 3);
    const lastOnPage = firstPage.at(-1);
    if (!lastOnPage) throw new Error("Expected segments");

    const whole = await pass({
      more: true,
      reader: await createDocument(crypto.randomUUID()),
      updates: firstPage,
    });
    expect(whole.baselineGroupRun).toMatchObject({ nextIndex: 3 });
    expect(whole.response.pullPage?.nextCursor).toBe("page-next");

    const partial = await pass({
      more: true,
      reader: await createDocument(crypto.randomUUID()),
      updates: firstPage,
      verdicts: (judged) => ({ ...judged, [skipped]: [lastOnPage.id] }),
    });
    expect(partial.baselineGroupRun).toBeNull();
    expect(partial.response.pullPage).toMatchObject({
      hasMore: false,
      nextCursor: null,
    });
  },
);
