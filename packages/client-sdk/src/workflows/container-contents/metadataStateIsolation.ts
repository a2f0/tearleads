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
import type { ContainerMetadataState } from "./metadataTypes";

interface DetachedContainerMetadataState extends ContainerMetadataState {
  readonly detachedSource: {
    readonly metadataVersion: string;
    readonly record: ContainerMetadataState["record"];
  };
}

interface DetachedContainerMetadataInstallOptions {
  readonly candidateRecord?: ContainerMetadataState["record"];
  readonly preserveConcurrentMetadataEdit?: boolean;
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
      record: metadataState.record,
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
  const preserveNewerLiveRecord =
    options.preserveConcurrentMetadataEdit === true &&
    liveMetadataVersion !== candidate.detachedSource.metadataVersion &&
    liveRecord !== candidate.detachedSource.record &&
    !satisfiesVersionVector(candidateMetadataVersion, liveMetadataVersion);

  if (preserveNewerLiveRecord) {
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
  target.pullContinuation = preserveNewerLiveRecord
    ? livePullContinuation
    : (candidateRecord.pullContinuation ?? null);
  target.record = preserveNewerLiveRecord ? liveRecord : candidateRecord;
  target.rekeyOnlyPassCount = candidate.rekeyOnlyPassCount;
}
