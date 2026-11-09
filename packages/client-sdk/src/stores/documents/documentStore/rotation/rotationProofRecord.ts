import {
  encodeVersionVector,
  getImportBlobMetadata,
  versionVectorsEqual,
} from "@tearleads/loro";
import type { DocumentState, DocumentStoreState } from "../state";

/**
 * The last full-history rotation proof this store completed. A queued unlink
 * proves once when it is accepted; its durable-intent replay reuses that proof
 * while the store still holds the same document, at the same local write
 * generation and version vector, in the same database. The server stays
 * authoritative: under the manifest-head lock it refuses a baseline that does
 * not cover every committed update (`document_unlink_rotation_baseline_stale`),
 * and the replay then proves again. Memory only, so a reload proves again.
 *
 * The container scope is deliberately not part of the identity: the accepted
 * unlink moves the document's local placement before its replay, and the
 * proof is about the document's history, not where it is shown.
 */
interface RecordedRotationProof {
  readonly doc: DocumentState;
  readonly documentId: string;
  readonly domainScope: DocumentStoreState["runtime"]["state"]["domainScope"];
  readonly execSql: DocumentStoreState["runtime"]["infra"]["execSql"];
  readonly localWriteGeneration: number;
  readonly persistence: DocumentStoreState["persistence"];
  readonly snapshot: Uint8Array;
  readonly snapshotVersionVector: string;
}

const recordedRotationProofs = new WeakMap<
  DocumentStoreState,
  RecordedRotationProof
>();

export function recordRotationProof(
  state: DocumentStoreState,
  snapshot: Uint8Array,
): void {
  const documentId = state.record?.documentId;
  if (!state.doc || !documentId) {
    recordedRotationProofs.delete(state);
    return;
  }
  recordedRotationProofs.set(state, {
    doc: state.doc,
    documentId,
    domainScope: state.runtime.state.domainScope,
    execSql: state.runtime.infra.execSql,
    localWriteGeneration: state.localWriteGeneration,
    persistence: state.persistence,
    snapshot,
    // The snapshot's own frontier, not the document's: an edit that landed
    // after the install must make the proof stale.
    snapshotVersionVector:
      getImportBlobMetadata(snapshot).partialEndVersionVector,
  });
}

/** The recorded snapshot while it still covers this exact local document. */
export function currentRecordedRotationProof(
  state: DocumentStoreState,
): Uint8Array | null {
  const recorded = recordedRotationProofs.get(state);
  if (!recorded) return null;
  if (
    state.doc === recorded.doc &&
    state.record?.documentId === recorded.documentId &&
    state.runtime.state.domainScope === recorded.domainScope &&
    state.runtime.infra.execSql === recorded.execSql &&
    state.localWriteGeneration === recorded.localWriteGeneration &&
    state.persistence === recorded.persistence &&
    versionVectorsEqual(
      encodeVersionVector(recorded.doc),
      recorded.snapshotVersionVector,
    )
  ) {
    return recorded.snapshot;
  }
  recordedRotationProofs.delete(state);
  return null;
}
