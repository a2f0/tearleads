import {
  encodeVersionVector,
  exportFullHistorySnapshot,
  importSnapshot,
  satisfiesVersionVector,
} from "@symcrypt/loro";
import {
  createContainerMetadataDocument,
  getDefaultContainerName,
  readContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import { metadataSyncSecurityContextMatches } from "./metadataSyncSettlement";
import type { ContainerMetadataState } from "./metadataTypes";

interface DetachedContainerMetadataState extends ContainerMetadataState {
  readonly detachedSource: {
    readonly metadataVersion: string;
  };
}

interface DetachedContainerMetadataInstallOptions {
  readonly candidateRecord?: ContainerMetadataState["record"];
  readonly preserveConcurrentMetadataEdit?: boolean;
}

function mergeConcurrentMetadataRecord(
  liveRecord: ContainerMetadataState["record"],
  candidateRecord: ContainerMetadataState["record"],
): ContainerMetadataState["record"] {
  if (metadataSyncSecurityContextMatches(liveRecord, candidateRecord)) {
    return liveRecord;
  }

  // The live document owns the concurrent CRDT frontier, but the candidate
  // owns the newly committed remote identity. Carry only the fields that
  // describe the live CRDT history across that identity boundary.
  return {
    ...candidateRecord,
    metadataUpdates: liveRecord.metadataUpdates,
    snapshotEndVersion: liveRecord.snapshotEndVersion,
    ...(liveRecord.pendingBaseVersion === undefined
      ? {}
      : { pendingBaseVersion: liveRecord.pendingBaseVersion }),
  };
}

/**
 * Gives an asynchronous sync pass its own mutable metadata projection. Durable
 * settlement can then repair or replace the candidate without changing the
 * live store until the caller has rechecked its lifecycle generation.
 */
export async function createDetachedContainerMetadataState(
  metadataState: ContainerMetadataState,
): Promise<DetachedContainerMetadataState> {
  const doc = await createContainerMetadataDocument(metadataState.container.id);
  importSnapshot(doc, exportFullHistorySnapshot(metadataState.doc));
  return {
    ...metadataState,
    container: { ...metadataState.container },
    detachedSource: {
      metadataVersion: encodeVersionVector(metadataState.doc),
    },
    doc,
    record: { ...metadataState.record },
  };
}

export function installDetachedContainerMetadataState(
  target: ContainerMetadataState,
  candidate: DetachedContainerMetadataState,
  options: DetachedContainerMetadataInstallOptions = {},
): void {
  const candidateRecord = options.candidateRecord ?? candidate.record;
  const liveMetadataVersion = encodeVersionVector(target.doc);
  const candidateMetadataVersion = encodeVersionVector(candidate.doc);
  const liveRecord = target.record;
  const livePullContinuation = target.pullContinuation;
  const preserveConcurrentLiveMetadata =
    options.preserveConcurrentMetadataEdit === true &&
    liveMetadataVersion !== candidate.detachedSource.metadataVersion &&
    !satisfiesVersionVector(candidateMetadataVersion, liveMetadataVersion);
  const installedRecord = preserveConcurrentLiveMetadata
    ? mergeConcurrentMetadataRecord(liveRecord, candidateRecord)
    : candidateRecord;

  if (preserveConcurrentLiveMetadata) {
    const metadata = readContainerMetadataValue(
      target.doc,
      getDefaultContainerName(candidate.container.parentId),
    );
    target.container = {
      ...candidate.container,
      icon: metadata.icon,
      name: metadata.name,
    };
  } else {
    target.container = candidate.container;
    target.doc = candidate.doc;
  }
  target.metadataWriterProjection = candidate.metadataWriterProjection;
  target.pullContinuation = preserveConcurrentLiveMetadata
    ? metadataSyncSecurityContextMatches(liveRecord, candidateRecord)
      ? livePullContinuation
      : (candidateRecord.pullContinuation ?? null)
    : (candidateRecord.pullContinuation ?? null);
  target.record = installedRecord;
  target.rekeyOnlyPassCount = candidate.rekeyOnlyPassCount;
}
