import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createDomainScope } from "../../../data/domainScope";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  type ContainerCreateIntentRecord,
  defaultContainerContentsPersistence,
} from "../containerPersistence";
import type { ContainerState } from "../remoteHydration";
import { syncPendingContainerCreateIntents } from "./createIntentSync";
import type { ContainerCreateIntentSyncState } from "./types";

function containerState(input: {
  id: string;
  parentId: string | null;
  synced: boolean;
}): ContainerState {
  return {
    container: {
      effectiveAccessLevel: "admin",
      icon: null,
      id: input.id,
      metadataDocumentId: input.synced ? `metadata-${input.id}` : "",
      name: input.id,
      organizationId: "organization",
      parentId: input.parentId,
      systemSlot: null,
    },
    doc: {} as ContainerState["doc"],
    record: {
      accessEpoch: 1,
      accessStateHash: input.synced ? `access-${input.id}` : "",
      documentId: input.synced ? `metadata-${input.id}` : "",
      id: `record-${input.id}`,
      loroSnapshot: "",
    },
  };
}

test("container create sync propagates identity failures without recording a retry", async () => {
  const integrityError = new KeyingVerificationError(
    "equivocation",
    "trusted identity changed",
  );
  const execSql: ExecSql = async () => [];
  const intent: ContainerCreateIntentRecord = {
    containerId: "child",
    createdAt: "2026-07-15T00:00:00.000Z",
    id: "create-child",
    intentType: "container.create",
    lastError: null,
    parentContainerId: "parent",
    remoteContainerId: null,
    remoteMetadataAccessStateHash: null,
    remoteMetadataDocumentId: null,
    syncStatus: "pending",
    updatedAt: "2026-07-15T00:00:00.000Z",
  };
  const recordedErrors: string[] = [];
  let projectionRequests = 0;
  const persistence: ContainerCreateIntentSyncState["persistence"] = {
    ...defaultContainerContentsPersistence,
    listPendingCreateIntents: async () => [intent],
    recordCreateIntentError: async (_execSql, _containerId, message) => {
      recordedErrors.push(message);
    },
  };
  const state: ContainerCreateIntentSyncState = {
    containersById: new Map([
      [
        "child",
        containerState({ id: "child", parentId: "parent", synced: false }),
      ],
      [
        "parent",
        containerState({ id: "parent", parentId: "root", synced: true }),
      ],
    ]),
    persistence,
    resolveProjectionUserKey: async () => null,
    runtime: {
      apiClient: {
        getContainerWriterProjection: async () => {
          projectionRequests += 1;
          throw integrityError;
        },
      } as unknown as ContainerCreateIntentSyncState["runtime"]["apiClient"],
      auth: {
        isAuthenticated: true,
        organizationId: "organization",
        userId: "user",
      },
      crypto: {
        encapsulationKeyPair: {
          secretKey: new Uint8Array(32),
        } as ContainerCreateIntentSyncState["runtime"]["crypto"]["encapsulationKeyPair"],
        signingFingerprint: "signing-fingerprint",
        signingKeyPair: {
          signingPrivateKey: new Uint8Array(32),
        } as ContainerCreateIntentSyncState["runtime"]["crypto"]["signingKeyPair"],
      },
      infra: {
        blobStore:
          {} as ContainerCreateIntentSyncState["runtime"]["infra"]["blobStore"],
        dbStatus: "ready",
        documentProjectors:
          {} as ContainerCreateIntentSyncState["runtime"]["infra"]["documentProjectors"],
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
      },
    },
  };

  await expect(
    syncPendingContainerCreateIntents({
      host: {
        persistContainerState: async () => {
          throw new Error("unexpected persist");
        },
      },
      isRemoteSyncBlocked: () => false,
      state,
    }),
  ).rejects.toBe(integrityError);
  expect(projectionRequests).toBe(1);
  expect(recordedErrors).toEqual([]);
});
