import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import { createAuthor } from "../../../../test/helpers/containerFixtures";
import { createShareTestRuntime } from "../../../../test/helpers/groupShareScenario";
import { createInitializedContainerMetadataDocument } from "../../../data/containers/containerMetadataDocument";
import { defaultContainerContentsPersistence } from "../containerPersistence";
import type { ContainerState } from "../remoteHydration";
import { invalidateContainerProjections } from "./projectionCache";
import { shareContainerState } from "./share";
import { withDirectUserGrant } from "./share.testFixtures";

for (const hintDuringShare of [true, false]) {
  test(`a share ${hintDuringShare ? "straddling a hint does not cache" : "left undisturbed caches"} its projection`, async () => {
    const { close, execSql } = await createTestExecSql(
      `containerContents-share-projection-${hintDuringShare ? "hint" : "steady"}`,
    );
    try {
      const { author } = await createAuthor({
        organizationId: "organization-1",
        userId: "owner-user",
      });
      const keyPair = generateKemSeedAndKeyPair();
      const containerId = `containerContents-share-projection-${hintDuringShare ? "hint" : "steady"}`;
      const recipientUserId = "recipient-user";
      const projection = await createContainerWriterProjectionFixture({
        containerId,
        encapsulationPublicKey: keyPair.publicKey,
        organizationId: author.organizationId,
        signerKeyFingerprint: author.signerKeyFingerprint,
        signerPrivateKey: author.signerPrivateKey,
        userId: author.signerUserId,
      });
      const remoteProjection = withDirectUserGrant({
        accessLevel: "write",
        createdAt: "2026-05-22T12:00:00.000Z",
        projection,
        referencedPrincipalHeads: [],
        remoteAccessStateHash: "remote-access-state-hash-2",
        remoteEpoch: 2,
        updatedAt: "2026-05-22T12:30:00.000Z",
        userId: recipientUserId,
      });
      await defaultContainerContentsPersistence.ensureSchema(execSql);
      const { doc, initialUpdate } =
        await createInitializedContainerMetadataDocument(containerId, {
          icon: null,
          name: "Docs",
        });
      const containerState: ContainerState = {
        container: {
          id: containerId,
          effectiveAccessLevel: "admin",
          organizationId: author.organizationId,
          parentId: null,
          metadataDocumentId: "stale-metadata-document",
          name: "Docs",
          icon: null,
        },
        doc,
        record: {
          accessEpoch: 1,
          accessStateHash: "stale-access-state-hash",
          contentKeyBundle: "stale-content-key-bundle",
          documentId: "stale-metadata-document",
          documentKekTargets: "stale-document-kek-targets",
          documentManifestBundle: "stale-document-manifest-bundle",
          id: containerId,
          lastCommitLsn: null,
          metadataUpdates: bytesToBase64(initialUpdate),
          snapshotEndVersion: "",
        },
      };
      await defaultContainerContentsPersistence.saveContainer(
        execSql,
        containerState.container,
        containerState.record,
      );
      const runtime = createShareTestRuntime({
        apiClient: createMockApiClient({
          getContainerWriterProjection: async () => {
            // The share flow has begun; a peer's grant hint for this
            // container lands while its projection load is in flight.
            if (hintDuringShare) invalidateContainerProjections(containerState);
            return remoteProjection;
          },
          getCurrentPrincipalPolicy: async () => null,
          shareContainer: async () => null,
        }),
        author,
        execSql,
        logs: [],
      });

      const shared = await shareContainerState({
        accessLevel: "write",
        containerState,
        persistence: defaultContainerContentsPersistence,
        recipientUserId,
        resolveProjectionUserKey: async () => null,
        runtime,
      });
      expect(shared?.status).toBe("persisted");
      if (hintDuringShare) {
        // The projection the flow used predates the hint: not cached, so the
        // next write fetches a fresh one.
        expect(containerState.containerWriterProjection ?? null).toBeNull();
      } else {
        expect(containerState.containerWriterProjection).toBe(remoteProjection);
      }
    } finally {
      close();
    }
  });
}
