import type { ContainerDocumentRecord as DocumentRecord } from "./containerPersistence";

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
