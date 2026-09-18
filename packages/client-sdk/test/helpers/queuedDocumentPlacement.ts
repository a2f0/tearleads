import { sqlDocumentMoveIntentPersistence } from "../../src/data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentContainerProjectionPersistence } from "../../src/data/persistence/containers/documentContainerProjectionPersistence";
import type { ExecSql } from "../../src/data/sqlite/sqlSchema";
import { defaultDocumentsPersistence } from "../../src/workflows/documents";

export async function persistQueuedDocumentPlacement(input: {
  execSql: ExecSql;
  documentId: string;
  accessStateHash: string;
  linkOnly?: boolean | undefined;
  extraContainerId?: string | undefined;
  replaceLinkedContainers?: boolean | undefined;
  sourceContainerId: string | null;
  rootContainerId: string;
  targetContainerId: string;
}): Promise<void> {
  const { execSql, documentId } = input;
  await defaultDocumentsPersistence.ensureSchema(execSql);
  await defaultDocumentsPersistence.saveDocument(execSql, {
    accessEpoch: 1,
    accessStateHash: input.accessStateHash,
    containerId: input.linkOnly
      ? input.rootContainerId
      : input.targetContainerId,
    contentKeyBundle: null,
    documentId,
    documentKekTargets: null,
    documentKind: "note",
    documentManifestBundle: null,
    id: "queued-move-local",
    lastCommitLsn: null,
    snapshotEndVersion: "",
    text: "",
    title: "Queued move",
  });
  await sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
    execSql,
    documentId,
    [
      ...(input.linkOnly ? [input.rootContainerId] : []),
      input.targetContainerId,
      ...(input.extraContainerId ? [input.extraContainerId] : []),
    ],
  );
  if (input.linkOnly) {
    await sqlDocumentMoveIntentPersistence.enqueueLinkIntent(execSql, {
      documentId,
      localId: "queued-move-local",
      sourceContainerId: input.rootContainerId,
      targetContainerId: input.targetContainerId,
    });
  } else {
    await sqlDocumentMoveIntentPersistence.enqueueMoveIntent(execSql, {
      documentId,
      localId: "queued-move-local",
      replaceLinkedContainers: input.replaceLinkedContainers ?? true,
      sourceContainerId: input.sourceContainerId,
      targetContainerId: input.targetContainerId,
    });
  }
  if (input.extraContainerId) {
    await sqlDocumentMoveIntentPersistence.enqueueLinkIntent(execSql, {
      documentId,
      localId: "queued-move-local",
      sourceContainerId: input.linkOnly
        ? input.rootContainerId
        : input.targetContainerId,
      targetContainerId: input.extraContainerId,
    });
  }
}
