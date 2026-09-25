import { expect, test } from "bun:test";
import {
  computeDocumentContentKeyTargetHash,
  decryptWithDek,
  normalizeDocumentAccessEventBody,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { createMockApiClient } from "@tearleads/test-utils";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createBlobBytesResponse,
  createFixtureBinding,
} from "../../../test/helpers/blobHydrationFixture";
import { createLinkSetResponseFromRequest } from "../../../test/helpers/documentFixtures";
import { createRelinkScopeFixture } from "../../../test/helpers/linkSetBlobRewrapScope";
import {
  deriveDocumentTargetFromProjection,
  unwrapContainerKekPath,
} from "../../data/documents/shared/projection";
import { readCanonicalJson } from "../../data/keyingCanonicalJson";
import { relinkRemoteDocument } from "./linkSetRemote";

for (const steer of [false, true]) {
  test(
    steer
      ? "relink refuses a fresh blob wrap steered to an omitted container's retired epoch"
      : "relink preserves authenticated envelopes for an omitted linked container",
    async () => {
      const fixture = await createRelinkScopeFixture();
      try {
        const retiredTarget = deriveDocumentTargetFromProjection(
          fixture.retired,
        );
        const binding = createFixtureBinding(fixture);
        expect(
          binding.contentKeyBundle.targets.some(
            (target) =>
              target.containerKeyEpochId === retiredTarget.containerKeyEpochId,
          ),
        ).toBe(false);
        const paths = fixture.writerProjection.authorizingContainerPaths.filter(
          (path) => path.containerId !== retiredTarget.containerId,
        );
        const targets = fixture.writerProjection.contentKeyBundle.targets.map(
          (target) =>
            steer && target.containerId === retiredTarget.containerId
              ? { ...target, ...retiredTarget }
              : target,
        );
        const references = targets.map(
          ({ wrappedKey: _key, wrappingMetadata: _metadata, ...target }) =>
            target,
        );
        const targetHash =
          await computeDocumentContentKeyTargetHash(references);
        const projection: DocumentWriterProjectionResponse = {
          ...fixture.writerProjection,
          authorizingContainerPaths: paths,
          contentKeyBundle: {
            ...fixture.writerProjection.contentKeyBundle,
            targetHash,
            targets,
          },
          documentKekTargets: {
            ...fixture.writerProjection.documentKekTargets,
            targets: references,
            documentKeyTargetHash: targetHash,
            linkedContainerManifestHashes: references
              .map((target) => target.containerManifestHash)
              .sort(),
            linkedContainerKeyEpochIds: references
              .map((target) => target.containerKeyEpochId)
              .sort(),
          },
        };
        let submissions = 0;
        let disclosed = false;
        const oldKeys = await unwrapContainerKekPath({
          projection: fixture.destination,
          execSql: fixture.execSql,
          secretKey: fixture.secretKey,
          resolveProjectionUserKey: fixture.resolveProjectionUserKey,
        });
        const retiredKey = oldKeys.get(retiredTarget.containerKeyEpochId);
        if (!retiredKey)
          throw new Error(
            "Expected destination history to contain B's retired key",
          );
        const operation = relinkRemoteDocument({
          apiClient: createMockApiClient({
            getContainerWriterProjection: async () => fixture.destination,
            getDocumentWriterProjection: async () => projection,
            listDocumentAttachments: async () => [binding],
            getBlobBytes: async (blobId) =>
              createBlobBytesResponse({
                blobId,
                encryptedBytes: fixture.stagedBlob.encryptedBytes,
                sha256: fixture.stagedBlob.sha256,
              }),
            linkDocument: async (documentId, request) => {
              submissions += 1;
              const body = normalizeDocumentAccessEventBody(
                readCanonicalJson(request.body, "link body"),
              );
              const target = body.blobRewraps[0]?.targets.find(
                (entry) => entry.containerId === retiredTarget.containerId,
              );
              if (!target) throw new Error("Expected B's envelope");
              if (steer) {
                const metadata = target.wrappingMetadata as { iv: string };
                const opened = await decryptWithDek(
                  {
                    ciphertext: base64ToBytes(target.wrappedKey),
                    iv: base64ToBytes(metadata.iv),
                  },
                  retiredKey,
                );
                disclosed = opened.every(
                  (byte, index) => byte === fixture.contentKey[index],
                );
                expect(disclosed).toBe(true);
              } else {
                const original = binding.contentKeyBundle.targets.find(
                  (entry) => entry.containerId === retiredTarget.containerId,
                );
                expect<unknown>(target).toEqual(original);
              }
              return createLinkSetResponseFromRequest(documentId, request);
            },
          }),
          author: fixture.author,
          documentId: projection.documentId,
          execSql: fixture.execSql,
          operation: "link",
          resolveProjectionUserKey: fixture.resolveProjectionUserKey,
          targetContainerId: fixture.destination.containerId,
          targetSecretKey: fixture.secretKey,
        });
        if (steer) {
          await expect(operation).rejects.toThrow(
            "Attachment destination is not a verified current container head",
          );
          expect(submissions).toBe(0);
          expect(disclosed).toBe(false);
        } else {
          expect(await operation).not.toBeNull();
          expect(submissions).toBe(1);
        }
      } finally {
        fixture.close();
      }
    },
  );
}
