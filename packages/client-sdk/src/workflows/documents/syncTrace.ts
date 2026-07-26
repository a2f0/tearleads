/**
 * Production-safe trace lines for the document sync workflow.
 *
 * Every line is assembled here from a CLOSED vocabulary — strict document
 * UUIDs, integers, and enumerated reason/action/code values that appear as
 * literal alternatives in the pattern below. No decrypted content, names,
 * key material, or free-form error text can enter a line, and because the
 * System Monitor validates LINES (it cannot know their emitter), the pattern
 * itself rejects any token outside that vocabulary rather than trusting
 * emitter-side sanitization. The format tests assert emitter output and
 * pattern stay in lockstep, including that leaks fail closed.
 */

import {
  DOCUMENT_NOT_FOUND_ERROR_CODE,
  DOCUMENT_SYNC_ERROR_CODES,
} from "@tearleads/validators/response";

export type DocumentSyncTraceEmitter = (line: string) => void;

/** Fixed thrown messages mapped to enumerated, clipboard-safe reasons. */
const HEAL_BLOCKED_REASONS: ReadonlyArray<readonly [string, string]> = [
  [
    "Document content-key bundle is stale and no rotation snapshot is available",
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
  ["Document content-key re-wrap KEK is unavailable", "rewrap-kek-unavailable"],
  [
    "Document stale bundle manifest is missing from the projection history",
    "stale-manifest-missing",
  ],
  ["Document content key could not be unwrapped", "content-key-unwrap-failed"],
];

/**
 * Only the protocol's own coded values are copied; any other server-provided
 * string — even one that happens to look like a code — is collapsed to
 * "other" so a hostile or buggy server can never smuggle text into a report.
 */
const SAFE_FAILURE_CODES: ReadonlySet<string> = new Set([
  ...Object.values(DOCUMENT_SYNC_ERROR_CODES),
  DOCUMENT_NOT_FOUND_ERROR_CODE,
]);

type DocumentSyncTraceAction =
  | "recover-update-ids"
  | "regenerate-checkpoints"
  | "retry"
  | "stop";

const TRACE_ACTIONS: ReadonlyArray<DocumentSyncTraceAction> = [
  "recover-update-ids",
  "regenerate-checkpoints",
  "retry",
  "stop",
];

const HISTORY_RECOVERY_FAILURE_REASONS = [
  "attempts-exhausted",
  "doc-changed",
  "install-failed",
  "pull-failed",
] as const;

type DocumentHistoryRecoveryFailureReason =
  (typeof HISTORY_RECOVERY_FAILURE_REASONS)[number];

// Every vocabulary below is enumerated into the pattern as literals; the only
// open-ended slots are a strict UUID and decimal counts.
const UUID_FRAGMENT =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const REASON_FRAGMENT = HEAL_BLOCKED_REASONS.map(([, reason]) => reason).join(
  "|",
);
const ACTION_FRAGMENT = TRACE_ACTIONS.join("|");
const CODE_FRAGMENT = [...SAFE_FAILURE_CODES, "none", "other"].join("|");
const RECOVERY_REASON_FRAGMENT = HISTORY_RECOVERY_FAILURE_REASONS.join("|");

/**
 * Unanchored alternatives for composition into a larger allowlist (the
 * System Monitor wraps this in its own prefix/suffix anchors). Use
 * DOCUMENT_SYNC_TRACE_PATTERN to validate a complete line.
 */
export const DOCUMENT_SYNC_TRACE_FRAGMENT = [
  `document sync stale bundle document=${UUID_FRAGMENT} epoch=\\d+ pending=\\d+`,
  `document sync heal planned document=${UUID_FRAGMENT} fromEpoch=\\d+ toEpoch=\\d+ updates=\\d+ heldBack=\\d+`,
  `document sync stale read document=${UUID_FRAGMENT} epoch=\\d+`,
  `document sync checkpoint regeneration document=${UUID_FRAGMENT} checkpoints=\\d+ updates=\\d+`,
  `document sync heal blocked document=${UUID_FRAGMENT} reason=(?:${REASON_FRAGMENT})`,
  `document sync submit failed document=${UUID_FRAGMENT} status=(?:\\d+|none) code=(?:${CODE_FRAGMENT}) action=(?:${ACTION_FRAGMENT})`,
  `document sync projection failed document=${UUID_FRAGMENT} status=(?:\\d+|none)`,
  `document sync healed document=${UUID_FRAGMENT} epoch=\\d+ accepted=\\d+`,
  `document sync history recovery start document=${UUID_FRAGMENT} attempt=\\d+`,
  `document sync history recovered document=${UUID_FRAGMENT} updates=\\d+`,
  `document sync history recovery failed document=${UUID_FRAGMENT} reason=(?:${RECOVERY_REASON_FRAGMENT})`,
]
  .map((alternative) => `(?:${alternative})`)
  .join("|");

/** Anchored validator: a string is a trace line in full, or not at all. */
export const DOCUMENT_SYNC_TRACE_PATTERN = new RegExp(
  `^(?:${DOCUMENT_SYNC_TRACE_FRAGMENT})$`,
  "u",
);

/**
 * Classifies a plan-build failure into an enumerated reason, or null when the
 * message is not one of the fixed protocol strings — unknown errors fail
 * closed and emit nothing rather than leaking free text.
 */
export function classifyHealBlockedReason(error: unknown): string | null {
  const message = error instanceof Error ? error.message : "";
  for (const [prefix, reason] of HEAL_BLOCKED_REASONS) {
    if (message.startsWith(prefix)) {
      return reason;
    }
  }
  return null;
}

function safeCode(code: string | undefined): string {
  if (code === undefined) {
    return "none";
  }
  return SAFE_FAILURE_CODES.has(code) ? code : "other";
}

function safeStatus(status: number | null): string {
  return status !== null && Number.isInteger(status) && status >= 0
    ? String(status)
    : "none";
}

export function traceStaleBundle(
  emit: DocumentSyncTraceEmitter | undefined,
  input: { documentId: string; epoch: number; pending: number },
): void {
  emit?.(
    `document sync stale bundle document=${input.documentId} epoch=${input.epoch} pending=${input.pending}`,
  );
}

export function traceHealPlanned(
  emit: DocumentSyncTraceEmitter | undefined,
  input: {
    documentId: string;
    fromEpoch: number;
    heldBack: number;
    toEpoch: number;
    updates: number;
  },
): void {
  emit?.(
    `document sync heal planned document=${input.documentId} fromEpoch=${input.fromEpoch} toEpoch=${input.toEpoch} updates=${input.updates} heldBack=${input.heldBack}`,
  );
}

export function traceStaleRead(
  emit: DocumentSyncTraceEmitter | undefined,
  input: { documentId: string; epoch: number },
): void {
  emit?.(
    `document sync stale read document=${input.documentId} epoch=${input.epoch}`,
  );
}

export function traceCheckpointRegeneration(
  emit: DocumentSyncTraceEmitter | undefined,
  input: { checkpoints: number; documentId: string; updates: number },
): void {
  emit?.(
    `document sync checkpoint regeneration document=${input.documentId} checkpoints=${input.checkpoints} updates=${input.updates}`,
  );
}

export function traceHealBlocked(
  emit: DocumentSyncTraceEmitter | undefined,
  input: { documentId: string; error: unknown },
): void {
  const reason = classifyHealBlockedReason(input.error);
  if (reason !== null) {
    emit?.(
      `document sync heal blocked document=${input.documentId} reason=${reason}`,
    );
  }
}

export function traceSubmitFailed(
  emit: DocumentSyncTraceEmitter | undefined,
  input: {
    action: DocumentSyncTraceAction;
    code: string | undefined;
    documentId: string;
    status: number | null;
  },
): void {
  emit?.(
    `document sync submit failed document=${input.documentId} status=${safeStatus(input.status)} code=${safeCode(input.code)} action=${input.action}`,
  );
}

export function traceProjectionFailed(
  emit: DocumentSyncTraceEmitter | undefined,
  input: { documentId: string; status: number | null },
): void {
  emit?.(
    `document sync projection failed document=${input.documentId} status=${safeStatus(input.status)}`,
  );
}

export function traceHealed(
  emit: DocumentSyncTraceEmitter | undefined,
  input: { accepted: number; documentId: string; epoch: number },
): void {
  emit?.(
    `document sync healed document=${input.documentId} epoch=${input.epoch} accepted=${input.accepted}`,
  );
}

export function traceHistoryRecoveryStart(
  emit: DocumentSyncTraceEmitter | undefined,
  input: { attempt: number; documentId: string },
): void {
  emit?.(
    `document sync history recovery start document=${input.documentId} attempt=${input.attempt}`,
  );
}

export function traceHistoryRecovered(
  emit: DocumentSyncTraceEmitter | undefined,
  input: { documentId: string; updates: number },
): void {
  emit?.(
    `document sync history recovered document=${input.documentId} updates=${input.updates}`,
  );
}

export function traceHistoryRecoveryFailed(
  emit: DocumentSyncTraceEmitter | undefined,
  input: {
    documentId: string;
    reason: DocumentHistoryRecoveryFailureReason;
  },
): void {
  emit?.(
    `document sync history recovery failed document=${input.documentId} reason=${input.reason}`,
  );
}
