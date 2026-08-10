import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";

export async function saveBlobInfoTestDocument(input: {
  execSql: Parameters<typeof sqlDocumentsPersistence.saveDocument>[0];
  id: string;
  title: string;
  documentId: string | null;
}) {
  await sqlDocumentsPersistence.saveDocument(input.execSql, {
    accessEpoch: 1,
    accessStateHash: null,
    containerId: "container-1",
    documentId: input.documentId,
    documentKind: "note",
    id: input.id,
    lastCommitLsn: null,
    snapshotEndVersion: "",
    text: input.title,
    title: input.title,
  });
}
