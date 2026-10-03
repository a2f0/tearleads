import { createDomainScope } from "../../../data/domainScope";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { ContainerMoveIntentRecord } from "../containerPersistence";
import type { ContainerState } from "../remoteHydration";
import type { ContainerMoveIntentSyncState } from "./types";

/** A move-replay state whose writer projections are never served. */
export type MoveIntentError = Parameters<
  ContainerMoveIntentSyncState["persistence"]["recordMoveIntentError"]
>[1];

export function createMoveIntentSyncState(input: {
  containersById: Map<string, ContainerState>;
  incidents?: unknown[];
  onProjectionRequest?: () => void;
  persistence: ContainerMoveIntentSyncState["persistence"];
  projectionError?: unknown;
}): ContainerMoveIntentSyncState {
  const execSql: ExecSql = async () => [];
  return {
    containersById: input.containersById,
    persistence: input.persistence,
    resolveProjectionUserKey: async () => null,
    runtime: {
      apiClient: {
        getContainerWriterProjection: () => {
          input.onProjectionRequest?.();
          if (input.projectionError !== undefined) {
            throw input.projectionError;
          }
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
      infra: {
        blobStore:
          {} as ContainerMoveIntentSyncState["runtime"]["infra"]["blobStore"],
        dbStatus: "ready",
        documentProjectors:
          {} as ContainerMoveIntentSyncState["runtime"]["infra"]["documentProjectors"],
        execSql,
      },
      resolveTrustedUserIdentity: async () => null,
      state: {
        containerId: "root",
        domainScope: createDomainScope(),
        events: [],
        online: true,
      },
      util: {
        log: () => {},
        reportSecurityIncident: async (error) => {
          input.incidents?.push(error);
        },
      },
    },
  };
}

export function moveIntentRecord(
  input: Partial<ContainerMoveIntentRecord> & { containerId: string },
): ContainerMoveIntentRecord {
  return {
    createdAt: "2026-05-31T00:00:00.000Z",
    id: `intent-${input.containerId}`,
    intentType: "container.move",
    lastAttemptedAt: null,
    lastError: null,
    parentContainerId: "parent",
    previousParentContainerId: "root",
    syncStatus: "pending",
    updatedAt: "2026-05-31T00:00:00.000Z",
    ...input,
  };
}
