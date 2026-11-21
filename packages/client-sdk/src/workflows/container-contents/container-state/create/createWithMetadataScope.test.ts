import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../../test/helpers/data/containerFixtures";
import { createContainerContentsWorkflowRuntime } from "../../../../../test/helpers/workflows/containerContentsWorkflowRuntime";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../../test/helpers/workflows/expiringApiServer";
import { repairProtectionLease } from "../../../../../test/helpers/workflows/principalPolicyRepair";
import { createMemoryBlobStore } from "../../../../data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../../../../data/documents/documentKinds";
import { createDomainScope } from "../../../../data/shared/domainScope";
import type { ExecSql } from "../../../../data/sqlite/sqlSchema";
import { createRemoteContainerWithMetadataDocument } from "./createWithMetadata";

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

// The signed folder POST under ensureContactsContainer's system-folder create.
test.each(SCOPE_RETIREMENTS)(
  "a folder create POST that expires after %s is not renewed or replayed",
  async (change) => {
    const parent = await createParentProjection();
    const database = await createTestExecSql(`contacts-post-scope-${change}`);
    const server = createExpiringApiServer({
      method: "POST",
      path: /^\/containers\/with-metadata-document$/,
    });
    const runtime = createRuntime({
      apiClient: createMockApiClient({
        createContainerWithMetadataDocumentResult:
          server.api.createContainerWithMetadataDocumentResult,
      }),
      execSql: database.execSql,
      parent,
    });
    let current = true;
    try {
      const created = createRemoteContainerWithMetadataDocument({
        containerId: `contacts-folder-${change.replaceAll(" ", "-")}`,
        parentContainerId: parent.projection.containerId,
        parentProjection: parent.projection,
        resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
        runtime,
        stillCurrent: () => current,
      });
      await server.entered;
      current = false;
      server.retire(change);
      server.release();
      expect(await created).toBeNull();
      expect(server.requests).toEqual([
        "POST /containers/with-metadata-document",
      ]);
      expect(server.renewals.count).toBe(0);
    } finally {
      server.stop();
      database.close();
    }
  },
);
