import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import type { ContainerState } from "../remoteHydration";
import { createContainerContentsWorkflowRuntime } from "../runtime";
import { prepareContainerStateGroupRewrap } from "./share";

function createContainerState(
  parent: Awaited<ReturnType<typeof createParentProjection>>,
): ContainerState {
  return {
    container: {
      effectiveAccessLevel: "admin",
      id: parent.projection.containerId,
      metadataDocumentId: "parent-container-metadata-document",
      organizationId: parent.projection.organizationId,
      parentId: null,
    },
    containerWriterProjection: parent.projection,
    record: {
      accessStateHash: parent.projection.path.at(-1)?.manifestHash ?? null,
    },
  } as ContainerState;
}

async function prepareCandidate(input: {
  parent: Awaited<ReturnType<typeof createParentProjection>>;
  testLabel: string;
}) {
  const { close, execSql } = await createTestExecSql(input.testLabel);
  const resolveProjectionUserKey = createParentProjectionUserKeyResolver(
    input.parent,
  );
  const runtime = createContainerContentsWorkflowRuntime({
    apiClient: createMockApiClient(),
    auth: {
      isAuthenticated: true,
      organizationId: input.parent.projection.organizationId,
      userId: input.parent.userId,
    },
    crypto: {
      encapsulationKeyPair: {
        publicKey: input.parent.encapsulationPublicKey,
        secretKey: input.parent.secretKey,
      },
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore: createMemoryBlobStore(),
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
    },
    resolveTrustedUserIdentity: resolveProjectionUserKey,
    state: {
      containerId: null,
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: {
      log: () => undefined,
      reportSecurityIncident: async () => undefined,
    },
  });

  try {
    return await prepareContainerStateGroupRewrap({
      accessLevel: "admin",
      containerState: createContainerState(input.parent),
      groupId: "forged-read-model-admins-id",
      requireExistingGrant: true,
      resolveProjectionUserKey,
      runtime,
    });
  } finally {
    close();
  }
}

test("a signed root without the candidate group yields not-granted", async () => {
  const parent = await createParentProjection();

  await expect(
    prepareCandidate({
      parent,
      testLabel: "group-rewrap-signed-unrelated-candidate",
    }),
  ).resolves.toEqual({ status: "not-granted" });
});

test("a forged direct admin grant cannot make a substituted group applicable", async () => {
  const parent = await createParentProjection();
  const target = parent.projection.path.at(-1);
  if (!target || typeof target.state !== "object" || target.state === null) {
    throw new Error("Expected root access manifest state");
  }
  Reflect.set(target.state, "directGrants", [
    {
      accessLevel: "admin",
      subjectId: "forged-read-model-admins-id",
      subjectType: "group",
    },
  ]);

  await expect(
    prepareCandidate({
      parent,
      testLabel: "group-rewrap-forged-admin-grant",
    }),
  ).rejects.toThrow();
});
