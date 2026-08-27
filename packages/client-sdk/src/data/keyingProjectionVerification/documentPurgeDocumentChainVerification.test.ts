import { expect, test } from "bun:test";
import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@symcrypt/test-utils";
import type {
  ContainerWriterProjectionResponse,
  DocumentLinkSetMutationResponse,
  DocumentWriterProjectionResponse,
} from "@symcrypt/validators/response";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import { createDocumentPurgeProof } from "../../../test/helpers/documentPurge";
import { createLinkSetResponseFromRequest } from "../../../test/helpers/documentResponseFixtures";
import { buildMaterializedDocumentLinkSetMutationPlan } from "../../workflows/documents/linkSet";
import { verifyDocumentWriterProjection } from "./documentProjectionVerification";
import { verifyDocumentPurgeProof } from "./documentPurgeProofVerification";

function uniqueContainerPaths(
  paths: readonly (readonly DocumentWriterProjectionResponse["documentManifest"][])[],
) {
  return [
    ...new Map(
      paths.map((path) => [path.at(-1)?.manifestHash, [...path]]),
    ).values(),
  ];
}

function projectionAfterMutation(input: {
  operation: "link" | "unlink";
  previous: DocumentWriterProjectionResponse;
  response: DocumentLinkSetMutationResponse;
  target: ContainerWriterProjectionResponse;
}): DocumentWriterProjectionResponse {
  const retained = input.previous.authorizingContainerPaths.filter(
    (projection) => projection.containerId !== input.target.containerId,
  );
  const authorizingContainerPaths =
    input.operation === "link" ? [...retained, input.target] : retained;
  const documentManifestContainerPaths = uniqueContainerPaths([
    ...input.previous.documentManifestContainerPaths,
    input.target.path,
  ]);
  return {
    authorizingContainerPaths,
    contentKeyBundle: input.response.contentKeyBundle,
    documentContainerManifestHistory: [
      ...input.previous.documentContainerManifestHistory,
      ...input.target.path,
      ...input.target.containerKeks.flatMap(
        (key) => key.containerManifestHistory,
      ),
    ],
    documentId: input.response.id,
    documentKekTargets: input.response.documentKekTargets,
    documentManifest: input.response.accessManifest,
    documentManifestContainerPaths,
    documentManifestHistory: [
      input.previous.documentManifest,
      ...input.previous.documentManifestHistory,
    ],
  };
}

async function createPurgeChainFixture() {
  const fixture = await createMaterializedSyncFixture();
  const extraProjection = await createContainerWriterProjectionFixture({
    containerId: "purge-chain-extra-container",
    encapsulationPublicKey: fixture.publicKey,
    organizationId: fixture.author.organizationId,
    signerKeyFingerprint: fixture.author.signerKeyFingerprint,
    signerPrivateKey: fixture.author.signerPrivateKey,
    userId: fixture.author.signerUserId,
  });
  const linkedPlan = await buildMaterializedDocumentLinkSetMutationPlan({
    author: fixture.author,
    operation: "link",
    targetContainerProjection: extraProjection,
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: fixture.writerProjection,
  });
  const linkedResponse = await createLinkSetResponseFromRequest(
    fixture.writerProjection.documentId,
    linkedPlan.plan.request,
  );
  const linkedProjection = projectionAfterMutation({
    operation: "link",
    previous: fixture.writerProjection,
    response: linkedResponse,
    target: extraProjection,
  });
  const unlinkedPlan = await buildMaterializedDocumentLinkSetMutationPlan({
    author: fixture.author,
    operation: "unlink",
    targetContainerProjection: extraProjection,
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: linkedProjection,
  });
  const unlinkedResponse = await createLinkSetResponseFromRequest(
    fixture.writerProjection.documentId,
    unlinkedPlan.plan.request,
  );
  const headProjection = projectionAfterMutation({
    operation: "unlink",
    previous: linkedProjection,
    response: unlinkedResponse,
    target: extraProjection,
  });
  const proof = await createDocumentPurgeProof(fixture.author, headProjection);
  return {
    ...fixture,
    proof: {
      ...proof,
      documentManifestPredecessors: headProjection.documentManifestHistory,
    },
  };
}

test("document purge verifies every signed transition after its checkpoint", async () => {
  const fixture = await createPurgeChainFixture();
  const { close, execSql } = await createTestExecSql(
    "document-purge-signed-chain",
  );
  try {
    await verifyDocumentWriterProjection({
      execSql,
      projection: fixture.writerProjection,
      resolveUserKey: fixture.resolveProjectionUserKey,
    });
    const verified = await verifyDocumentPurgeProof({
      execSql,
      expectedDocumentId: fixture.writerProjection.documentId,
      proof: fixture.proof,
      resolveUserKey: fixture.resolveProjectionUserKey,
    });
    expect(verified.documentCheckpoint.manifestHash).toBe(
      fixture.proof.documentManifest.manifestHash,
    );
  } finally {
    close();
  }
});

test("document purge rejects a tampered intermediate signed transition", async () => {
  const fixture = await createPurgeChainFixture();
  const { close, execSql } = await createTestExecSql(
    "document-purge-signed-chain",
  );
  try {
    await verifyDocumentWriterProjection({
      execSql,
      projection: fixture.writerProjection,
      resolveUserKey: fixture.resolveProjectionUserKey,
    });
    const tampered = structuredClone(fixture.proof);
    const intermediate = tampered.documentManifestPredecessors[0];
    if (!intermediate) throw new Error("Expected document predecessor");
    Reflect.set(
      intermediate.event.event,
      "signedAt",
      "2026-08-26T13:00:00.000Z",
    );

    await expect(
      verifyDocumentPurgeProof({
        execSql,
        expectedDocumentId: fixture.writerProjection.documentId,
        proof: tampered,
        resolveUserKey: fixture.resolveProjectionUserKey,
      }),
    ).rejects.toThrow("signature verification failed");
  } finally {
    close();
  }
});
