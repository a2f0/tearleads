import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  getImportBlobMetadata,
  importSnapshot,
  importUpdates,
  LoroImportUnresolvedDependenciesError,
  satisfiesVersionVector,
  updateMatchesDocumentHistory,
  versionVectorsEqual,
} from "@tearleads/loro";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import type { DecryptedDocumentSyncUpdate } from "./documentSyncTypes";
import { importDecryptedDocumentSyncUpdates } from "./documentSyncUpdateImport";
import {
  isolateDocumentSyncBatchError,
  isolateDocumentSyncUpdateError,
} from "./documentSyncUpdateIsolation";
import {
  type DocumentSyncImportVerdicts,
  type VoidedDocumentSyncUpdate,
  voidedDocumentSyncUpdate,
} from "./documentUpdateVerdict";

type SyncResponseUpdate = DocumentSyncResponse["updates"][number];
type SyncDocument = Awaited<ReturnType<typeof createDocument>>;

/**
 * What a page may spend rebuilding its scratch document (the reader's
 * snapshot plus the updates accepted so far) after a void import changed it.
 * Past this, the rest of the page is deferred to a later pull, so a writer
 * that crafts many such updates costs each pass a bounded amount of work.
 */
const MAX_SCRATCH_REBUILD_BYTES = 32 * 1024 * 1024;

const MISSING_DEPENDENCY_MESSAGE =
  "incoming Loro update depends on operations no earlier served update carries";

type ScratchJudgement =
  | { readonly verdict: "accepted" }
  | {
      readonly failure: unknown;
      /** Whether the failed import left operations in the scratch document. */
      readonly scratchChanged: boolean;
      readonly verdict: "void";
    };

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

async function createValidationDocument(
  snapshot: Uint8Array,
  accepted: readonly DecryptedDocumentSyncUpdate[],
): Promise<SyncDocument> {
  const document = await createDocument(crypto.randomUUID());
  try {
    importSnapshot(document, snapshot);
    importDecryptedDocumentSyncUpdates(document, accepted);
    return document;
  } catch (error) {
    document.free();
    throw error;
  }
}

function isRotationBaseline(update: DecryptedDocumentSyncUpdate): boolean {
  return (
    update.checkpointKind === "rotate_baseline" &&
    update.checkpointPayloadKind === "full_history_snapshot"
  );
}

function totalBytes(updates: readonly DecryptedDocumentSyncUpdate[]): number {
  return updates.reduce((sum, update) => sum + update.updateData.byteLength, 0);
}

/**
 * Whether `update` starts past an operation `held` lacks on one of its own
 * peers. Loro would keep such an update pending inside the scratch document,
 * so it is judged from its metadata alone. A blob whose metadata does not
 * decode is left to the import, which fails before changing anything.
 */
function startsPastHeldCounters(
  held: string,
  update: DecryptedDocumentSyncUpdate,
): boolean {
  if (isRotationBaseline(update)) return false;
  let start: string;
  try {
    start = getImportBlobMetadata(update.updateData).partialStartVersionVector;
  } catch {
    return false;
  }
  return !satisfiesVersionVector(held, start);
}

/**
 * Whether `update` joins `document`, which holds the reader's history and
 * every update accepted before it in server order. A void reports whether its
 * import changed the document: an import that left pending or partial
 * operations behind needs a clean rebuild before the next update is judged.
 */
function judgeOnScratch(
  document: SyncDocument,
  update: DecryptedDocumentSyncUpdate,
): ScratchJudgement {
  const held = encodeVersionVector(document);
  if (startsPastHeldCounters(held, update)) {
    return {
      failure: new Error(MISSING_DEPENDENCY_MESSAGE),
      scratchChanged: false,
      verdict: "void",
    };
  }
  const changed = () =>
    !versionVectorsEqual(encodeVersionVector(document), held);
  try {
    if (isRotationBaseline(update)) {
      importSnapshot(document, update.updateData);
    } else {
      importUpdates(document, [update.updateData]);
    }
  } catch (error) {
    if (error instanceof LoroImportUnresolvedDependenciesError) {
      // Loro keeps the operations it could not apply as pending.
      return {
        failure: new Error(MISSING_DEPENDENCY_MESSAGE, { cause: error }),
        scratchChanged: true,
        verdict: "void",
      };
    }
    return { failure: error, scratchChanged: changed(), verdict: "void" };
  }
  // Loro keeps the first operation it holds for a peer/counter and ignores a
  // later one, so an update that reuses held ids with different operations
  // imports "successfully". Only the resulting history shows the reuse.
  if (!updateMatchesDocumentHistory(document, update.updateData)) {
    return {
      failure: new Error(
        "incoming Loro update reuses an already-covered frontier with different operations",
      ),
      scratchChanged: changed(),
      verdict: "void",
    };
  }
  return { verdict: "accepted" };
}

function voidOf(
  update: DecryptedDocumentSyncUpdate,
  failure: unknown,
  responseById: ReadonlyMap<string, SyncResponseUpdate>,
): VoidedDocumentSyncUpdate {
  const voided = voidedDocumentSyncUpdate(
    isolateDocumentSyncUpdateError({
      cause: failure,
      responseUpdate: responseById.get(update.id),
      stage: "loro_import",
      updateId: update.id,
    }),
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

/**
 * The page's scratch document: the reader's history plus every update
 * accepted so far. A void whose import changed it is rebuilt from those
 * before the next update is judged, while the page's budget allows.
 */
class ScratchHistory {
  private readonly accepted: DecryptedDocumentSyncUpdate[] = [];
  private changed = false;

  private constructor(
    private readonly snapshot: Uint8Array,
    private budgetBytesLeft: number,
    private document: SyncDocument | null,
  ) {}

  static async open(
    snapshot: Uint8Array,
    budgetBytes: number,
  ): Promise<ScratchHistory> {
    return new ScratchHistory(
      snapshot,
      budgetBytes,
      await createValidationDocument(snapshot, []),
    );
  }

  /** False once a needed rebuild would pass the budget: defer the update. */
  async ready(): Promise<boolean> {
    if (!this.changed) return true;
    const rebuildBytes = this.snapshot.byteLength + totalBytes(this.accepted);
    if (rebuildBytes > this.budgetBytesLeft) return false;
    this.budgetBytesLeft -= rebuildBytes;
    this.free();
    this.document = await createValidationDocument(
      this.snapshot,
      this.accepted,
    );
    this.changed = false;
    return true;
  }

  /** Judges `update`, keeping it for later rebuilds when it joins. */
  judge(update: DecryptedDocumentSyncUpdate): ScratchJudgement {
    if (!this.document) throw new Error("Scratch history was freed");
    const judgement = judgeOnScratch(this.document, update);
    if (judgement.verdict === "accepted") this.accepted.push(update);
    else this.changed = judgement.scratchChanged;
    return judgement;
  }

  free(): void {
    this.document?.free();
    this.document = null;
  }
}

/**
 * Judges a page's decrypted updates in server order against the reader's
 * document, before the live document or any durable frontier changes. An
 * update joins when it imports onto the reader's history plus every update
 * accepted before it, and carries exactly its declared operations there.
 * Otherwise it is void: one that reuses held operation ids loses to the
 * earlier carrier, and one whose parents no earlier update carries is never
 * applied. Server order is commit order, and an honest writer depends only on
 * operations it holds, which are committed before its update, so this voids
 * no honest update, and readers judging the same history in order void the
 * same ones. A dishonest writer's dependency on a later update can still join
 * for a reader that judges the update again once it holds the later one.
 *
 * `knownVoids` names updates this device already voided at this stage under
 * the same judge and content key; they stay void without being imported
 * again. A void whose import changed the scratch document costs a rebuild;
 * once the page's rebuilds would pass `MAX_SCRATCH_REBUILD_BYTES`, every
 * later update not already known void is deferred.
 *
 * A duplicated id still fails the page, because an honest server never
 * serves one.
 */
export async function validateDocumentSyncUpdateImports(input: {
  currentDocument: SyncDocument;
  decryptedUpdates: readonly DecryptedDocumentSyncUpdate[];
  knownVoids?: ReadonlySet<string> | undefined;
  /** @internal The rebuild budget; tests lower it. */
  rebuildBudgetBytes?: number | undefined;
  responseUpdates?: readonly SyncResponseUpdate[] | undefined;
}): Promise<DocumentSyncImportVerdicts> {
  if (input.decryptedUpdates.length === 0) {
    return { deferredUpdateIds: [], voided: [] };
  }
  assertNoDuplicateUpdateIds(input);
  const responseById = new Map(
    (input.responseUpdates ?? []).map((update) => [update.id, update]),
  );
  const deferredUpdateIds: string[] = [];
  const voided: VoidedDocumentSyncUpdate[] = [];
  const scratch = await ScratchHistory.open(
    exportFullHistorySnapshot(input.currentDocument),
    input.rebuildBudgetBytes ?? MAX_SCRATCH_REBUILD_BYTES,
  );
  try {
    for (const update of input.decryptedUpdates) {
      if (input.knownVoids?.has(update.id)) {
        voided.push(
          voidOf(update, new Error(KNOWN_VOID_MESSAGE), responseById),
        );
      } else if (!(await scratch.ready())) {
        deferredUpdateIds.push(update.id);
      } else {
        const judgement = scratch.judge(update);
        if (judgement.verdict === "void") {
          voided.push(voidOf(update, judgement.failure, responseById));
        }
      }
    }
  } finally {
    scratch.free();
  }
  return { deferredUpdateIds, voided };
}
