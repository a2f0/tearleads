// What an unapplied segment of a rotation baseline excuses: the operations
// it declared, and no others. The pass-level cases are in
// `syncResponseBaselineGroupVoidSpans.test.ts`.
import { expect, test } from "bun:test";
import {
  emptyVersionVector,
  encodeVersionVectorCounters,
} from "@tearleads/loro";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import type { BaselineGroupRun } from "./baselineGroupMachine";
import { settleBaselineGroupVerdicts } from "./baselineGroupProgress";
import {
  unappliedOperationSpans,
  unappliedOperationsOf,
  unappliedSegmentsDeclared,
  withUnappliedSegment,
} from "./baselineGroupUnapplied";
import { isDocumentSyncUpdateIsolationError } from "./documentSyncUpdateIsolation";
import type { DocumentOperationSpan } from "./documentUpdateVerdict";

type ServedUpdate = DocumentSyncResponse["updates"][number];
type Counters = Readonly<Record<string, number>>;

const A = "baseline-a";

function span(
  peerId: string,
  startCounter: number,
  endCounter: number,
): DocumentOperationSpan {
  return { endCounter, peerId, startCounter };
}

/** The vectors of a segment that declares `[start, end)` for each peer. */
function declares(start: Counters, end: Counters) {
  return {
    partialEndVersionVector: encodeVersionVectorCounters(end),
    partialStartVersionVector: encodeVersionVectorCounters(start),
  };
}

/** A served segment with the fields the verdicts read, and no payload. */
function segment(
  id: string,
  start: Counters,
  end: Counters,
  baselineId: string | null = A,
): ServedUpdate {
  return {
    accessEpoch: 2,
    authorFingerprint: "writer",
    createdAt: "2026-04-27T00:00:00.000Z",
    dependencyVersionVector: emptyVersionVector(),
    documentId: "6f1b1f8e-4f5a-4c4e-9a52-6f0a1b2c3d4e",
    encryptedData: "ciphertext",
    id,
    plaintextHash: "plaintext",
    writeHeader: {},
    ...declares(start, end),
    ...(baselineId === null
      ? {}
      : { baselineId, baselineSegmentIndex: Number(id.slice(1)) }),
  };
}

function run(unapplied: readonly DocumentOperationSpan[] = []) {
  return { baselineId: A, digest: null, nextIndex: 9, unapplied };
}

interface Page {
  readonly applied?: readonly string[];
  readonly missing?: Readonly<Record<string, readonly DocumentOperationSpan[]>>;
  readonly nextRun?: BaselineGroupRun | null;
  readonly run?: BaselineGroupRun | null;
  readonly updates: readonly ServedUpdate[];
}

function settle(page: Page) {
  return settleBaselineGroupVerdicts({
    appliedUpdateIds: new Set(page.applied ?? []),
    nextRun: page.nextRun === undefined ? run() : page.nextRun,
    run: page.run ?? null,
    updates: page.updates,
    voided: page.updates
      .filter(({ id }) => !(page.applied ?? []).includes(id))
      .map(({ id }) => ({
        missingOperations: page.missing?.[id],
        updateId: id,
      })),
  });
}

/** Whether the page fails for a segment served without what it builds on. */
function refused(page: Page): boolean {
  try {
    settle(page);
    return false;
  } catch (error) {
    if (!isDocumentSyncUpdateIsolationError(error)) throw error;
    expect(error.stage).toBe("baseline_group");
    expect(error.attribution).toBe("batch");
    expect(error.batchUpdateIds).toEqual(page.updates.map(({ id }) => id));
    expect(String(error.cause)).toContain(
      "served without the segments it builds on",
    );
    return true;
  }
}

test("an unapplied segment excuses the operations it declared and no others", () => {
  const unapplied = unappliedOperationsOf([span("7", 10, 20)]);
  const excused = (...missing: DocumentOperationSpan[]) =>
    unappliedSegmentsDeclared(unapplied, missing);
  expect(excused(span("7", 10, 20))).toBe(true);
  expect(excused(span("7", 12, 18))).toBe(true);
  expect(excused()).toBe(true);
  // Operations below the declared span: an earlier segment was left out.
  expect(excused(span("7", 9, 20))).toBe(false);
  expect(excused(span("7", 0, 10))).toBe(false);
  // Operations past it: a later one was.
  expect(excused(span("7", 10, 21))).toBe(false);
  // Another peer's, alone or beside ones that are excused.
  expect(excused(span("8", 10, 20))).toBe(false);
  expect(excused(span("7", 10, 20), span("8", 0, 1))).toBe(false);
  expect(unappliedSegmentsDeclared(new Map(), [span("7", 0, 1)])).toBe(false);
});

test("unapplied segments that follow each other on a peer make one span", () => {
  let unapplied = withUnappliedSegment(
    new Map(),
    declares({ "7": 10 }, { "7": 20, "9": 4 }),
  );
  expect(unappliedOperationSpans(unapplied)).toEqual([
    span("7", 10, 20),
    span("9", 0, 4),
  ]);
  // The next segment starts where that one ends, and brings a third peer
  // that sorts ahead of both.
  unapplied = withUnappliedSegment(
    unapplied,
    declares({ "7": 20 }, { "18": 3, "7": 26 }),
  );
  expect(unappliedOperationSpans(unapplied)).toEqual([
    span("18", 0, 3),
    span("7", 10, 26),
    span("9", 0, 4),
  ]);
  // One that starts past the span before it replaces it: the reader holds
  // the operations between, and so every earlier one of that peer.
  unapplied = withUnappliedSegment(
    unapplied,
    declares({ "7": 30 }, { "7": 40 }),
  );
  expect(unappliedOperationSpans(unapplied)).toEqual([
    span("18", 0, 3),
    span("7", 30, 40),
    span("9", 0, 4),
  ]);
  expect(unappliedSegmentsDeclared(unapplied, [span("7", 26, 30)])).toBe(false);
  expect(unappliedSegmentsDeclared(unapplied, [span("7", 10, 20)])).toBe(false);
  // Vectors that declare no span excuse nothing, and change nothing.
  for (const vectors of [
    declares({ "7": 50 }, { "7": 45 }),
    { partialEndVersionVector: "!", partialStartVersionVector: "!" },
    declares({}, {}),
  ]) {
    expect(
      unappliedOperationSpans(withUnappliedSegment(unapplied, vectors)),
    ).toEqual(unappliedOperationSpans(unapplied));
  }
});

test("a page's verdicts leave the run what its unapplied segments declared", () => {
  const first = segment("s0", {}, { "7": 10 });
  const second = segment("s1", { "7": 10 }, { "7": 20 });
  const third = segment("s2", { "7": 20 }, { "7": 30, "8": 5 });
  // Applied segments declare nothing unapplied.
  expect(settle({ applied: ["s0", "s1"], updates: [first, second] })).toEqual(
    run(),
  );
  // A void one does, and so does each segment voided for building on it.
  expect(
    settle({
      applied: ["s0"],
      missing: { s2: [span("7", 10, 20)] },
      updates: [first, second, third],
    }),
  ).toEqual(run([span("7", 10, 30), span("8", 0, 5)]));
  // The next page starts from what the run carried.
  const carried = run([span("7", 10, 20)]);
  expect(
    settle({
      missing: { s2: [span("7", 10, 20)] },
      run: carried,
      updates: [third],
    }),
  ).toEqual(run([span("7", 10, 30), span("8", 0, 5)]));
  expect(settle({ run: carried, updates: [] })).toEqual(carried);
  // A page that ends outside every group carries no run.
  expect(settle({ nextRun: null, updates: [second] })).toBeNull();
});

test("a segment that lacks operations no unapplied segment declared fails the page", () => {
  const second = segment("s1", { "7": 10 }, { "7": 20 });
  const fourth = segment("s3", {}, { "9": 5 });
  // Nothing unapplied ahead of it.
  expect(
    refused({ missing: { s3: [span("8", 0, 4)] }, updates: [fourth] }),
  ).toBe(true);
  // A void segment ahead of it that declared other operations.
  const withheld = { missing: { s3: [span("8", 0, 4)] } };
  expect(refused({ ...withheld, updates: [second, fourth] })).toBe(true);
  expect(
    refused({ ...withheld, run: run([span("7", 10, 20)]), updates: [fourth] }),
  ).toBe(true);
  // Operations of the void segment's peer that it did not declare.
  expect(
    refused({ missing: { s3: [span("7", 0, 20)] }, updates: [second, fourth] }),
  ).toBe(true);
  // An applied segment ahead of it excuses nothing.
  expect(
    refused({
      applied: ["s1"],
      missing: { s3: [span("7", 10, 20)] },
      updates: [second, fourth],
    }),
  ).toBe(true);
  // A void segment served after it excuses nothing either.
  expect(
    refused({
      missing: { s3: [span("7", 10, 20)] },
      updates: [fourth, second],
    }),
  ).toBe(true);
  // Nor does a void segment of another group, or an ordinary void update.
  for (const other of ["baseline-b", null]) {
    expect(
      refused({
        missing: { s3: [span("7", 10, 20)] },
        updates: [segment("s1", { "7": 10 }, { "7": 20 }, other), fourth],
      }),
    ).toBe(true);
  }
  // The same operations, declared by a void segment of its group: void.
  expect(
    refused({
      missing: { s3: [span("7", 10, 20)] },
      updates: [second, fourth],
    }),
  ).toBe(false);
  // An ordinary update that lacks operations is void, never a failed page.
  expect(
    refused({
      missing: { s3: [span("8", 0, 4)] },
      updates: [segment("s3", {}, { "9": 5 }, null)],
    }),
  ).toBe(false);
});
