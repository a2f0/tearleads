import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { parseOrganizationAuthorityDescriptor } from "../../src/data/principals/organizationAuthorityDescriptor";
import { inheritPrincipalHistoryProtection } from "../../src/data/principals/principalHistoryRuntime";
import { buildOrganizationGroupDirectoryPolicyRequest } from "../../src/workflows/organizations/organizationGroupDirectory";
import { buildInitialGroupPolicyRequest } from "../../src/workflows/organizations/principalPolicyRequest";
import { buildOrganizationProvisioningArtifacts } from "../../src/workflows/registration/registerIdentity";
import { createMutationResponseFromRequest } from "./containerFixtures";
import { createShareTestRuntime } from "./groupShareScenario";
import { createLocalAuthorityRecoveryFixture } from "./principalAuthorityLocal";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleAfterMutation,
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "./principalPolicyFixtures";
import {
  projectionDirectoryPayload,
  projectionHistoryPages,
  projectionPolicySource,
} from "./projectionPolicyHistory";
import { createTestTrustedUserIdentity } from "./trustedUserIdentity";

/** Real encrypted group name and signed metadata root, with private page custody. */
export async function createCurrentShareMetadataFixture(
  options: { grantedContainerId?: string } = {},
) {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const keyPair = generateKemSeedAndKeyPair();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const signerUserId = crypto.randomUUID();
  const signer = { signerUserId, signingFingerprint, signingKeyPair };
  const artifacts = await buildOrganizationProvisioningArtifacts({
    encapsulationKeyPair: keyPair,
    signingKeyPair,
    userId: signerUserId,
    rootContainerId: crypto.randomUUID(),
  });
  const { organizationId, organizationMetadataBootstrap: metadata } = artifacts;
  const admin = await policyBundleFromInitialRequest(
    artifacts.initialAdminGroup,
  );
  const members = await policyBundleFromInitialRequest(
    artifacts.initialMemberGroup,
  );
  const initialDirectory = await organizationPolicyBundleFromInitialRequest(
    organizationId,
    artifacts.initialOrganizationPolicy,
  );
  const name = "Research colleagues";
  const metadataKey = {
    organizationId,
    containerId: metadata.containerId,
    containerKeyEpochId: metadata.containerPlan.plan.containerKeyEpochId,
    keyMaterial: metadata.containerPlan.containerKey,
  };
  const group = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      ...signer,
      creatorEncapsulationKeyPair: keyPair,
      groupId: crypto.randomUUID(),
      name,
      grants: options.grantedContainerId
        ? [{ containerId: options.grantedContainerId, accessLevel: "read" }]
        : [],
      metadataKey,
    }),
  );
  const identity = createTestTrustedUserIdentity({
    userId: signerUserId,
    signingPublicKey: signingKeyPair.signingPublicKey,
    signingKeyFingerprint: signingFingerprint,
    encapsulationPublicKey: keyPair.publicKey,
  });
  const directory = await policyBundleAfterMutation({
    previous: initialDirectory,
    mutation: await buildOrganizationGroupDirectoryPolicyRequest({
      ...signer,
      currentPolicy: initialDirectory,
      descriptor: parseOrganizationAuthorityDescriptor(
        initialDirectory.currentPayload.ciphertext,
      ),
      adminProjection: admin.currentProjection,
      adminUsers: [identity],
      groupHeads: [admin, members, group].map((policy) => ({
        ...principalPolicyHead(policy),
        principalType: "group" as const,
      })),
    }),
  });
  const f = await createLocalAuthorityRecoveryFixture({
    directory,
    admin,
    group,
  });
  f.policies.set(members.currentState.principalId, members);
  const created = await createMutationResponseFromRequest(
    metadata.containerRequest.container,
  );
  const projection = {
    containerId: created.containerId,
    containerKeks: [created.containerKek],
    organizationId,
    path: [created.accessManifest],
    policyEvidence: {
      groups: [admin, members].map(projectionPolicySource),
      organization: projectionPolicySource(directory),
      organizationPayloads: [projectionDirectoryPayload(directory)],
    },
  };
  const root = await createMutationResponseFromRequest(
    artifacts.initialRootContainer,
  );
  const rootProjection = {
    containerId: root.containerId,
    containerKeks: [root.containerKek],
    organizationId,
    path: [root.accessManifest],
    policyEvidence: {
      groups: [admin].map(projectionPolicySource),
      organization: projectionPolicySource(directory),
      organizationPayloads: [projectionDirectoryPayload(directory)],
    },
  };
  let fullReads = 0;
  let metadataReads = 0;
  f.options.apiClient.getCurrentPrincipalPolicy = async () => {
    fullReads += 1;
    throw new Error("Unexpected Full fallback");
  };
  f.options.apiClient.getContainerWriterProjection = async (containerId) => {
    if (containerId === rootProjection.containerId) return rootProjection;
    metadataReads += 1;
    return projection;
  };
  f.options.apiClient.getProjectionPolicyHistoryPages = (source, options) =>
    projectionHistoryPages([
      directory,
      group,
      ...f.policies.values(),
    ]).getProjectionPolicyHistoryPages(source, {
      afterVersion: options?.afterVersion ?? 0,
    });
  const runtime = inheritPrincipalHistoryProtection(
    {
      withPrincipalHistoryProtection: async <T>(
        work: (lease: {
          protection: typeof f.options.protection;
          stillCurrent: () => boolean;
        }) => Promise<T>,
      ) => work({ protection: f.options.protection, stillCurrent: () => true }),
    },
    createShareTestRuntime({
      apiClient: f.options.apiClient,
      author: {
        organizationId,
        signerUserId,
        signerDeviceId: "metadata-share-test-device",
        signerKeyFingerprint: signingFingerprint,
        signerPrivateKey: signingKeyPair.signingPrivateKey,
      },
      crypto: {
        encapsulationKeyPair: keyPair,
        signingKeyPair,
        signingFingerprint,
      },
      execSql: f.options.execSql,
      logs: [],
      resolveTrustedUserIdentity: async (userId) =>
        userId === signerUserId ? identity : null,
    }),
  );
  return {
    ...f,
    metadataKey,
    directory,
    admin,
    group,
    name,
    organizationId,
    projection,
    rootProjection,
    runtime,
    fullReads: () => fullReads,
    metadataReads: () => metadataReads,
  };
}
