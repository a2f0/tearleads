import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import { createResponseFromRequest } from "../../../../test/helpers/documentFixtures";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import { ProjectionDependencyUnavailableError } from "../../../data/keyingProjectionVerification/dependencyUnavailable";
import { createContainerContentsWorkflowRuntime } from "../runtime";
import {
  CONTAINER_ALREADY_COMMITTED,
  createRemoteContainerWithMetadataDocument,
} from "./createWithMetadata";

test.each([
  "available-after-refresh",
  "still-unavailable",
  "forged-refresh",
  "integrity",
  "expired-refresh",
  "submit-error",
] as const)(
  "compound create handles %s without replaying a write",
  async (kind) => {
    const parent = await createParentProjection();
    const database = await createTestExecSql("compound-create-history-race");
    let current = true;
    let evictions = 0;
    let reads = 0;
    let submissions = 0;
    let injected = false;
    const unavailable = new ProjectionDependencyUnavailableError(
      "Public authorization cannot connect to the latest durable checkpoint",
    );
    const apiClient = createMockApiClient({
      evictContainerWriterProjection: (id) => {
        expect(id).toBe(parent.projection.containerId);
        evictions += 1;
      },
      getContainerWriterProjection: async (id) => {
        expect(id).toBe(parent.projection.containerId);
        reads += 1;
        if (kind === "expired-refresh") current = false;
        if (kind === "forged-refresh") {
          const forged = structuredClone(parent.projection);
          const head = forged.path.at(-1);
          if (!head) throw new Error("Expected parent manifest");
          head.manifestHash = "f".repeat(64);
          return forged;
        }
        return parent.projection;
      },
      createContainerWithMetadataDocument: async (request) => {
        submissions += 1;
        if (kind === "submit-error") throw unavailable;
        return {
          container: await createMutationResponseFromRequest(request.container),
          metadataDocument: await createResponseFromRequest(
            request.metadataDocument,
          ),
        };
      },
    });
    const resolveIdentity = createParentProjectionUserKeyResolver(parent);
    const runtime = createContainerContentsWorkflowRuntime({
      apiClient,
      auth: {
        isAuthenticated: true,
        organizationId: parent.projection.organizationId,
        userId: parent.userId,
      },
      crypto: {
        encapsulationKeyPair: {
          publicKey: parent.encapsulationPublicKey,
          secretKey: parent.secretKey,
        },
        signingFingerprint: parent.author.signerKeyFingerprint,
        signingKeyPair: {
          signingPrivateKey: parent.author.signerPrivateKey,
          signingPublicKey: parent.signingPublicKey,
        },
      },
      infra: {
        blobStore: createMemoryBlobStore(),
        dbStatus: "ready",
        documentProjectors: defaultDocumentProjectorRegistry,
        execSql: database.execSql,
      },
      resolveTrustedUserIdentity: resolveIdentity,
      state: {
        containerId: parent.projection.containerId,
        domainScope: createDomainScope(),
        events: [],
        online: true,
      },
      util: { log: () => {}, reportSecurityIncident: async () => {} },
    });
    try {
      const result = createRemoteContainerWithMetadataDocument({
        containerId: "history-race-child",
        parentContainerId: parent.projection.containerId,
        parentProjection: parent.projection,
        resolveProjectionUserKey: async (id) => {
          if (
            kind !== "submit-error" &&
            (!injected || kind === "still-unavailable")
          ) {
            injected = true;
            if (kind === "integrity")
              throw new KeyingVerificationError(
                "equivocation",
                "Conflicting head",
              );
            throw unavailable;
          }
          return resolveIdentity(id);
        },
        runtime,
        stillCurrent: () => current,
      });
      if (kind === "available-after-refresh") {
        const created = await result;
        expect(created).not.toBe(CONTAINER_ALREADY_COMMITTED);
        if (created === CONTAINER_ALREADY_COMMITTED)
          throw new Error("Expected new create");
        expect(created?.containerId).toBe("history-race-child");
      } else if (kind === "expired-refresh") {
        expect(await result).toBeNull();
      } else if (kind === "forged-refresh") {
        await expect(result).rejects.toBeInstanceOf(KeyingVerificationError);
      } else if (kind === "integrity") {
        await expect(result).rejects.toMatchObject({ code: "equivocation" });
      } else {
        await expect(result).rejects.toBe(unavailable);
      }
      const refreshes = kind === "integrity" || kind === "submit-error" ? 0 : 1;
      expect(reads).toBe(refreshes);
      expect(evictions).toBe(refreshes);
      expect(submissions).toBe(
        kind === "available-after-refresh" || kind === "submit-error" ? 1 : 0,
      );
      expect(injected).toBe(kind !== "submit-error");
    } finally {
      database.close();
    }
  },
);
