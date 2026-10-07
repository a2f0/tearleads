import { createUploadedAttachmentFixture } from "./blobHydrationFixture";
import { createMaterializedSyncFixture } from "./documentFixtures";
import { buildInitialGroupPolicyRequest } from "./groupMetadata";
import { policyBundleFromInitialRequest } from "./principalPolicyFixtures";
import { createProjectionPolicyEvidence } from "./projectionPolicyEvidence";
import { projectionPolicyWarmer } from "./projectionPolicyHistory";

export async function createPagedAttachmentFixture() {
  const documentFixture = await createMaterializedSyncFixture({
    containerId: crypto.randomUUID(),
    organizationId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
  });
  const fixture = await createUploadedAttachmentFixture({ documentFixture });
  const group = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      groupId: crypto.randomUUID(),
      name: "Attachment readers",
      creatorEncapsulationKeyPair: {
        publicKey: fixture.publicKey,
        secretKey: fixture.secretKey,
      },
      signerUserId: fixture.author.signerUserId,
      signingFingerprint: fixture.author.signerKeyFingerprint,
      signingKeyPair: {
        signingPrivateKey: fixture.author.signerPrivateKey,
        signingPublicKey: documentFixture.signingPublicKey,
      },
    }),
  );
  const { bundles, policyEvidence } = await createProjectionPolicyEvidence({
    author: fixture.author,
    group,
    signingPublicKey: documentFixture.signingPublicKey,
    encapsulationKeyPair: {
      publicKey: fixture.publicKey,
      secretKey: fixture.secretKey,
    },
  });
  fixture.writerProjection.policyEvidence = policyEvidence;
  return {
    ...fixture,
    warmReferencedPrincipalPolicies: projectionPolicyWarmer({
      bundles,
      execSql: fixture.execSql,
      resolveUserKey: fixture.resolveProjectionUserKey,
    }),
  };
}
