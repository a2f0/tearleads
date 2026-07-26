/**
 * Production-safe trace lines for the document sync workflow.
 *
 * Every line is assembled here from an anchored vocabulary — document UUIDs,
 * integers, HTTP statuses, and enumerated reason/action/code tokens. No
 * decrypted content, names, key material, or free-form error text ever enters
 * a line, so the System Monitor can copy them into support reports verbatim.
 * DOCUMENT_SYNC_TRACE_PATTERN is the single source of truth the monitor's
 * clipboard allowlist composes in; the format test asserts every emitter
 * output matches it, keeping the two in lockstep.
 */

import {
  DOCUMENT_NOT_FOUND_ERROR_CODE,
  DOCUMENT_SYNC_ERROR_CODES,
} from "@tearleads/validators/response";

export type DocumentSyncTraceEmitter = (line: string) => void;

const UUID_FRAGMENT = "[0-9a-fA-F-]{1,64}";
const TOKEN_FRAGMENT = "[a-z0-9-]{1,64}";
const CODE_FRAGMENT = "[a-z0-9_]{1,64}";

/**
 * Anchored shape of every emitted trace line. Composed (not copied) into the
 * System Monitor clipboard allowlist.
 */
export const DOCUMENT_SYNC_TRACE_PATTERN = new RegExp(
  [
    `document sync stale bundle document=${UUID_FRAGMENT} epoch=\\d+ pending=\\d+`,
    `document sync heal planned document=${UUID_FRAGMENT} fromEpoch=\\d+ toEpoch=\\d+ updates=\\d+ heldBack=\\d+`,
    `document sync stale read document=${UUID_FRAGMENT} epoch=\\d+`,
    `document sync checkpoint regeneration document=${UUID_FRAGMENT} checkpoints=\\d+ updates=\\d+`,
    `document sync heal blocked document=${UUID_FRAGMENT} reason=${TOKEN_FRAGMENT}`,
    `document sync submit failed document=${UUID_FRAGMENT} status=(?:\\d+|none) code=(?:${CODE_FRAGMENT}|none) action=${TOKEN_FRAGMENT}`,
    `document sync projection failed document=${UUID_FRAGMENT} status=(?:\\d+|none)`,
    `document sync healed document=${UUID_FRAGMENT} epoch=\\d+ accepted=\\d+`,
  ]
    .map((alternative) => `(?:${alternative})`)
    .join("|"),
  "u",
);

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

/**
 * Only the protocol's own coded values are copied; any other server-provided
 * string — even one that happens to look like a code — is collapsed to
 * "other" so a hostile or buggy server can never smuggle text into a report.
 */
const SAFE_FAILURE_CODES: ReadonlySet<string> = new Set([
  ...Object.values(DOCUMENT_SYNC_ERROR_CODES),
  DOCUMENT_NOT_FOUND_ERROR_CODE,
]);

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
    action: "recover-update-ids" | "regenerate-checkpoints" | "retry" | "stop";
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
