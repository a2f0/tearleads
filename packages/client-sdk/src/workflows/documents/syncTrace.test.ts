import { expect, test } from "bun:test";
import {
  classifyHealBlockedReason,
  DOCUMENT_SYNC_TRACE_PATTERN,
  traceCheckpointRegeneration,
  traceHealBlocked,
  traceHealed,
  traceHealPlanned,
  traceHistoryRecovered,
  traceHistoryRecoveryFailed,
  traceHistoryRecoveryStart,
  traceProjectionFailed,
  traceStaleBundle,
  traceStaleRead,
  traceSubmitFailed,
} from "./syncTrace";

const DOCUMENT_ID = "71ed8e12-fd1d-41fe-9c75-6c3a45b653e3";

function collect(run: (emit: (line: string) => void) => void): string[] {
  const lines: string[] = [];
  run((line) => lines.push(line));
  return lines;
}

test("every emitted trace line matches the clipboard-safe pattern", () => {
  const lines = collect((emit) => {
    traceStaleBundle(emit, { documentId: DOCUMENT_ID, epoch: 1, pending: 3 });
    traceHealPlanned(emit, {
      documentId: DOCUMENT_ID,
      fromEpoch: 1,
      heldBack: 1,
      toEpoch: 2,
      updates: 3,
    });
    traceStaleRead(emit, { documentId: DOCUMENT_ID, epoch: 1 });
    traceCheckpointRegeneration(emit, {
      checkpoints: 1,
      documentId: DOCUMENT_ID,
      updates: 2,
    });
    traceHealBlocked(emit, {
      documentId: DOCUMENT_ID,
      error: new Error(
        "Document content-key bundle is stale and no rotation snapshot is available to heal it",
      ),
    });
    traceSubmitFailed(emit, {
      action: "regenerate-checkpoints",
      code: "document_sync_state_stale",
      documentId: DOCUMENT_ID,
      status: 409,
    });
    traceSubmitFailed(emit, {
      action: "stop",
      code: undefined,
      documentId: DOCUMENT_ID,
      status: null,
    });
    traceProjectionFailed(emit, { documentId: DOCUMENT_ID, status: 403 });
    traceHealed(emit, { accepted: 4, documentId: DOCUMENT_ID, epoch: 2 });
    traceHistoryRecoveryStart(emit, { attempt: 1, documentId: DOCUMENT_ID });
    traceHistoryRecovered(emit, { documentId: DOCUMENT_ID, updates: 12 });
    traceHistoryRecoveryFailed(emit, {
      documentId: DOCUMENT_ID,
      reason: "pull-failed",
    });
    traceHistoryRecoveryFailed(emit, {
      documentId: DOCUMENT_ID,
      reason: "attempts-exhausted",
    });
  });

  expect(lines).toHaveLength(13);
  for (const line of lines) {
    expect(line).toMatch(DOCUMENT_SYNC_TRACE_PATTERN);
  }
});

test("the validator is anchored and rejects tokens outside the vocabulary", () => {
  const rejected = [
    // A trailing leak after a valid line must fail as a whole.
    `document sync healed document=${DOCUMENT_ID} epoch=2 accepted=4 title=PRIVATE`,
    // A leading prefix must fail too — composition anchors are the caller's.
    `PRIVATE document sync healed document=${DOCUMENT_ID} epoch=2 accepted=4`,
    // Smuggled tokens in the enumerated slots must fail even when they match
    // the loose token shape.
    `document sync submit failed document=${DOCUMENT_ID} status=409 code=patient_name action=stop`,
    `document sync submit failed document=${DOCUMENT_ID} status=409 code=none action=secret`,
    `document sync heal blocked document=${DOCUMENT_ID} reason=patient-name`,
    `document sync history recovery failed document=${DOCUMENT_ID} reason=patient-name`,
    `document sync history recovered document=${DOCUMENT_ID} updates=12 title=PRIVATE`,
    // Non-UUID document ids must fail the strict shape.
    "document sync healed document=a epoch=2 accepted=4",
  ];
  for (const line of rejected) {
    expect(line).not.toMatch(DOCUMENT_SYNC_TRACE_PATTERN);
  }
});

test("unknown failure text emits nothing instead of leaking free-form errors", () => {
  const lines = collect((emit) => {
    traceHealBlocked(emit, {
      documentId: DOCUMENT_ID,
      error: new Error("SecretDocumentTitle.txt exploded"),
    });
  });
  expect(lines).toEqual([]);
  expect(classifyHealBlockedReason(new Error("anything else"))).toBeNull();
});

test("classifier maps every fixed heal failure to an enumerated reason", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    [
      "Document content-key bundle is stale and no rotation snapshot is available to heal it",
      "snapshot-unavailable",
    ],
    [
      "Document stale-bundle recovery requires a full-history rotation snapshot",
      "snapshot-not-full-history",
    ],
    ["Document stale-bundle recovery snapshot is empty", "snapshot-empty"],
    [
      "Document stale-bundle recovery snapshot does not cover a queued rotation checkpoint",
      "checkpoint-uncovered",
    ],
    [
      "Document content-key re-wrap KEK is unavailable for container x epoch y",
      "rewrap-kek-unavailable",
    ],
    [
      "Document stale bundle manifest is missing from the projection history",
      "stale-manifest-missing",
    ],
    [
      "Document content key could not be unwrapped",
      "content-key-unwrap-failed",
    ],
  ];
  for (const [message, reason] of cases) {
    expect(classifyHealBlockedReason(new Error(message))).toBe(reason);
  }
});

test("only allowlisted protocol codes are copied; everything else collapses", () => {
  const lines = collect((emit) => {
    traceSubmitFailed(emit, {
      action: "stop",
      code: "Secret Note Title! ",
      documentId: DOCUMENT_ID,
      status: 409,
    });
    // Even a code that LOOKS like a protocol token must not pass unless it is
    // one of ours — a server-controlled string never reaches the clipboard.
    traceSubmitFailed(emit, {
      action: "stop",
      code: "server_invented_token",
      documentId: DOCUMENT_ID,
      status: 409,
    });
    traceSubmitFailed(emit, {
      action: "retry",
      code: "document_sync_state_stale",
      documentId: DOCUMENT_ID,
      status: 409,
    });
  });
  expect(lines).toEqual([
    `document sync submit failed document=${DOCUMENT_ID} status=409 code=other action=stop`,
    `document sync submit failed document=${DOCUMENT_ID} status=409 code=other action=stop`,
    `document sync submit failed document=${DOCUMENT_ID} status=409 code=document_sync_state_stale action=retry`,
  ]);
  for (const line of lines) {
    expect(line).toMatch(DOCUMENT_SYNC_TRACE_PATTERN);
  }
});
