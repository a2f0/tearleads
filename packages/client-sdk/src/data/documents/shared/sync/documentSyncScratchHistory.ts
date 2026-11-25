import {
  createDocument,
  encodeVersionVector,
  getImportBlobMetadata,
  importSnapshot,
  importUpdates,
  isLoroRuntimeFailure,
  LoroImportUnresolvedDependenciesError,
  LoroReusedOperationIdError,
  listVersionVectorSpans,
  satisfiesVersionVector,
  updateMatchesDocumentHistory,
  versionVectorsEqual,
} from "@tearleads/loro";
import { assertDecryptedDocumentUpdateMetadata } from "../documentUpdateIntegrity";
import type { DecryptedDocumentSyncUpdate } from "./documentSyncTypes";
import { importDecryptedDocumentSyncUpdates } from "./documentSyncUpdateImport";

export type SyncDocument = Awaited<ReturnType<typeof createDocument>>;

const MISSING_DEPENDENCY_MESSAGE =
  "incoming Loro update depends on operations no earlier served update carries";
const REUSED_FRONTIER_MESSAGE =
  "incoming Loro update reuses an already-covered frontier with different operations";

/** The peer this device writes under and how many of its operations it held. */
export interface OwnPeer {
  readonly heldCounter: number;
  readonly peerId: string;
}

export function ownPeerOf(document: SyncDocument): OwnPeer {
  const peerId = document.peerIdStr;
  return { heldCounter: document.version().get(peerId) ?? 0, peerId };
}

export type ScratchJudgement =
  | { readonly verdict: "accepted" }
  | { readonly failure: unknown; readonly verdict: "runtime_failure" }
  | {
      readonly failure: unknown;
      /**
       * Set when the update reuses ids of operations this device wrote under
       * its own peer with other operations: a writer committed them as it.
       */
      readonly preemptedPeerId: string | null;
      /** Whether the failed import left operations in the scratch document. */
      readonly scratchChanged: boolean;
      readonly stage: "loro_import" | "loro_metadata";
      readonly verdict: "void";
    };

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
    freeQuietly(document);
    throw error;
  }
}

/** Frees `document`; a module the runtime left unusable may refuse even that. */
function freeQuietly(document: SyncDocument): void {
  try {
    document.free();
  } catch (error) {
    if (!isLoroRuntimeFailure(error)) throw error;
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
  } catch (error) {
    if (isLoroRuntimeFailure(error)) throw error;
    return false;
  }
  return !satisfiesVersionVector(held, start);
}

/**
 * This device's peer when `update` (whose declared span its payload matches)
 * carries operations under it at counters the device already held.
 */
function preemptedOwnPeer(
  update: DecryptedDocumentSyncUpdate,
  own: OwnPeer,
): string | null {
  const span = listVersionVectorSpans(update).find(
    (entry) => entry.peerId === own.peerId,
  );
  return span !== undefined && span.startCounter < own.heldCounter
    ? own.peerId
    : null;
}

type ScratchVoid = Extract<ScratchJudgement, { readonly verdict: "void" }>;

function importVoid(
  failure: unknown,
  scratchChanged: boolean,
  preemptedPeerId: string | null = null,
): ScratchVoid {
  return {
    failure,
    preemptedPeerId,
    scratchChanged,
    stage: "loro_import",
    verdict: "void",
  };
}

/**
 * The void of an update that reuses ids `document` held with other
 * operations. It names this device's peer when those ids are its own.
 */
function reusedFrontierVoid(
  update: DecryptedDocumentSyncUpdate,
  own: OwnPeer,
  scratchChanged: boolean,
  cause?: unknown,
): ScratchVoid {
  return importVoid(
    new Error(REUSED_FRONTIER_MESSAGE, { cause }),
    scratchChanged,
    preemptedOwnPeer(update, own),
  );
}

/**
 * Whether `update` joins `document`, which holds the reader's history and
 * every update accepted before it in server order. A void reports whether its
 * import changed the document: an import that left pending or partial
 * operations behind needs a clean rebuild before the next update is judged.
 * A Loro runtime failure is thrown.
 */
function judgeOnScratch(
  document: SyncDocument,
  update: DecryptedDocumentSyncUpdate,
  own: OwnPeer,
): ScratchJudgement {
  const held = encodeVersionVector(document);
  if (startsPastHeldCounters(held, update)) {
    return importVoid(new Error(MISSING_DEPENDENCY_MESSAGE), false);
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
    if (isLoroRuntimeFailure(error)) throw error;
    if (error instanceof LoroImportUnresolvedDependenciesError) {
      // Loro keeps the operations it could not apply as pending.
      return importVoid(
        new Error(MISSING_DEPENDENCY_MESSAGE, { cause: error }),
        true,
      );
    }
    if (error instanceof LoroReusedOperationIdError) {
      return reusedFrontierVoid(update, own, changed(), error);
    }
    return importVoid(error, changed());
  }
  // Loro refuses an update that reuses held ids with different operations.
  // An import it accepts is still proved against the resulting history, so
  // the verdict does not rest on that refusal alone.
  if (!updateMatchesDocumentHistory(document, update.updateData)) {
    return reusedFrontierVoid(update, own, changed());
  }
  return { verdict: "accepted" };
}

/**
 * Judges `update` against `document`: its payload must be the update its
 * signed metadata declares, then join the history. A Loro runtime failure at
 * either step is reported as such, never as a void.
 */
function judgeUpdate(
  document: SyncDocument,
  update: DecryptedDocumentSyncUpdate,
  own: OwnPeer,
): ScratchJudgement {
  try {
    assertDecryptedDocumentUpdateMetadata(update.updateData, update);
  } catch (error) {
    if (isLoroRuntimeFailure(error)) {
      return { failure: error, verdict: "runtime_failure" };
    }
    return {
      failure: error,
      preemptedPeerId: null,
      scratchChanged: false,
      stage: "loro_metadata",
      verdict: "void",
    };
  }
  try {
    return judgeOnScratch(document, update, own);
  } catch (error) {
    if (isLoroRuntimeFailure(error)) {
      return { failure: error, verdict: "runtime_failure" };
    }
    throw error;
  }
}

/** Whether the scratch document can judge the next update. */
export type ScratchReadiness = "over_budget" | "ready" | "runtime_failure";

/**
 * The page's scratch document: the reader's history plus every update
 * accepted so far. A void whose import changed it, or a runtime failure, is
 * rebuilt from those before the next update is judged, while the page's
 * budget allows.
 */
export class ScratchHistory {
  private readonly accepted: DecryptedDocumentSyncUpdate[] = [];
  private changed = false;

  private constructor(
    private readonly snapshot: Uint8Array,
    private budgetBytesLeft: number,
    private document: SyncDocument | null,
    private readonly own: OwnPeer,
  ) {}

  static async open(input: {
    readonly budgetBytes: number;
    readonly own: OwnPeer;
    readonly snapshot: Uint8Array;
  }): Promise<ScratchHistory> {
    return new ScratchHistory(
      input.snapshot,
      input.budgetBytes,
      await createValidationDocument(input.snapshot, []),
      input.own,
    );
  }

  /** Rebuilds the scratch document if the last judgement changed it. */
  async ready(): Promise<ScratchReadiness> {
    if (!this.changed) return "ready";
    const rebuildBytes = this.snapshot.byteLength + totalBytes(this.accepted);
    if (rebuildBytes > this.budgetBytesLeft) return "over_budget";
    this.budgetBytesLeft -= rebuildBytes;
    this.free();
    try {
      this.document = await createValidationDocument(
        this.snapshot,
        this.accepted,
      );
    } catch (error) {
      if (isLoroRuntimeFailure(error)) return "runtime_failure";
      throw error;
    }
    this.changed = false;
    return "ready";
  }

  /** Judges `update`, keeping it for later rebuilds when it joins. */
  judge(update: DecryptedDocumentSyncUpdate): ScratchJudgement {
    if (!this.document) throw new Error("Scratch history was freed");
    const judgement = judgeUpdate(this.document, update, this.own);
    if (judgement.verdict === "accepted") this.accepted.push(update);
    else if (judgement.verdict === "runtime_failure") this.changed = true;
    else this.changed = judgement.scratchChanged;
    return judgement;
  }

  free(): void {
    if (this.document) freeQuietly(this.document);
    this.document = null;
  }
}
