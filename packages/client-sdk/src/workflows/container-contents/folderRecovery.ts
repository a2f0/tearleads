import { base64ToBytes } from "@tearleads/encoding";
import { importUpdates } from "@tearleads/loro";
import {
  createContainerMetadataDocument,
  readContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import {
  discardRetainedContainerMetadata,
  listRecoveryFolderMoveIds,
  listRetainedContainerMetadata,
} from "../../data/persistence/container-contents/containerRecoveryPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

export interface RecoveryFolder {
  containerId: string;
  organizationId: string;
  name: string;
  icon: string | null;
  pendingUpdateCount: number;
  hasStructuralIntent: boolean;
  revision: string;
}

export function createFolderRecoveryQueries(execSql: ExecSql) {
  return {
    listRecoveryFolderMoveIds(input: {
      currentOrganizationId: string | null;
    }): Promise<string[]> {
      return listRecoveryFolderMoveIds(execSql, input.currentOrganizationId);
    },
    async listRecoveryFolders(input: {
      currentOrganizationId: string | null;
    }): Promise<RecoveryFolder[]> {
      const records = await listRetainedContainerMetadata(
        execSql,
        input.currentOrganizationId,
      );
      return Promise.all(
        records.map(async ({ metadataUpdates, ...record }) => {
          const doc = await createContainerMetadataDocument(record.containerId);
          try {
            if (metadataUpdates)
              importUpdates(doc, [base64ToBytes(metadataUpdates)]);
            return {
              ...record,
              ...readContainerMetadataValue(doc, "Untitled folder"),
            };
          } finally {
            doc.free();
          }
        }),
      );
    },
    discardRecoveryFolder(
      input: Pick<
        RecoveryFolder,
        "containerId" | "organizationId" | "revision"
      >,
    ): Promise<boolean> {
      return discardRetainedContainerMetadata(execSql, input);
    },
  };
}
