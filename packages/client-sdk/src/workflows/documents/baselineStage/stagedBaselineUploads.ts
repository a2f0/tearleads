import type { AccessEvent } from "@tearleads/crypto";
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

function keyTargetIds(targets: readonly RotationKeyTarget[]): string[] {
  return targets.map(({ containerId, containerKeyEpochId }) =>
    JSON.stringify([containerId, containerKeyEpochId]),
  );
}

/**
 * One document's upload through a stage: the machine's state, the plan
 * every attempt signs alike, and where the plan's key has gone. It lives in
 * memory only, so a process that restarts has no upload and starts the next
 * one over; the stage it left is replaced by that upload's, abandoned as an
 * orphan, or expires.
 */
export class StagedBaselineUpload {
  state: StagedBaselineState = INITIAL_STAGED_BASELINE_STATE;
  /**
   * Every target the key was wrapped for by an attempt that planned with
   * it, whether or not its request was sent, answered or accepted. It only
   * grows, and no attempt tag guards it: a request a superseded run sent
   * gave the key away as surely as the current run's.
   */
  private readonly keyTargets = new Set<string>();

  constructor(
    readonly documentId: string,
    readonly plan: StagedBaselinePlan,
    keyTargets: readonly RotationKeyTarget[],
  ) {
    this.wrapKeyFor(keyTargets);
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
   * Whether an attempt that wraps the key for `targets` leaves out nobody
   * the key has gone to: every target it was ever wrapped for is among them.
   * A rotation exists to keep a key from someone, so a key any request
   * carried to a target the new attempt leaves out is not a fresh key for
   * that attempt, whatever became of the request.
   */
  keyMayBeWrappedFor(targets: readonly RotationKeyTarget[]): boolean {
    const offered = new Set(keyTargetIds(targets));
    return [...this.keyTargets].every((target) => offered.has(target));
  }

  /** Remember that an attempt wraps the key for `targets`. */
  wrapKeyFor(targets: readonly RotationKeyTarget[]): void {
    for (const target of keyTargetIds(targets)) this.keyTargets.add(target);
  }
}

/** The uploads of one database's documents, at most one a document. */
export interface StagedBaselineUploads {
  /** The document's upload, whatever its state. */
  get(documentId: string): StagedBaselineUpload | null;
  /** Start an upload, replacing the document's earlier one. */
  begin(
    documentId: string,
    plan: StagedBaselinePlan,
    keyTargets: readonly RotationKeyTarget[],
  ): StagedBaselineUpload;
  /** Forget `upload`, unless another has replaced it. */
  end(upload: StagedBaselineUpload): void;
  /** Whether an upload here is filling the stage `baselineId`. */
  tracks(documentId: string, baselineId: string): boolean;
}

function createStagedBaselineUploads(): StagedBaselineUploads {
  const uploads = new Map<string, StagedBaselineUpload>();
  return {
    begin(documentId, plan, keyTargets) {
      const upload = new StagedBaselineUpload(documentId, plan, keyTargets);
      uploads.set(documentId, upload);
      return upload;
    },
    end(upload) {
      if (uploads.get(upload.documentId) === upload) {
        uploads.delete(upload.documentId);
      }
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
