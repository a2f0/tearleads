import { expect, test } from "bun:test";
import {
  createMockApiClient,
  createMockRequestFailure,
  createTestExecSql,
} from "@tearleads/test-utils";
import {
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import { createResponseFromRequest } from "../../../../test/helpers/documentFixtures";
import { buildInitialGroupPolicyRequest } from "../../../../test/helpers/groupMetadata";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "../../../../test/helpers/principalPolicyFixtures";
import {
  repairPolicyPages,
  repairProtectionLease,
} from "../../../../test/helpers/principalPolicyRepair";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import { loadPrincipalPolicyCheckpoint } from "../../../data/persistence/keyingCheckpointPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { buildInitialOrganizationPolicyRequest } from "../../registration/registerIdentity";

import { createContainerContentsWorkflowRuntime } from "../runtime";
import {
  CONTAINER_ALREADY_COMMITTED,
  createRemoteContainerWithMetadataDocument,
} from "./createWithMetadata";
import { createRemoteContainer } from "./remote";

type ParentProjectionFixture = Awaited<
  ReturnType<typeof createParentProjection>
>;

function createRuntime(input: {
  apiClient: ReturnType<typeof createMockApiClient>;
  execSql: ExecSql;
  parent: ParentProjectionFixture;
}) {
  return createContainerContentsWorkflowRuntime({
    apiClient: input.apiClient,
    withPrincipalHistoryProtection: repairProtectionLease(),
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
      signingFingerprint: input.parent.author.signerKeyFingerprint,
      signingKeyPair: {
        signingPrivateKey: input.parent.author.signerPrivateKey,
        signingPublicKey: input.parent.signingPublicKey,
      },
    },
    infra: {
      blobStore: createMemoryBlobStore(),
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql: input.execSql,
    },
    resolveTrustedUserIdentity: createParentProjectionUserKeyResolver(
      input.parent,
    ),
    state: {
      containerId: input.parent.projection.containerId,
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: {
      log: () => undefined,
      reportSecurityIncident: async () => undefined,
    },
  });
}

test("compound create refuses an adapter without the result method", async () => {
  const parent = await createParentProjection();
  const database = await createTestExecSql("compound-create-legacy-receiver");
  const apiClient = createMockApiClient();
  apiClient.createContainerWithMetadataDocument = async function (request) {
    expect(this).toBe(apiClient);
    return {
      container: await createMutationResponseFromRequest(request.container),
      metadataDocument: await createResponseFromRequest(
        request.metadataDocument,
      ),
    };
  };
  Object.defineProperty(
    apiClient,
    "createContainerWithMetadataDocumentResult",
    { configurable: true, value: undefined },
  );
  const runtime = createRuntime({
    apiClient,
    execSql: database.execSql,
    parent,
  });

  try {
    await expect(
      createRemoteContainerWithMetadataDocument({
        containerId: "compound-create-legacy-receiver-child",
        parentContainerId: parent.projection.containerId,
        parentProjection: parent.projection,
        resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
        runtime,
      }),
    ).rejects.toThrow("is not a function");
  } finally {
    database.close();
  }
});

test("result-only compound create is selected and preserves its receiver", async () => {
  const parent = await createParentProjection();
  const database = await createTestExecSql("compound-create-result-receiver");
  const apiClient = createMockApiClient();
  apiClient.createContainerWithMetadataDocumentResult = async function (
    request,
  ) {
    expect(this).toBe(apiClient);
    return {
      data: {
        container: await createMutationResponseFromRequest(request.container),
        metadataDocument: await createResponseFromRequest(
          request.metadataDocument,
        ),
      },
      ok: true,
    };
  };
  Object.defineProperty(apiClient, "createContainerWithMetadataDocument", {
    configurable: true,
    value: undefined,
  });
  const runtime = createRuntime({
    apiClient,
    execSql: database.execSql,
    parent,
  });

  try {
    const created = await createRemoteContainer({
      containerId: "compound-create-result-receiver-child",
      parentContainerId: parent.projection.containerId,
      parentProjection: parent.projection,
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      runtime,
    });

    expect(created).not.toBeNull();
    expect(created).not.toBe(CONTAINER_ALREADY_COMMITTED);
  } finally {
    database.close();
  }
});

test("stale-policy repair preserves the policy API receiver", async () => {
  const parent = await createParentProjection();
  const database = await createTestExecSql("compound-create-policy-receiver");
  const creatorEncapsulationKeyPair = {
    publicKey: parent.encapsulationPublicKey,
    secretKey: parent.secretKey,
  };
  const signingKeyPair = {
    signingPrivateKey: parent.author.signerPrivateKey,
    signingPublicKey: parent.signingPublicKey,
  };
  const adminBundle = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      creatorEncapsulationKeyPair,
      groupId: "compound-create-policy-admins",
      name: "Admins",
      signerUserId: parent.userId,
      signingFingerprint: parent.author.signerKeyFingerprint,
      signingKeyPair,
    }),
  );
  const adminHead = principalPolicyHead(adminBundle);
  if (adminHead.principalType !== "group") {
    throw new Error("Expected a group policy authority");
  }
  const staleBundle = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      creatorEncapsulationKeyPair,
      externalAuthority: { ...adminHead, principalType: "group" },
      groupId: "compound-create-policy-subject",
      includeSignerAsAdmin: false,
      name: "Subject",
      signerUserId: parent.userId,
      signingFingerprint: parent.author.signerKeyFingerprint,
      signingKeyPair,
    }),
  );
  const apiClient = createMockApiClient({
    createContainerWithMetadataDocumentResult: async () => ({
      kind: "http",
      message: "stale principal policy",
      method: "POST",
      ok: false,
      path: "/containers/with-metadata-document",
      report: () => undefined,
      stalePrincipalHeads: [principalPolicyHead(staleBundle)],
      status: 409,
      statusText: "Conflict",
    }),
  });
  let policyReceiver: unknown;
  apiClient.getPrincipalPolicyPages = async function* () {
    policyReceiver = this;
    yield createMockRequestFailure({ message: "Missing page", status: 404 });
  };
  const runtime = createRuntime({
    apiClient,
    execSql: database.execSql,
    parent,
  });

  try {
    await expect(
      createRemoteContainerWithMetadataDocument({
        containerId: "compound-create-policy-receiver-child",
        parentContainerId: parent.projection.containerId,
        parentProjection: parent.projection,
        resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
        runtime,
      }),
    ).rejects.toMatchObject({ name: "ProjectionDependencyUnavailableError" });
    expect(policyReceiver).toBe(apiClient);
  } finally {
    database.close();
  }
});

test("compound create consumes successive policy pages and stops a repeated page", async () => {
  const parent = await createParentProjection();
  const database = await createTestExecSql("compound-create-policy-pages");
  try {
    const signingKeyPair = {
      signingPrivateKey: parent.author.signerPrivateKey,
      signingPublicKey: parent.signingPublicKey,
    };
    const bundles = await Promise.all(
      ["policy-a", "policy-b"].map(async (groupId) =>
        policyBundleFromInitialRequest(
          await buildInitialGroupPolicyRequest({
            creatorEncapsulationKeyPair: {
              publicKey: parent.encapsulationPublicKey,
              secretKey: parent.secretKey,
            },
            groupId,
            name: groupId,
            signerUserId: parent.userId,
            signingFingerprint: parent.author.signerKeyFingerprint,
            signingKeyPair,
          }),
        ),
      ),
    );
    const directory = await organizationPolicyBundleFromInitialRequest(
      parent.projection.organizationId,
      await buildInitialOrganizationPolicyRequest({
        adminGroupId: "policy-a",
        memberGroupId: "policy-b",
        organizationId: parent.projection.organizationId,
        encapsulationPublicKey: parent.encapsulationPublicKey,
        groupHeads: bundles.map((bundle) => principalPolicyHead(bundle)),
        signingKeyPair,
        userId: parent.userId,
      }),
    );
    let calls = 0;
    let refreshes = 0;
    const apiClient = createMockApiClient({
      getPrincipalPolicyPages: repairPolicyPages([directory, ...bundles]),
      getContainerWriterProjection: async () => {
        refreshes++;
        return parent.projection;
      },
      getCurrentPrincipalPolicy: async () => {
        throw new Error("Full policy reads are forbidden");
      },
      createContainerWithMetadataDocumentResult: async () => {
        const page = bundles.slice(calls++ === 0 ? 0 : 1, calls === 1 ? 1 : 2);
        return {
          kind: "http",
          ok: false,
          method: "POST",
          path: "/containers/with-metadata-document",
          message: "stale principal policy",
          status: 409,
          statusText: "Conflict",
          report: () => {},
          stalePrincipalHeads: page.map((bundle) =>
            principalPolicyHead(bundle),
          ),
        };
      },
    });
    const result = await createRemoteContainerWithMetadataDocument({
      containerId: "compound-policy-pages-child",
      parentContainerId: parent.projection.containerId,
      parentProjection: parent.projection,
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      runtime: createRuntime({ apiClient, execSql: database.execSql, parent }),
    });
    expect(result).toBeNull();
    expect(calls).toBe(3);
    expect(refreshes).toBe(2);
    expect(
      await loadPrincipalPolicyCheckpoint(
        database.execSql,
        "group",
        "policy-b",
      ),
    ).toBeNull();
  } finally {
    database.close();
  }
});
