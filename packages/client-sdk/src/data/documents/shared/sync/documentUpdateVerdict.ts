import { loroDecoderIdentity } from "@tearleads/loro";
import {
  type DocumentSyncUpdateIsolationError,
  isDocumentSyncUpdateIsolationError,
} from "./documentSyncUpdateIsolation";

/**
 * The stages whose failure is a fact about the signed record alone, so every
 * reader judging the same served history in server order reaches the same
 * verdict. `decrypt` is AES-GCM refusing the record under the key its writer
 * signed a commitment to, which every reader holding that key refuses too. A
 * reader that fails at any other stage (a missing key, a key that is not the
 * committed one, an envelope the server should have refused, its own runtime)
 * cannot tell its own state from the writer's fault, and fails the pass.
 * `loro_runtime` is a void only once `MAX_LORO_RUNTIME_ATTEMPTS` process
 * lifetimes have each failed the update; before that it is unsettled.
 */
const VOID_STAGES = new Set<DocumentSyncUpdateIsolationError["stage"]>([
  "decrypt",
  "loro_import",
  "loro_metadata",
  "loro_runtime",
  "plaintext_integrity",
]);

/** A stage at which a served update can be void. */
export type DocumentVoidStage =
  | "decrypt"
  | "loro_import"
  | "loro_metadata"
  | "loro_runtime"
  | "plaintext_integrity";

/**
 * Changes whenever a void stage or the rule behind it changes. With the Loro
 * decoder's identity it names the judge, so a device that upgraded either
 * judges every update it voided again: a format an older decoder could not
 * read is not a fault of the writer.
 */
const DOCUMENT_VOID_RULES_VERSION = "void-rules-4";

export function documentVerdictJudge(): string {
  return `${DOCUMENT_VOID_RULES_VERSION}:${loroDecoderIdentity()}`;
}

/**
 * A served update this reader will never apply: its decrypted payload is not
 * the update its signed metadata declares, or it cannot join the history the
 * reader built from every earlier served update. The reader records it and
 * continues, so one writer's bad record cannot stop anyone else's sync.
 */
export interface VoidedDocumentSyncUpdate {
  readonly error: DocumentSyncUpdateIsolationError;
  /**
   * This device's peer id, when the update reused ids of operations this
   * device holds under it with other operations: its writer committed them
   * as this device, and readers that took it first void this device's own.
   */
  readonly preemptedPeerId?: string | undefined;
  readonly stage: DocumentSyncUpdateIsolationError["stage"];
  readonly updateId: string;
}

/**
 * A served update the Loro runtime failed on (a trap or exhausted memory)
 * while this page judged it. `attempts` counts the process lifetimes that
 * have failed it, including this one when `counted`; at
 * `MAX_LORO_RUNTIME_ATTEMPTS` it is `final` and void, else unsettled.
 */
export interface DocumentSyncRuntimeFailure {
  readonly attempts: number;
  readonly counted: boolean;
  readonly error: DocumentSyncUpdateIsolationError;
  readonly final: boolean;
  readonly updateId: string;
}

/** What judging one page's imports decided. */
export interface DocumentSyncImportVerdicts {
  /**
   * Updates left unjudged because the page used up its rebuild budget, in
   * server order. The pass applies none of them, and its pull starts over so
   * the next pass is served them again.
   */
  readonly deferredUpdateIds: readonly string[];
  /**
   * The unsettled update the Loro runtime failed on, or is still waiting to
   * retry, and every update after it, in server order. The pass applies none
   * of them, its pull records no cursor, and a later pull judges them again.
   */
  readonly heldUpdateIds: readonly string[];
  /** Every Loro runtime failure the page met, in server order. */
  readonly runtimeFailures: readonly DocumentSyncRuntimeFailure[];
  /** Updates this reader will never apply, in server order. */
  readonly voided: readonly VoidedDocumentSyncUpdate[];
}

/** A page with nothing to judge, or a caller's verdict that accepts it whole. */
export function emptyDocumentSyncImportVerdicts(): DocumentSyncImportVerdicts {
  return {
    deferredUpdateIds: [],
    heldUpdateIds: [],
    runtimeFailures: [],
    voided: [],
  };
}

/**
 * The verdicts a validator returned. One that returned anything else is a
 * programming error, and accepting every update for it would apply payloads
 * nobody judged, so the pass fails.
 */
export function requireDocumentSyncImportVerdicts(
  verdicts: unknown,
): DocumentSyncImportVerdicts {
  if (!isDocumentSyncImportVerdicts(verdicts)) {
    throw new Error(
      "Document sync update validator returned no import verdicts",
    );
  }
  return verdicts;
}

function isDocumentSyncImportVerdicts(
  value: unknown,
): value is DocumentSyncImportVerdicts {
  return (
    typeof value === "object" &&
    value !== null &&
    ["deferredUpdateIds", "heldUpdateIds", "runtimeFailures", "voided"].every(
      (field) => Array.isArray(Reflect.get(value, field)),
    )
  );
}

/** The void an attributed failure at a void stage stands for, else null. */
export function voidedDocumentSyncUpdate(
  error: unknown,
): VoidedDocumentSyncUpdate | null {
  if (
    !isDocumentSyncUpdateIsolationError(error) ||
    error.updateId === null ||
    !VOID_STAGES.has(error.stage)
  ) {
    return null;
  }
  return { error, stage: error.stage, updateId: error.updateId };
}

/**
 * For callers that verify their own or a single trusted history, such as a
 * founding update: any void, or any update left unjudged, is still a failure.
 * Returns the verdicts it was given.
 */
export function assertNoVoidedDocumentSyncUpdates<
  Verdicts extends
    | readonly VoidedDocumentSyncUpdate[]
    | DocumentSyncImportVerdicts,
>(verdicts: Verdicts): Verdicts {
  if (!("voided" in verdicts)) {
    const [first] = verdicts;
    if (first) throw first.error;
    return verdicts;
  }
  // A page defers updates only after voiding one, so the void is thrown.
  const [firstVoid] = verdicts.voided;
  if (firstVoid) throw firstVoid.error;
  const [firstRuntimeFailure] = verdicts.runtimeFailures;
  if (firstRuntimeFailure) throw firstRuntimeFailure.error;
  const [firstUnjudged] = [
    ...verdicts.heldUpdateIds,
    ...verdicts.deferredUpdateIds,
  ];
  if (firstUnjudged !== undefined) {
    throw new Error(
      `Document sync left update ${firstUnjudged} unjudged in a history that must apply whole`,
    );
  }
  return verdicts;
}

/** The updates a page applies: neither voided, deferred, nor held. */
export function withoutVoidedUpdates<Update extends { readonly id: string }>(
  updates: readonly Update[],
  verdicts: DocumentSyncImportVerdicts,
): Update[] {
  const skipped = new Set([
    ...verdicts.voided.map((entry) => entry.updateId),
    ...verdicts.deferredUpdateIds,
    ...verdicts.heldUpdateIds,
  ]);
  if (skipped.size === 0) return [...updates];
  return updates.filter((update) => !skipped.has(update.id));
}
