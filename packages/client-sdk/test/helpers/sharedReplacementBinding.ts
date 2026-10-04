import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  signOrganizationReplacementAuthorization,
  toFingerprint,
} from "@tearleads/crypto";
import { verifyPrincipalPolicySnapshots } from "../../src/data/keyingProjectionVerification/principalPolicySnapshotVerification";
import { rememberOrganizationFounder } from "../../src/data/persistence/organizationFounderPersistence";
import type { ExecSql } from "../../src/data/sqlite/sqlSchema";
import type { assertPermittedDestinationBinding } from "../../src/workflows/container-contents/remoteHydration/replacementBinding";
import { buildOrganizationProvisioningArtifacts } from "../../src/workflows/registration/registerIdentity";
import { policySnapshot } from "./organizationPolicyHistory";
import { organizationPolicyBundleFromInitialRequest } from "./principalPolicyFixtures";
import { createTestTrustedUserIdentityResolver } from "./trustedUserIdentity";

export async function sharedReplacementBindingFixture(execSql: ExecSql) {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const userId = crypto.randomUUID();
  const rootContainerId = crypto.randomUUID();
  const provision = (root: string) =>
    buildOrganizationProvisioningArtifacts({
      signingKeyPair,
      encapsulationKeyPair,
      userId,
      rootContainerId: root,
    });
  const old = await provision(crypto.randomUUID());
  const replacement = await provision(rootContainerId);
  const proof = await signOrganizationReplacementAuthorization(
    {
      ...replacement,
      replacesOrganizationId: old.organizationId,
      userId,
      rootContainerId,
    },
    signingKeyPair,
  );
  const resolveTrustedUserIdentity = createTestTrustedUserIdentityResolver({
    userId,
    signingKeyFingerprint: await toFingerprint(signingKeyPair.signingPublicKey),
    signingPublicKey: signingKeyPair.signingPublicKey,
    encapsulationPublicKey: encapsulationKeyPair.publicKey,
  });
  const snapshots = await Promise.all(
    [old, replacement].map(async (artifacts) =>
      policySnapshot(
        await organizationPolicyBundleFromInitialRequest(
          artifacts.organizationId,
          artifacts.initialOrganizationPolicy,
        ),
      ),
    ),
  );
  const policies = await verifyPrincipalPolicySnapshots({
    snapshots,
    resolveUserKey: resolveTrustedUserIdentity,
  });
  for (const organization of policies)
    await rememberOrganizationFounder({ execSql, organization });
  const input: Parameters<typeof assertPermittedDestinationBinding>[0] = {
    heldBinding: {
      organizationId: old.organizationId,
      metadataDocumentId: "held-metadata",
    },
    listed: {
      id: crypto.randomUUID(),
      organizationId: replacement.organizationId,
    },
    role: {
      createSignerUserId: userId,
      metadataDocumentId: "replacement-metadata",
      systemSlot: null,
      rootContainerId,
      rootCreateManifestHash: proof.rootManifestHash,
      rootMetadataDocumentId: proof.rootMetadataDocumentId,
    },
    runtime: {
      apiClient: {
        getContainerReplacementAuthorizationsResult: async () => ({
          ok: true,
          data: { authorizations: [proof] },
        }),
      },
      auth: { userId: "reshared-member" },
      infra: { execSql },
      resolveTrustedUserIdentity,
    } as unknown as Parameters<
      typeof assertPermittedDestinationBinding
    >[0]["runtime"],
  };
  return {
    input,
    policies,
    proof,
    signingKeyPair,
    encapsulationKeyPair,
    replacement,
    userId,
    rootContainerId,
  };
}
