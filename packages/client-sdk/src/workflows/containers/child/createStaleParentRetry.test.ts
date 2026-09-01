import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import type { ContainerMutationRequest } from "@symcrypt/validators/request";
import {
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import { loadAccessManifestCheckpoint } from "../../../data/persistence/keyingCheckpointPersistence";
import { createRemoteContainer } from "./create";

const STALE_PARENT_FAILURE =
  "POST /containers: 409 Conflict: parentContainerPath[0] manifest head is stale";

test("createRemoteContainer replans once after the parent head advances", async () => {
  const parent = await createParentProjection();
  const requests: ContainerMutationRequest[] = [];
  let evictions = 0;
  let projectionReads = 0;
  let reported = false;
  const { close, execSql } = await createTestExecSql(
    "container-create-stale-parent-retry",
  );

  try {
    const created = await createRemoteContainer({
      apiClient: {
        createContainer: async () => null,
        createContainerResult: async (request) => {
          requests.push(request);
          if (requests.length === 1) {
            return {
              message: STALE_PARENT_FAILURE,
              ok: false as const,
              report: () => {
                reported = true;
              },
              status: 409,
            };
          }
          return {
            data: await createMutationResponseFromRequest(request),
            ok: true as const,
          };
        },
        evictContainerWriterProjection: (containerId) => {
          expect(containerId).toBe(parent.projection.containerId);
          evictions += 1;
        },
        getContainerWriterProjection: async (containerId) => {
          expect(containerId).toBe(parent.projection.containerId);
          projectionReads += 1;
          return parent.projection;
        },
        getCurrentPrincipalPolicy: async () => null,
      },
      author: parent.author,
      execSql,
      parentContainerId: parent.projection.containerId,
      parentSecretKey: parent.secretKey,
      reportSecurityIncident: async () => undefined,
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      resolveTrustedUserIdentity: createParentProjectionUserKeyResolver(parent),
    });

    expect(created).not.toBeNull();
    expect(requests).toHaveLength(2);
    expect(
      requests.map((request) => Reflect.get(request.event, "objectId")),
    ).toEqual([created?.containerId, created?.containerId]);
    expect(
      requests.map((request) => Reflect.get(request.event, "eventId")),
    ).toEqual([
      Reflect.get(requests[0]?.event ?? {}, "eventId"),
      Reflect.get(requests[0]?.event ?? {}, "eventId"),
    ]);
    expect(
      requests.map((request) => Reflect.get(request.event, "signedAt")),
    ).toEqual([
      Reflect.get(requests[0]?.event ?? {}, "signedAt"),
      Reflect.get(requests[0]?.event ?? {}, "signedAt"),
    ]);
    expect(
      requests.map((request) =>
        typeof request.body === "object" && request.body !== null
          ? Reflect.get(request.body, "metadataDocumentId")
          : undefined,
      ),
    ).toEqual([created?.metadataDocumentId, created?.metadataDocumentId]);
    expect(
      requests.map((request) => Reflect.get(request.keyEpoch, "id")),
    ).toEqual([
      Reflect.get(requests[0]?.keyEpoch ?? {}, "id"),
      Reflect.get(requests[0]?.keyEpoch ?? {}, "id"),
    ]);
    expect(projectionReads).toBe(2);
    expect(evictions).toBe(1);
    expect(reported).toBe(false);
  } finally {
    close();
  }
});

test("createRemoteContainer discards a response after generation expiry", async () => {
  const parent = await createParentProjection();
  const { close, execSql } = await createTestExecSql(
    "container-create-submit-generation",
  );
  let current = true;

  try {
    const created = await createRemoteContainer({
      apiClient: {
        createContainer: async (request) => {
          const response = await createMutationResponseFromRequest(request);
          current = false;
          return response;
        },
        getContainerWriterProjection: async () => parent.projection,
        getCurrentPrincipalPolicy: async () => null,
      },
      author: parent.author,
      containerId: "expired-created-container",
      execSql,
      parentContainerId: parent.projection.containerId,
      parentSecretKey: parent.secretKey,
      reportSecurityIncident: async () => undefined,
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      resolveTrustedUserIdentity: createParentProjectionUserKeyResolver(parent),
      stillCurrent: () => current,
    });

    expect(created).toBeNull();
    await expect(
      loadAccessManifestCheckpoint(
        execSql,
        "container",
        parent.projection.organizationId,
        "expired-created-container",
      ),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("createRemoteContainer does not retry an unrelated conflict", async () => {
  const parent = await createParentProjection();
  let evictions = 0;
  let submissions = 0;
  let reported = false;
  const { close, execSql } = await createTestExecSql(
    "container-create-unrelated-conflict",
  );

  try {
    const created = await createRemoteContainer({
      apiClient: {
        createContainer: async () => null,
        createContainerResult: async () => {
          submissions += 1;
          return {
            message: "POST /containers: 409 Conflict: unrelated conflict",
            ok: false as const,
            report: () => {
              reported = true;
            },
            status: 409,
          };
        },
        evictContainerWriterProjection: () => {
          evictions += 1;
        },
        getContainerWriterProjection: async () => parent.projection,
        getCurrentPrincipalPolicy: async () => null,
      },
      author: parent.author,
      execSql,
      parentContainerId: parent.projection.containerId,
      parentSecretKey: parent.secretKey,
      reportSecurityIncident: async () => undefined,
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      resolveTrustedUserIdentity: createParentProjectionUserKeyResolver(parent),
    });

    expect(created).toBeNull();
    expect(submissions).toBe(1);
    expect(evictions).toBe(0);
    expect(reported).toBe(true);
  } finally {
    close();
  }
});
