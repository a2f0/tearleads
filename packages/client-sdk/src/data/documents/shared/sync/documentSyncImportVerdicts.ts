import {
  exportFullHistorySnapshot,
  isLoroRuntimeFailure,
} from "@tearleads/loro";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import {
  ownPeerOf,
  ScratchHistory,
  type SyncDocument,
} from "./documentSyncScratchHistory";
import type { DecryptedDocumentSyncUpdate } from "./documentSyncTypes";
import {
  isolateDocumentSyncBatchError,
  isolateDocumentSyncUpdateError,
} from "./documentSyncUpdateIsolation";
import {
  type DocumentSyncImportVerdicts,
  type DocumentSyncRuntimeFailure,
  type DocumentVoidStage,
  type VoidedDocumentSyncUpdate,
  voidedDocumentSyncUpdate,
} from "./documentUpdateVerdict";
import { type LoroLifetimes, processLoroLifetimes } from "./loroLifetime";
import {
  type LoroRuntimeAttempts,
  MAX_LORO_RUNTIME_ATTEMPTS,
  processLoroRuntimeFailures,
} from "./loroRuntimeFailureLedger";

type SyncResponseUpdate = DocumentSyncResponse["updates"][number];

/**
 * What a page may spend rebuilding its scratch document (the reader's
 * snapshot plus the updates accepted so far) after a void import changed it.
 * Past this, the rest of the page is deferred to a later pull, so a writer
 * that crafts many such updates costs each pass a bounded amount of work.
 */
const MAX_SCRATCH_REBUILD_BYTES = 32 * 1024 * 1024;

function firstDuplicateUpdateId(
  updates: readonly { readonly id: string }[],
): string | null {
  const seen = new Set<string>();
  for (const update of updates) {
    if (seen.has(update.id)) return update.id;
    seen.add(update.id);
  }
  return null;
}

function isolatedAt(
  update: DecryptedDocumentSyncUpdate,
  failure: unknown,
  stage: DocumentVoidStage,
  responseById: ReadonlyMap<string, SyncResponseUpdate>,
) {
  return isolateDocumentSyncUpdateError({
    cause: failure,
    responseUpdate: responseById.get(update.id),
    stage,
    updateId: update.id,
  });
}

function voidOf(
  update: DecryptedDocumentSyncUpdate,
  failure: unknown,
  stage: DocumentVoidStage,
  responseById: ReadonlyMap<string, SyncResponseUpdate>,
): VoidedDocumentSyncUpdate {
  const voided = voidedDocumentSyncUpdate(
    isolatedAt(update, failure, stage, responseById),
  );
  if (!voided) throw failure;
  return voided;
}

const KNOWN_VOID_MESSAGE = "this device already voided the update";

/** A duplicated id fails the page: an honest server never serves one. */
function assertNoDuplicateUpdateIds(input: {
  readonly decryptedUpdates: readonly DecryptedDocumentSyncUpdate[];
  readonly responseUpdates?: readonly SyncResponseUpdate[] | undefined;
}): void {
  const duplicateUpdateId =
    firstDuplicateUpdateId(input.decryptedUpdates) ??
    firstDuplicateUpdateId(input.responseUpdates ?? []);
  if (duplicateUpdateId === null) return;
  throw isolateDocumentSyncBatchError({
    cause: new Error(
      `Document sync response update id is duplicated: ${duplicateUpdateId}`,
    ),
    stage: "encrypted_record",
    updateIds: (input.responseUpdates ?? input.decryptedUpdates).map(
      (update) => update.id,
    ),
  });
}

/** The verdicts of one page, gathered in server order. */
class PageVerdicts {
  readonly deferredUpdateIds: string[] = [];
  readonly heldUpdateIds: string[] = [];
  readonly runtimeFailures: DocumentSyncRuntimeFailure[] = [];
  readonly voided: VoidedDocumentSyncUpdate[] = [];
  /** Set once an unsettled update holds the rest of the page. */
  holding = false;

  hold(updateId: string): void {
    this.holding = true;
    this.heldUpdateIds.push(updateId);
  }

  result(): DocumentSyncImportVerdicts {
    return {
      deferredUpdateIds: this.deferredUpdateIds,
      heldUpdateIds: this.heldUpdateIds,
      runtimeFailures: this.runtimeFailures,
      voided: this.voided,
    };
  }
}

interface PageJudging {
  readonly ledger: LoroRuntimeAttempts;
  readonly responseById: ReadonlyMap<string, SyncResponseUpdate>;
  readonly runtimeAttempts: ReadonlyMap<string, number>;
  readonly scratch: ScratchHistory;
  readonly verdicts: PageVerdicts;
}

/**
 * Records a Loro runtime failure on `update`. It is void once enough process
 * lifetimes have each failed it; until then it holds the rest of the page.
 */
function noteRuntimeFailure(
  page: PageJudging,
  update: DecryptedDocumentSyncUpdate,
  failure: unknown,
): void {
  const counted = page.ledger.noteFailure(update.id);
  const attempts =
    (page.runtimeAttempts.get(update.id) ?? 0) + (counted ? 1 : 0);
  const final = attempts >= MAX_LORO_RUNTIME_ATTEMPTS;
  const error = isolatedAt(update, failure, "loro_runtime", page.responseById);
  page.verdicts.runtimeFailures.push({
    attempts,
    counted,
    error,
    final,
    updateId: update.id,
  });
  if (final) {
    page.verdicts.voided.push(
      voidOf(update, failure, "loro_runtime", page.responseById),
    );
  } else {
    page.verdicts.hold(update.id);
  }
}

/**
 * The reader's scratch history, or null when the Loro runtime failed while
 * building it: no update is to blame, so the failure counts toward none, but
 * it marks this process as failed, since the module may now be unusable.
 */
async function openScratchHistory(
  input: {
    readonly currentDocument: SyncDocument;
    readonly rebuildBudgetBytes?: number | undefined;
  },
  ledger: LoroRuntimeAttempts,
): Promise<ScratchHistory | null> {
  try {
    return await ScratchHistory.open({
      budgetBytes: input.rebuildBudgetBytes ?? MAX_SCRATCH_REBUILD_BYTES,
      own: ownPeerOf(input.currentDocument),
      snapshot: exportFullHistorySnapshot(input.currentDocument),
    });
  } catch (error) {
    if (!isLoroRuntimeFailure(error)) throw error;
    ledger.noteUnattributedFailure();
    return null;
  }
}

async function judgePageUpdate(
  page: PageJudging,
  update: DecryptedDocumentSyncUpdate,
): Promise<void> {
  const { verdicts } = page;
  if (!page.ledger.mayAttempt(update.id)) {
    verdicts.hold(update.id);
    return;
  }
  const readiness = await page.scratch.ready();
  if (readiness === "over_budget") {
    verdicts.deferredUpdateIds.push(update.id);
    return;
  }
  if (readiness === "runtime_failure") {
    page.ledger.noteUnattributedFailure();
    verdicts.hold(update.id);
    return;
  }
  const judgement = page.scratch.judge(update);
  if (judgement.verdict === "runtime_failure") {
    noteRuntimeFailure(page, update, judgement.failure);
  } else if (judgement.verdict === "void") {
    const voided = voidOf(
      update,
      judgement.failure,
      judgement.stage,
      page.responseById,
    );
    verdicts.voided.push(
      judgement.preemptedPeerId === null
        ? voided
        : { ...voided, preemptedPeerId: judgement.preemptedPeerId },
    );
  }
}

/**
 * Judges a page's decrypted updates in server order against the reader's
 * document, before the live document or any durable frontier changes. An
 * update joins when its payload is the update its signed metadata declares,
 * it imports onto the reader's history plus every update accepted before it,
 * and it carries exactly its declared operations there. Otherwise it is
 * void: one that reuses held operation ids loses to the earlier carrier, and
 * one whose parents no earlier update carries is never applied. Server order
 * is commit order, and an honest writer depends only on operations it holds,
 * which are committed before its update, so this voids no honest update, and
 * readers judging the same history in order void the same ones. A dishonest
 * writer's dependency on a later update can still join for a reader that
 * judges the update again once it holds the later one.
 *
 * `knownVoids` names updates this device already voided, with the stage,
 * under the same judge and content key; they stay void without a Loro call.
 * A void whose import changed the scratch document costs a rebuild; once the
 * page's rebuilds would pass `MAX_SCRATCH_REBUILD_BYTES`, every later update
 * not already known void is deferred.
 *
 * A Loro runtime failure (a trap or exhausted memory) is no verdict about the
 * update. Only the first such failure in a process counts as an attempt,
 * added to `runtimeAttempts` (the attempts this device recorded for it), and
 * the update is void once `MAX_LORO_RUNTIME_ATTEMPTS` lifetimes have each
 * failed it. Until then it is unsettled: it and every later update are held,
 * and in this process it is not imported again until its retry delay passed.
 * A failure building the reader's scratch history holds the whole page.
 *
 * A duplicated id still fails the page, because an honest server never
 * serves one.
 */
export async function validateDocumentSyncUpdateImports(input: {
  currentDocument: SyncDocument;
  decryptedUpdates: readonly DecryptedDocumentSyncUpdate[];
  /** @internal Voids this device recorded; the sync pass reads them. */
  knownVoids?: ReadonlyMap<string, DocumentVoidStage> | undefined;
  /**
   * @internal The rebuild budget; tests lower it, and a rotation, which
   * must settle every update, lifts it.
   */
  rebuildBudgetBytes?: number | undefined;
  responseUpdates?: readonly SyncResponseUpdate[] | undefined;
  /**
   * @internal This process's runtime failures, by default; a judge that
   * records no attempts passes `processLoroRuntimeFailures.unrecorded()`,
   * and tests stand in a new process's ledger.
   */
  runtimeLedger?: LoroRuntimeAttempts | undefined;
  /** @internal Attempts this device recorded; the sync pass reads them. */
  runtimeAttempts?: ReadonlyMap<string, number> | undefined;
  /**
   * @internal Runs once the reader's history is built, before the first
   * update is read: every SDK judge opens its read window here, so a death
   * building that history, which no update caused, is outside it. Without
   * it no window covers the reads, and this lifetime counts no death from
   * then on (#3194).
   */
  beforeUpdateReads?: (() => Promise<unknown>) | undefined;
  /** @internal This realm's lifetime; tests stand in another one. */
  lifetimes?: LoroLifetimes | undefined;
}): Promise<DocumentSyncImportVerdicts> {
  const verdicts = new PageVerdicts();
  if (input.decryptedUpdates.length === 0) return verdicts.result();
  assertNoDuplicateUpdateIds(input);
  const responseById = new Map(
    (input.responseUpdates ?? []).map((update) => [update.id, update]),
  );
  return judgeUpdateReads(input, {
    ledger: input.runtimeLedger ?? processLoroRuntimeFailures,
    responseById,
    verdicts,
  });
}

/**
 * Whether the page reads any served update with Loro: one neither a known
 * void nor out of attempts, as a read window's unsettled updates are.
 */
function readsAnyUpdate(
  input: Parameters<typeof validateDocumentSyncUpdateImports>[0],
  ledger: LoroRuntimeAttempts,
): boolean {
  return input.decryptedUpdates.some(
    (update) =>
      input.knownVoids?.get(update.id) === undefined &&
      ledger.mayAttempt(update.id),
  );
}

async function judgeUpdateReads(
  input: Parameters<typeof validateDocumentSyncUpdateImports>[0],
  judging: Omit<PageJudging, "runtimeAttempts" | "scratch">,
): Promise<DocumentSyncImportVerdicts> {
  const { ledger, responseById, verdicts } = judging;
  const scratch = await openScratchHistory(input, ledger);
  if (scratch === null) {
    for (const update of input.decryptedUpdates) verdicts.hold(update.id);
    return verdicts.result();
  }
  const page: PageJudging = {
    ledger,
    responseById,
    runtimeAttempts: input.runtimeAttempts ?? new Map(),
    scratch,
    verdicts,
  };
  // The reader's history holds only accepted data, like the editor's work.
  // The served updates read below run in the caller's window. A caller that
  // opens none, such as a host calling this itself, reads where a death may
  // be theirs, so no window of the lifetime counts one from then on (#3194).
  try {
    if (input.beforeUpdateReads) await input.beforeUpdateReads();
    else if (readsAnyUpdate(input, ledger)) {
      (input.lifetimes ?? processLoroLifetimes).noteFailed();
    }
    for (const update of input.decryptedUpdates) {
      const knownStage = input.knownVoids?.get(update.id);
      if (verdicts.holding) {
        verdicts.heldUpdateIds.push(update.id);
      } else if (knownStage !== undefined) {
        verdicts.voided.push(
          voidOf(
            update,
            new Error(KNOWN_VOID_MESSAGE),
            knownStage,
            responseById,
          ),
        );
      } else {
        await judgePageUpdate(page, update);
      }
    }
  } finally {
    scratch.free();
  }
  return verdicts.result();
}
