import { bytesToBase64 } from "@symcrypt/encoding";
import { encodeVersionVector, exportFullHistorySnapshot } from "@symcrypt/loro";
import type {
  DocumentsPersistence,
  StoredDocumentRecord,
} from "../../data/persistence/documents/documentsPersistence";
import type { PendingUpdateFields } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

export function createInitialDocumentRows(input: {
  currentDoc: Parameters<typeof encodeVersionVector>[0];
  execSql: ExecSql;
  persistence: DocumentsPersistence;
  pendingUpdate?: PendingUpdateFields | undefined;
  record: StoredDocumentRecord;
  stillCurrent?: (() => boolean) | undefined;
  saveClientProjection: Parameters<
    DocumentsPersistence["createDocumentWithHistoryCheckpoint"]
  >[4];
}): Promise<string | null> {
  return input.persistence.createDocumentWithHistoryCheckpoint(
    input.execSql,
    input.record,
    {
      endVersionVector: encodeVersionVector(input.currentDoc),
      snapshot: bytesToBase64(exportFullHistorySnapshot(input.currentDoc)),
    },
    input.pendingUpdate || input.stillCurrent
      ? {
          ...(input.pendingUpdate
            ? { pendingUpdate: input.pendingUpdate }
            : {}),
          ...(input.stillCurrent ? { stillCurrent: input.stillCurrent } : {}),
        }
      : undefined,
    input.saveClientProjection,
  );
}
