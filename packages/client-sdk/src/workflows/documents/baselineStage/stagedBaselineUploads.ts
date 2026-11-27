import type { AccessEvent } from "@tearleads/crypto";
import type { DocumentBaselineStageApi } from "../../../data/documents/shared/sync/baselineStageApi";
import {
  deleteDocumentStagedBaselineUpload,
  loadDocumentStagedBaselineUploads,
  type PersistedStagedBaselineUpload,
  saveDocumentStagedBaselineUpload,
} from "../../../data/persistence/documents/records/documentBaselineStagePersistence";
import {
  type ExecSql,
  resolveCanonicalExecSql,
} from "../../../data/sqlite/sqlSchema";
import { transitionStagedBaseline } from "./stagedBaselineMachine";
import {
  INITIAL_STAGED_BASELINE_STATE,
  isStagedBaselineOver,
  type StagedBaselineEvent,
  type StagedBaselineState,
} from "./stagedBaselineState";

/**
 * What an upload fixes once, so that every request it sends and every
 * retry of the request that commits it signs the same thing: the fresh
 * content key and the epoch it opens, and the signed time and event id of
 * the plan. A retry that planned afresh would sign another manifest, and
 * every staged header would have to be signed again.
 */
export interface StagedBaselinePlan {
  readonly contentKey: Uint8Array;
  readonly contentKeyCommitment: string;
  readonly contentKeyEpoch: number;
  /**
   * The signed link-set event of an unlink; a sync has none. A signature is
   * not the same twice, and the manifest an unlink writes hashes its event,
   * so a retry that signed the same event again would name another manifest.
   */
  readonly linkSetEvent: AccessEvent | undefined;
  readonly signedAt: string;
}

/**
 * A place a rotation's content key is wrapped for: one key epoch of one
 * linked container. Whoever holds that epoch's key can open the wrap, so
 * the pair names who a request that carries the wrap gives the key to. A
 * later key epoch of the same container is another place: the members it
 * dropped still hold the earlier one.
 */
export interface RotationKeyTarget {
  readonly containerId: string;
  readonly containerKeyEpochId: string;
}

function keyTargetId({
  containerId,
  containerKeyEpochId,
}: RotationKeyTarget): string {
  return JSON.stringify([containerId, containerKeyEpochId]);
}

function keyTargetIds(targets: readonly RotationKeyTarget[]): string[] {
  return targets.map(keyTargetId);
}

/**
 * One document's upload through a stage: the machine's state, the plan
 * every attempt signs alike, and where the plan's key has gone. When the
 * registry is backed by local SQLite, the upload is saved before opening
 * its stage and before each segment PUT so a restarted process resumes
 * from the server-acknowledged index.
 */
export class StagedBaselineUpload {
  state: StagedBaselineState = INITIAL_STAGED_BASELINE_STATE;
  /**
   * Every target the key was wrapped for by an attempt that planned with
   * it, whether or not its request was sent, answered or accepted. It only
   * grows, and no attempt tag guards it: a request a superseded run sent
   * gave the key away as surely as the current run's.
   */
  private readonly keyTargets = new Map<string, RotationKeyTarget>();

  constructor(
    readonly documentId: string,
    readonly plan: StagedBaselinePlan,
    keyTargets: readonly RotationKeyTarget[],
  ) {
    this.wrapKeyFor(keyTargets);
  }

  /** Reconstruct an in-progress upload loaded from local SQLite after restart. */
  static hydrate(
    persisted: PersistedStagedBaselineUpload,
  ): StagedBaselineUpload {
    const upload = new StagedBaselineUpload(
      persisted.documentId,
      {
        contentKey: persisted.contentKey,
        contentKeyCommitment: persisted.contentKeyCommitment,
        contentKeyEpoch: persisted.contentKeyEpoch,
        linkSetEvent: persisted.linkSetEvent,
        signedAt: persisted.signedAt,
      },
      persisted.keyTargets,
    );
    upload.state = {
      attempt: 0,
      baselineId: persisted.baselineId,
      headersSignedFor: persisted.headersSignedFor,
      reads: 0,
      records: persisted.records,
      status: "resuming",
    };
    return upload;
  }

  /** Apply `event`; the pure transition owns everything it changes. */
  dispatch(event: StagedBaselineEvent): StagedBaselineState {
    this.state = transitionStagedBaseline(this.state, event);
    return this.state;
  }

  /** Whether the upload is still under way for a key that opens `epoch`. */
  isLiveAt(contentKeyEpoch: number): boolean {
    return (
      !isStagedBaselineOver(this.state) &&
      this.plan.contentKeyEpoch === contentKeyEpoch
    );
  }

  /** Whether an upload planned for `plan`'s key can go on as this one. */
  continues(plan: {
    readonly contentKeyCommitment: string;
    readonly contentKeyEpoch: number;
  }): boolean {
    return (
      this.isLiveAt(plan.contentKeyEpoch) &&
      this.plan.contentKeyCommitment === plan.contentKeyCommitment
    );
  }

  /**
   * Whether an attempt wraps the key for the exact same target set the key
   * has gone to. Shrinking the set would commit a key already wrapped for a
   * target the new attempt leaves out (for instance, a heal's key reused by
   * an unlink); expanding it would wrap a post-revocation key for a target
   * an earlier unlink excluded if a later heal ran against a stale
   * projection. Exact equality allows retries of the same heal or the same
   * unlink and forces a fresh key whenever the target set changes.
   */
  keyMayBeWrappedFor(targets: readonly RotationKeyTarget[]): boolean {
    const offered = new Set(keyTargetIds(targets));
    return (
      offered.size === this.keyTargets.size &&
      [...this.keyTargets.keys()].every((target) => offered.has(target))
    );
  }

  /** Remember that an attempt wraps the key for `targets`. */
  wrapKeyFor(targets: readonly RotationKeyTarget[]): void {
    for (const target of targets) {
      this.keyTargets.set(keyTargetId(target), {
        containerId: target.containerId,
        containerKeyEpochId: target.containerKeyEpochId,
      });
    }
  }

  /** Serializable snapshot for SQLite, or null before a baseline id exists or once over. */
  snapshot(): PersistedStagedBaselineUpload | null {
    const { state } = this;
    if (state.status === "planning" || isStagedBaselineOver(state)) return null;
    return {
      baselineId: state.baselineId,
      contentKey: this.plan.contentKey,
      contentKeyCommitment: this.plan.contentKeyCommitment,
      contentKeyEpoch: this.plan.contentKeyEpoch,
      documentId: this.documentId,
      headersSignedFor:
        "headersSignedFor" in state ? state.headersSignedFor : null,
      keyTargets: [...this.keyTargets.values()],
      linkSetEvent: this.plan.linkSetEvent,
      records: "records" in state ? state.records : [],
      signedAt: this.plan.signedAt,
    };
  }
}

/** The uploads of one database's documents, at most one a document. */
export interface StagedBaselineUploads {
  /** Hydrate any persisted uploads from SQLite once per registry. */
  ensureLoaded(): Promise<void>;
  /** The document's upload, whatever its state. */
  get(documentId: string): StagedBaselineUpload | null;
  /** Start an upload, replacing the document's earlier one. */
  begin(
    documentId: string,
    plan: StagedBaselinePlan,
    keyTargets: readonly RotationKeyTarget[],
  ): StagedBaselineUpload;
  /** Persist `upload`'s current state if it still owns its document. */
  persist(upload: StagedBaselineUpload): Promise<void>;
  /** Forget `upload` in memory, unless another has replaced it. */
  end(upload: StagedBaselineUpload): void;
  /** Forget `upload` in memory and remove its persisted row unless replaced. */
  forget(upload: StagedBaselineUpload): Promise<void>;
  /** Whether an upload here is filling the stage `baselineId`. */
  tracks(documentId: string, baselineId: string): boolean;
}

function createStagedBaselineUploads(execSql?: ExecSql): StagedBaselineUploads {
  const uploads = new Map<string, StagedBaselineUpload>();
  const touched = new Set<string>();
  const writeQueueByDocument = new Map<string, Promise<void>>();
  let loadPromise: Promise<void> | null = null;

  function serializeDocumentWrite(
    documentId: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    const previous = writeQueueByDocument.get(documentId) ?? Promise.resolve();
    const next = previous.then(operation);
    const tracked = next
      .catch(() => undefined)
      .finally(() => {
        if (writeQueueByDocument.get(documentId) === tracked) {
          writeQueueByDocument.delete(documentId);
        }
      });
    writeQueueByDocument.set(documentId, tracked);
    return next;
  }

  return {
    async ensureLoaded() {
      if (!execSql) return;
      if (!loadPromise) {
        loadPromise = loadDocumentStagedBaselineUploads(execSql)
          .then((persisted) => {
            for (const [documentId, record] of persisted) {
              if (!uploads.has(documentId) && !touched.has(documentId)) {
                uploads.set(documentId, StagedBaselineUpload.hydrate(record));
              }
            }
          })
          .catch((error: unknown) => {
            loadPromise = null;
            throw error;
          });
      }
      await loadPromise;
    },
    begin(documentId, plan, keyTargets) {
      touched.add(documentId);
      const upload = new StagedBaselineUpload(documentId, plan, keyTargets);
      uploads.set(documentId, upload);
      return upload;
    },
    async persist(upload) {
      if (!execSql) return;
      await serializeDocumentWrite(upload.documentId, async () => {
        if (uploads.get(upload.documentId) !== upload) return;
        const snap = upload.snapshot();
        if (!snap) return;
        await saveDocumentStagedBaselineUpload(execSql, snap);
      });
    },
    end(upload) {
      touched.add(upload.documentId);
      if (uploads.get(upload.documentId) === upload) {
        uploads.delete(upload.documentId);
      }
    },
    async forget(upload) {
      touched.add(upload.documentId);
      const owned = uploads.get(upload.documentId) === upload;
      if (owned) uploads.delete(upload.documentId);
      if (!execSql || !owned) return;
      await serializeDocumentWrite(upload.documentId, async () => {
        if (uploads.has(upload.documentId)) return;
        await deleteDocumentStagedBaselineUpload(execSql, upload.documentId);
      });
    },
    get: (documentId) => uploads.get(documentId) ?? null,
    tracks(documentId, baselineId) {
      const state = uploads.get(documentId)?.state;
      return (
        state !== undefined &&
        state.status !== "planning" &&
        !isStagedBaselineOver(state) &&
        state.baselineId === baselineId
      );
    },
  };
}

const uploadsByDatabase = new WeakMap<ExecSql, StagedBaselineUploads>();

/**
 * The staged baseline uploads of the database `execSql` reaches: one
 * registry per database, backed by local SQLite so an upload survives a
 * process restart and resumes from the server-acknowledged index. A sync's
 * heal and an unlink of one document share its upload. A caller with no
 * database gets an in-memory registry whose uploads end with the call.
 */
export function getOrCreateStagedBaselineUploads(
  execSql: ExecSql | undefined,
): StagedBaselineUploads {
  if (!execSql) return createStagedBaselineUploads();
  const database = resolveCanonicalExecSql(execSql);
  let uploads = uploadsByDatabase.get(database);
  if (!uploads) {
    uploads = createStagedBaselineUploads(database);
    uploadsByDatabase.set(database, uploads);
  }
  return uploads;
}

/** Forget the upload in memory/SQLite and, if a stage may stand, delete it. */
export async function dropStagedBaselineUpload(
  context: {
    readonly api: DocumentBaselineStageApi;
    readonly uploads: StagedBaselineUploads;
  },
  upload: StagedBaselineUpload,
): Promise<void> {
  await context.uploads.forget(upload);
  const { state } = upload;
  if (state.status === "planning" || state.status === "done") return;
  if ("stageStands" in state && !state.stageStands) return;
  await context.api
    .abandonDocumentBaselineStageResult(upload.documentId, state.baselineId, {
      reportErrors: false,
    })
    .catch(() => undefined);
}
