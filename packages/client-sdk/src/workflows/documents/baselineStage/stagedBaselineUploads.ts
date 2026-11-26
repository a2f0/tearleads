import type { AccessEvent } from "@tearleads/crypto";
import {
  type ExecSql,
  resolveCanonicalExecSql,
} from "../../../data/sqlite/sqlSchema";
import {
  INITIAL_STAGED_BASELINE_STATE,
  isStagedBaselineOver,
  type StagedBaselineEvent,
  type StagedBaselineState,
  transitionStagedBaseline,
} from "./stagedBaselineMachine";

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
 * What the writer keeps of a segment it staged: enough to prove later that
 * a re-proven history still gives the same bytes, to sign its header again,
 * and to carry the digest forward. Never the ciphertext.
 */
export interface StagedSegmentRecord {
  readonly ciphertextHash: string;
  readonly contentRecordId: string;
  readonly dependencyVersionVector: string;
  /** The stage's digest once this segment is staged. */
  readonly digestAfter: string;
  readonly metadataHash: string;
  readonly partialEndVersionVector: string;
  readonly partialStartVersionVector: string;
  readonly plaintextHash: string;
  readonly updateId: string;
}

/**
 * One document's upload through a stage: the machine's state and what the
 * writer remembers beside it. It lives in memory only, so a process that
 * restarts has no upload and starts the next one over; the stage it left is
 * replaced by that upload's, or expires.
 */
export class StagedBaselineUpload {
  state: StagedBaselineState = INITIAL_STAGED_BASELINE_STATE;
  /** The staged segments, in index order; the last may be unacknowledged. */
  records: StagedSegmentRecord[] = [];
  /**
   * What the staged headers were signed for (`RotationBaselineSigner`), or
   * null when the API said they are stale.
   */
  headerIdentity: string | null = null;

  constructor(
    readonly documentId: string,
    readonly plan: StagedBaselinePlan,
  ) {}

  /** Apply `event`, and what entering the new state does to the records. */
  dispatch(event: StagedBaselineEvent): StagedBaselineState {
    const previous = this.state;
    const next = transitionStagedBaseline(previous, event);
    if (next === previous) return next;
    this.state = next;
    if (next.status === "planning") {
      // No stage stands: nothing recorded describes one.
      this.records = [];
      this.headerIdentity = null;
    }
    if (
      next.status === "resigningHeaders" &&
      previous.status === "committing"
    ) {
      this.headerIdentity = null;
    }
    return next;
  }

  /** Whether an upload planned for `plan`'s key can go on as this one. */
  continues(plan: {
    readonly contentKeyCommitment: string;
    readonly contentKeyEpoch: number;
  }): boolean {
    return (
      !isStagedBaselineOver(this.state) &&
      this.plan.contentKeyEpoch === plan.contentKeyEpoch &&
      this.plan.contentKeyCommitment === plan.contentKeyCommitment
    );
  }
}

/** The uploads of one database's documents, at most one a document. */
export interface StagedBaselineUploads {
  /** The document's upload, whatever its state. */
  get(documentId: string): StagedBaselineUpload | null;
  /** Start an upload, replacing the document's earlier one. */
  begin(documentId: string, plan: StagedBaselinePlan): StagedBaselineUpload;
  /** Forget `upload`, unless another has replaced it. */
  end(upload: StagedBaselineUpload): void;
}

function createStagedBaselineUploads(): StagedBaselineUploads {
  const uploads = new Map<string, StagedBaselineUpload>();
  return {
    begin(documentId, plan) {
      const upload = new StagedBaselineUpload(documentId, plan);
      uploads.set(documentId, upload);
      return upload;
    },
    end(upload) {
      if (uploads.get(upload.documentId) === upload) {
        uploads.delete(upload.documentId);
      }
    },
    get: (documentId) => uploads.get(documentId) ?? null,
  };
}

const uploadsByDatabase = new WeakMap<ExecSql, StagedBaselineUploads>();

/**
 * The staged baseline uploads of the database `execSql` reaches: one
 * registry per database, so a sync's heal and an unlink of one document
 * share its upload, and a refused commit's next attempt finds the stage it
 * left. A caller with no database gets a registry of its own, whose uploads
 * end with the call.
 *
 * This is the seam for durable resume: a registry that reads and writes its
 * uploads through `execSql` survives a restart, and nothing above it would
 * change.
 */
export function getOrCreateStagedBaselineUploads(
  execSql: ExecSql | undefined,
): StagedBaselineUploads {
  if (!execSql) return createStagedBaselineUploads();
  const database = resolveCanonicalExecSql(execSql);
  let uploads = uploadsByDatabase.get(database);
  if (!uploads) {
    uploads = createStagedBaselineUploads();
    uploadsByDatabase.set(database, uploads);
  }
  return uploads;
}
