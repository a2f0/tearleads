import { verifyContainerWriterProjection } from "../../src/data/keyingProjectionVerification/containerProjectionVerification";
import { verifyDocumentPurgeProofBaseline } from "../../src/data/keyingProjectionVerification/documentPurgeProofVerification";
import { advanceKeyingCheckpointsAtomically } from "../../src/data/persistence/keyingCheckpointAdvancePersistence";
import type { ExecSql } from "../../src/data/sqlite/sqlSchema";
import { grantBy, verifyPath } from "./ancestorCitationScenario";
import { createMaterializedSyncFixture } from "./documentFixtures";
import { createDocumentPurgeProof } from "./documentPurge";

export async function createPurgeCurrencyFixture(
  execSql: ExecSql,
  index: 0 | 1,
) {
  const fixture = await createMaterializedSyncFixture({
    nestedContainer: true,
  });
  const proof = await createDocumentPurgeProof(
    fixture.author,
    fixture.writerProjection,
  );
  const verification = {
    execSql,
    expectedDocumentId: proof.documentId,
    expectedOrganizationId: fixture.author.organizationId,
    proof,
    resolveUserKey: fixture.resolveProjectionUserKey,
  };
  await verifyDocumentPurgeProofBaseline(verification);
  const originalPath = await verifyContainerWriterProjection({
    execSql,
    persistVerificationCheckpoints: false,
    projection: fixture.projection,
    resolveUserKey: fixture.resolveProjectionUserKey,
  });
  const previous = originalPath[index];
  if (!previous) throw new Error("Expected nested authorization path");
  const later = await grantBy({
    cited: originalPath.slice(0, index + 1).map((head) => head.manifestHash),
    previous,
    signer: {
      userId: fixture.author.signerUserId,
      keyPair: {
        signingPrivateKey: fixture.author.signerPrivateKey,
        signingPublicKey: fixture.signingPublicKey,
      },
    },
    subjectId: "peer-added-after-purge",
  });
  const verifiedPath = await verifyPath(
    { resolveUserKey: fixture.resolveProjectionUserKey },
    execSql,
    {
      bundles: [...originalPath, later],
      path: [...originalPath.slice(0, index), later],
    },
  );
  const head = verifiedPath.at(-1);
  if (!head) throw new Error("Expected verified later head");
  return {
    fixture,
    proof,
    verification,
    originalPath,
    head,
    advanceLater: () =>
      advanceKeyingCheckpointsAtomically({
        access: [{ head, predecessors: [] }],
        execSql,
        policies: [],
      }),
  };
}
