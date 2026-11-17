import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import { CONTAINER_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import {
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../../test/helpers/data/containerFixtures";
import { createContainerMutationServiceFixture } from "../../../../../test/helpers/workflows/containerMutationServiceFixture";
import { KeyingCheckpointRepository } from "../../../../data/persistence/keyingCheckpoints/keyingCheckpointRepository";

const STALE_PARENT_FAILURE =
  "POST /containers: 409 Conflict: parentContainerPathRefs[0] manifest head is stale";

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
    const created = await createContainerMutationServiceFixture({
      api: createMockApiClient({
        createContainer: async () => null,
        createContainerResult: async (request) => {
          requests.push(request);
          if (requests.length === 1) {
            return {
              kind: "http",
              method: "POST",
              path: "/containers",
              statusText: "Conflict",
              code: CONTAINER_MUTATION_ERROR_CODES.stateStale,
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
      }),
      execSql,
      encapsulationSecretKey: parent.secretKey,
      reportSecurityIncident: async () => undefined,
      resolveTrustedUserIdentity: createParentProjectionUserKeyResolver(parent),
    }).createRemoteContainer({
      author: parent.author,
      parentContainerId: parent.projection.containerId,
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
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

test("createRemoteContainer hides an unacknowledged committed response", async () => {
  const parent = await createParentProjection();
  const { close, execSql } = await createTestExecSql(
    "container-create-submit-generation",
  );
  let current = true;

  try {
    const created = await createContainerMutationServiceFixture({
      api: createMockApiClient({
        createContainer: async (request) => {
          const response = await createMutationResponseFromRequest(request);
          current = false;
          return response;
        },
        getContainerWriterProjection: async () => parent.projection,
        getCurrentPrincipalPolicy: async () => null,
      }),
      execSql,
      encapsulationSecretKey: parent.secretKey,
      reportSecurityIncident: async () => undefined,
      resolveTrustedUserIdentity: createParentProjectionUserKeyResolver(parent),
    }).createRemoteContainer({
      author: parent.author,
      containerId: "expired-created-container",
      parentContainerId: parent.projection.containerId,
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      stillCurrent: () => current,
    });

    expect(created).toBeNull();
    await expect(
      new KeyingCheckpointRepository(execSql).loadAccessManifestCheckpoint(
        "container",
        parent.projection.organizationId,
        "expired-created-container",
      ),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("createRemoteContainer does not retry or report after stale-parent refresh expiry", async () => {
  const parent = await createParentProjection();
  const { close, execSql } = await createTestExecSql(
    "container-create-stale-parent-generation",
  );
  let current = true;
  let evictions = 0;
  let projectionReads = 0;
  let reported = false;
  let submissions = 0;

  try {
    const created = await createContainerMutationServiceFixture({
      api: createMockApiClient({
        createContainer: async () => null,
        createContainerResult: async () => {
          submissions += 1;
          return {
            kind: "http",
            method: "POST",
            path: "/containers",
            statusText: "Conflict",
            code: CONTAINER_MUTATION_ERROR_CODES.stateStale,
            message: STALE_PARENT_FAILURE,
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
        getContainerWriterProjection: async () => {
          projectionReads += 1;
          if (projectionReads === 2) current = false;
          return parent.projection;
        },
        getCurrentPrincipalPolicy: async () => null,
      }),
      execSql,
      encapsulationSecretKey: parent.secretKey,
      reportSecurityIncident: async () => undefined,
      resolveTrustedUserIdentity: createParentProjectionUserKeyResolver(parent),
    }).createRemoteContainer({
      author: parent.author,
      parentContainerId: parent.projection.containerId,
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      stillCurrent: () => current,
    });

    expect(created).toBeNull();
    expect(submissions).toBe(1);
    expect(evictions).toBe(1);
    expect(projectionReads).toBe(2);
    expect(reported).toBe(false);
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
    const created = await createContainerMutationServiceFixture({
      api: createMockApiClient({
        createContainer: async () => null,
        createContainerResult: async () => {
          submissions += 1;
          return {
            kind: "http",
            method: "POST",
            path: "/containers",
            statusText: "Conflict",
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
      }),
      execSql,
      encapsulationSecretKey: parent.secretKey,
      reportSecurityIncident: async () => undefined,
      resolveTrustedUserIdentity: createParentProjectionUserKeyResolver(parent),
    }).createRemoteContainer({
      author: parent.author,
      parentContainerId: parent.projection.containerId,
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
    });

    expect(created).toBeNull();
    expect(submissions).toBe(1);
    expect(evictions).toBe(0);
    expect(reported).toBe(true);
  } finally {
    close();
  }
});
