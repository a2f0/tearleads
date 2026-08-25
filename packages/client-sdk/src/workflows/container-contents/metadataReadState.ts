import type { ContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import type { ContainerDocumentRecord as DocumentRecord } from "./containerPersistence";

type SaveContainerOptions = Parameters<
  ContainerContentsPersistence["saveContainer"]
>[3];

export function createReadOnlyMetadataSyncSaveOptions(): SaveContainerOptions {
  const syncTimestamp = new Date().toISOString();
  return {
    localUpdatedAt: syncTimestamp,
    serverTimestamps: { updatedAt: syncTimestamp },
  };
}

export function hasCurrentContainerMetadataReadState(
  record: Pick<
    DocumentRecord,
    | "contentKeyBundle"
    | "documentKekTargets"
    | "documentManifestBundle"
    | "lastCommitLsn"
  >,
): boolean {
  return (
    typeof record.lastCommitLsn === "string" &&
    record.lastCommitLsn.length > 0 &&
    typeof record.contentKeyBundle === "string" &&
    record.contentKeyBundle.length > 0 &&
    typeof record.documentKekTargets === "string" &&
    record.documentKekTargets.length > 0 &&
    typeof record.documentManifestBundle === "string" &&
    record.documentManifestBundle.length > 0
  );
}
