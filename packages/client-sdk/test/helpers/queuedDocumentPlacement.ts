import { sqlDocumentMoveIntentPersistence } from "../../src/data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentContainerProjectionPersistence } from "../../src/data/persistence/containers/documentContainerProjectionPersistence";
import { getClientSQLitePersistenceRuntime } from "../../src/data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../src/data/sqlite/sqlSchema";
import { runSerializedSqlMutation } from "../../src/data/sqlite/sqlSchema";
import {
  type DocumentStructuralMutationRelinkInput,
  type DocumentStructuralMutationRuntime,
  removeDocumentLink,
} from "../../src/workflows/container-contents/documentStructure";
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

export function createQueuedDocumentPlacementHost(input: {
  execSql: ExecSql;
  rotationSnapshot: Uint8Array;
  submittedOperations: string[];
  relinkInputs: DocumentStructuralMutationRelinkInput[];
}) {
  const { execSql, rotationSnapshot, submittedOperations, relinkInputs } =
    input;
  return {
    documentWorkflowRuntime: (containerId: string | null) =>
      `runtime:${containerId}`,
    mergeDocumentSummary: () => {},
    openDocumentStore: () => ({
      assertCanRotateContentKey: async () => {
        submittedOperations.push("preflight");
        return rotationSnapshot;
      },
      ensureInitialized: async () => true,
      relink: async (relinkInput: DocumentStructuralMutationRelinkInput) => {
        relinkInputs.push(relinkInput);
        return runSerializedSqlMutation(execSql, (lockedExecSql) =>
          getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
            async () => {
              const summary =
                await defaultDocumentsPersistence.relinkPersistedDocument(
                  lockedExecSql,
                  relinkInput,
                );
              await relinkInput.commitSideEffect?.(lockedExecSql);
              return summary;
            },
          ),
        );
      },
      requestSync: () => undefined,
      updateRuntime: () => undefined,
    }),
  };
}

export async function unlinkQueuedDocumentPlacement(input: {
  host: ReturnType<typeof createQueuedDocumentPlacementHost>;
  execSql: ExecSql;
  documentId: string;
  removedContainerId: string;
  runtime: DocumentStructuralMutationRuntime;
}) {
  const doc = await defaultDocumentsPersistence.loadDocument(
    input.execSql,
    "queued-move-local",
  );
  if (!doc) throw new Error("Missing fixture document");
  return removeDocumentLink({
    host: input.host,
    runtime: input.runtime,
    removedContainerId: input.removedContainerId,
    note: {
      id: doc.id,
      documentId: input.documentId,
      containerId: doc.containerId,
      title: "Queued link",
      updatedAt: new Date().toISOString(),
    },
    setLinkedContainerIdsForDocument: () => {},
  });
}
