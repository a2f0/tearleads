import { expect, test } from "bun:test";
import { createDomainScope } from "../../../data/domainScope";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  type ContainerMoveIntentRecord,
  defaultContainerContentsPersistence,
} from "../containerPersistence";
import type { ContainerState } from "../remoteHydration";
import { syncPendingContainerMoveIntents } from "./moveIntentSync";
import type { ContainerMoveIntentSyncState } from "./types";

type MoveIntentError = Parameters<
  ContainerMoveIntentSyncState["persistence"]["recordMoveIntentError"]
>[1];

function remoteContainerState(input: {
  id: string;
  parentId: string | null;
}): ContainerState {
  return {
    container: {
      id: input.id,
      effectiveAccessLevel: "admin",
      icon: null,
      metadataDocumentId: `metadata-${input.id}`,
      name: input.id,
      organizationId: "organization",
      parentId: input.parentId,
      systemSlot: null,
    },
    doc: {} as ContainerState["doc"],
    record: {
      accessStateHash: `access-${input.id}`,
      accessEpoch: 1,
      documentId: `metadata-${input.id}`,
      id: `record-${input.id}`,
      loroSnapshot: "",
    },
  };
}

test("pending container move sync records per-intent failures and continues", async () => {
  const errors: MoveIntentError[] = [];
  const execSql: ExecSql = async () => [];
  const parentState = remoteContainerState({
    id: "parent",
    parentId: "root",
  });
  const containersById = new Map([
    [
      "child-a",
      remoteContainerState({
        id: "child-a",
        parentId: "root",
      }),
    ],
    [
      "child-b",
      remoteContainerState({
        id: "child-b",
        parentId: "root",
      }),
    ],
    ["parent", parentState],
  ]);
  const pendingIntents: ContainerMoveIntentRecord[] = [
    {
      containerId: "child-a",
      createdAt: "2026-05-31T00:00:00.000Z",
      id: "intent-a",
      intentType: "container.move",
      lastAttemptedAt: null,
      lastError: null,
      parentContainerId: "parent",
      previousParentContainerId: "root",
      syncStatus: "pending",
      updatedAt: "2026-05-31T00:00:00.000Z",
    },
    {
      containerId: "child-b",
      createdAt: "2026-05-31T00:00:00.000Z",
      id: "intent-b",
      intentType: "container.move",
      lastAttemptedAt: null,
      lastError: null,
      parentContainerId: "parent",
      previousParentContainerId: "root",
      syncStatus: "pending",
      updatedAt: "2026-05-31T00:00:00.000Z",
    },
  ];
  const persistence: ContainerMoveIntentSyncState["persistence"] = {
    ...defaultContainerContentsPersistence,
    listPendingMoveIntents: async () => pendingIntents,
    recordMoveIntentError: async (_execSql, error) => {
      errors.push(error);
    },
  };

  const movedCount = await syncPendingContainerMoveIntents({
    host: {
      persistContainerState: async () => {
        throw new Error("unexpected persist");
      },
      updateSnapshot: () => {},
    },
    state: {
      containersById,
      persistence,
      resolveProjectionUserKey: async () => null,
      runtime: {
        apiClient: {
          getContainerWriterProjection: () => {
            throw new Error("projection unavailable");
          },
        } as unknown as ContainerMoveIntentSyncState["runtime"]["apiClient"],
        auth: {
          isAuthenticated: true,
          organizationId: "organization",
          userId: "user",
        },
        crypto: {
          encapsulationKeyPair: {
            secretKey: new Uint8Array(32),
          } as ContainerMoveIntentSyncState["runtime"]["crypto"]["encapsulationKeyPair"],
          signingFingerprint: "signing-fingerprint",
          signingKeyPair: {
            signingPrivateKey: new Uint8Array(32),
          } as ContainerMoveIntentSyncState["runtime"]["crypto"]["signingKeyPair"],
        },
        getEncapsulationKey: async () => null,
        infra: {
          blobStore:
            {} as ContainerMoveIntentSyncState["runtime"]["infra"]["blobStore"],
          dbStatus: "ready",
          documentProjectors:
            {} as ContainerMoveIntentSyncState["runtime"]["infra"]["documentProjectors"],
          execSql,
        },
        state: {
          containerId: "root",
          domainScope: createDomainScope(),
          events: [],
          online: true,
        },
        util: {
          cacheReferencedPrincipalPolicies: async () => {},
          log: () => {},
        },
      },
    },
  });

  expect(movedCount).toBe(0);
  expect(errors.map((error) => error.containerId)).toEqual([
    "child-a",
    "child-b",
  ]);
  expect(errors.map((error) => error.message)).toEqual([
    "Failed to sync container move: projection unavailable",
    "Failed to sync container move: projection unavailable",
  ]);
});
