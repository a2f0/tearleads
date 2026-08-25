import type { DocumentsPersistence } from "@symcrypt/client-sdk";

export function createMemoryAbsentDocumentCleanup(input: {
  deleteSideRows: (localId: string) => void;
  documentExists: (localId: string) => boolean;
}): Pick<DocumentsPersistence, "deleteDocumentSideRowsIfAbsent"> {
  return {
    async deleteDocumentSideRowsIfAbsent(
      execSql,
      localId,
      deleteClientProjection,
    ) {
      if (input.documentExists(localId)) return false;
      input.deleteSideRows(localId);
      await deleteClientProjection(execSql);
      return true;
    },
  };
}
