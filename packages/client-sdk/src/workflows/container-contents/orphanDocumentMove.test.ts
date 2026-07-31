import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSummary } from "../../data/documentSummary";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { createDomainScope } from "../../data/domainScope";
import { sqlDocumentMoveIntentPersistence } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentContainerProjectionPersistence } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import { defaultDocumentsPersistence } from "../documents";
import {
  type DocumentStructuralMutationHost,
  type DocumentStructuralMutationRelinkInput,
  type DocumentStructuralMutationRuntime,
  moveDocumentLink,
} from "./documentStructure";

test("a remote orphan moves from null scope into a writable container", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-orphan-document-move",
  );
  try {
    await defaultDocumentsPersistence.ensureSchema(execSql);
    await defaultDocumentsPersistence.saveDocument(execSql, {
      accessEpoch: 7,
      accessStateHash: "access-state-hash-7",
      containerId: null,
      contentKeyBundle: null,
      documentId: "document-1",
      documentKekTargets: null,
      documentKind: "note",
      documentManifestBundle: null,
      id: "note-1",
      lastCommitLsn: null,
      snapshotEndVersion: "",
      text: "Recovered",
      title: "Recovered",
    });
    const openedScopes: Array<string | null> = [];
    const relinkInputs: DocumentStructuralMutationRelinkInput[] = [];
    const host: DocumentStructuralMutationHost<string> = {
      documentWorkflowRuntime: (containerId) => `runtime:${containerId}`,
      mergeDocumentSummary: () => undefined,
      openDocumentStore: (input) => {
        openedScopes.push(input.containerId);
        return {
          assertCanRotateContentKey: async () => new Uint8Array(),
          ensureInitialized: async () => true,
          relink: async (relinkInput) => {
            relinkInputs.push(relinkInput);
            return {
              containerId: relinkInput.containerId,
              documentId: relinkInput.documentId,
              id: relinkInput.localId,
              title: "Recovered",
              updatedAt: "2026-07-30T00:00:00.000Z",
            };
          },
          requestSync: () => undefined,
          updateRuntime: () => undefined,
        };
      },
    };
    const linkedContainers = new Map<string, ReadonlyArray<string>>();
    const runtime: DocumentStructuralMutationRuntime = {
      apiClient: {} as DocumentStructuralMutationRuntime["apiClient"],
      auth: {
        isAuthenticated: true,
        organizationId: "org-1",
        userId: "user-1",
      },
      crypto: {
        encapsulationKeyPair: null,
        signingFingerprint: null,
        signingKeyPair: null,
      },
      infra: {
        blobStore: null as never,
        dbStatus: "ready",
        documentProjectors: defaultDocumentProjectorRegistry,
        execSql,
      },
      resolveProjectionUserKey: async () => null,
      resolveTrustedUserIdentity: async () => null,
      state: {
        containerId: null,
        domainScope: createDomainScope(),
        events: [],
        online: true,
      },
      util: { log: () => undefined },
    };
    const note: DocumentSummary = {
      containerId: null,
      documentId: "document-1",
      id: "note-1",
      title: "Recovered",
      updatedAt: "2026-07-30T00:00:00.000Z",
    };

    const moved = await moveDocumentLink({
      expandNode: () => undefined,
      host,
      note,
      runtime,
      scheduleSync: () => undefined,
      setLinkedContainerIdsForDocument: (documentId, containerIds) =>
        linkedContainers.set(documentId, containerIds),
      targetContainerId: "documents-container",
    });

    expect(openedScopes).toEqual([null]);
    expect(moved.note?.containerId).toBe("documents-container");
    expect(relinkInputs).toEqual([
      {
        accessEpoch: 7,
        containerId: "documents-container",
        documentId: "document-1",
        localId: "note-1",
      },
    ]);
    expect(linkedContainers.get("document-1")).toEqual(["documents-container"]);
    await expect(
      sqlDocumentContainerProjectionPersistence.listLinkedContainerIds(
        execSql,
        "document-1",
      ),
    ).resolves.toEqual(["documents-container"]);
    await expect(
      sqlDocumentMoveIntentPersistence.listPendingMoveIntents(execSql),
    ).resolves.toMatchObject([
      {
        documentId: "document-1",
        localId: "note-1",
        sourceContainerId: null,
        targetContainerId: "documents-container",
      },
    ]);
  } finally {
    close();
  }
});
