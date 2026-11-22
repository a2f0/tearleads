import { loroDecoderIdentity } from "@tearleads/loro";
import {
  type DocumentSyncUpdateIsolationError,
  isDocumentSyncUpdateIsolationError,
} from "./documentSyncUpdateIsolation";

/**
 * The stages whose failure is a fact about the signed record alone, so every
 * reader judging the same served history in server order reaches the same
 * verdict. A reader that fails at any other stage (a missing key, an envelope
 * the server should have refused, AES-GCM under a key nobody committed to)
 * cannot tell its own state from the writer's fault, and fails the pass.
 */
const VOID_STAGES = new Set<DocumentSyncUpdateIsolationError["stage"]>([
  "loro_import",
  "loro_metadata",
  "plaintext_integrity",
]);

/**
 * Changes whenever a void stage or the rule behind it changes. With the Loro
 * decoder's identity it names the judge, so a device that upgraded either
 * judges every update it voided again: a format an older decoder could not
 * read is not a fault of the writer.
 */
const DOCUMENT_VOID_RULES_VERSION = "void-rules-1";

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
  readonly contentKeyEpoch: number | null;
  readonly error: DocumentSyncUpdateIsolationError;
  readonly stage: DocumentSyncUpdateIsolationError["stage"];
  readonly updateId: string;
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
  return {
    contentKeyEpoch: error.contentKeyEpoch,
    error,
    stage: error.stage,
    updateId: error.updateId,
  };
}

/**
 * For callers that verify their own or a single trusted history (a founding
 * update, a rotation's raw history): any void there is still a failure.
 */
export function assertNoVoidedDocumentSyncUpdates(
  voided: readonly VoidedDocumentSyncUpdate[],
): void {
  const [first] = voided;
  if (first) throw first.error;
}

export function withoutVoidedUpdates<Update extends { readonly id: string }>(
  updates: readonly Update[],
  voided: readonly VoidedDocumentSyncUpdate[],
): Update[] {
  if (voided.length === 0) return [...updates];
  const voidedIds = new Set(voided.map((entry) => entry.updateId));
  return updates.filter((update) => !voidedIds.has(update.id));
}
