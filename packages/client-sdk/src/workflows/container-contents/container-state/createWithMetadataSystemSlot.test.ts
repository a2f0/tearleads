import { expect, test } from "bun:test";
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
import { loadAccessManifestCheckpoint } from "../../../data/persistence/keyingCheckpointPersistence";
import { createContainerContentsWorkflowRuntime } from "../runtime";
import {
  CONTAINER_ALREADY_COMMITTED,
  createRemoteContainerWithMetadataDocument,
} from "./createWithMetadata";

const SIGNED_SLOT = `sys_v1_${"s".repeat(43)}`;
const FOREIGN_SLOT = `sys_v1_${"t".repeat(43)}`;

/**
 * The create acknowledgement must persist the slot this client signed, never
 * the server's echo: a dishonest column would otherwise make a plain folder the
 * local Trash candidate until the next hydration pass.
 */
for (const signedSlot of [null, SIGNED_SLOT]) {
  test(`a create response echoing a foreign system slot is refused (${signedSlot === null ? "plain" : "system"} create)`, async () => {
    const parent = await createParentProjection();
    const containerId = `container-foreign-slot-${signedSlot === null ? "plain" : "system"}`;
    const { close, execSql } = await createTestExecSql(
      `container-with-metadata-foreign-slot-${signedSlot === null ? "plain" : "system"}`,
    );
    let echoedSlot: string | null | undefined = FOREIGN_SLOT;
    const apiClient = createMockApiClient({
      createContainerWithMetadataDocument: async (request) => {
        const container = await createMutationResponseFromRequest(
          request.container,
        );
        return {
          container:
            echoedSlot === undefined
              ? container
              : { ...container, systemSlot: echoedSlot },
          metadataDocument: await createResponseFromRequest(
            request.metadataDocument,
          ),
        };
      },
    });
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
        execSql,
      },
      resolveTrustedUserIdentity: async () => null,
      state: {
        containerId: parent.projection.containerId,
        domainScope: createDomainScope(),
        events: [],
        online: true,
      },
      util: {
        log: () => undefined,
        reportSecurityIncident: async () => undefined,
      },
    });
    const create = () =>
      createRemoteContainerWithMetadataDocument({
        containerId,
        parentContainerId: parent.projection.containerId,
        parentProjection: parent.projection,
        resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
        runtime,
        systemSlot: signedSlot,
      });

    try {
      await expect(create()).rejects.toThrow(
        "Container mutation response system slot mismatch",
      );
      // Dropping the slot from a system create is the same substitution.
      if (signedSlot !== null) {
        echoedSlot = null;
        await expect(create()).rejects.toThrow(
          "Container mutation response system slot mismatch",
        );
      }
      // Nothing was acknowledged, so no local record can carry the foreign slot.
      await expect(
        loadAccessManifestCheckpoint(
          execSql,
          "container",
          parent.projection.organizationId,
          containerId,
        ),
      ).resolves.toBeNull();

      // An honest echo persists exactly the slot the client signed.
      echoedSlot = undefined;
      const created = await create();
      if (!created || created === CONTAINER_ALREADY_COMMITTED) {
        throw new Error("Expected the honest create to settle");
      }
      expect(created.systemSlot).toBe(signedSlot);
    } finally {
      close();
    }
  });
}
