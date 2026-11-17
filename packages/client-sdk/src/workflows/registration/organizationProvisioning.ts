// Registration and additional-organization creation build and persist an
// organization's founding policies, system containers, and profile documents
// through this module.
import {
  type EncapsulationKeyPair,
  type SigningKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import type {
  CreateOrganizationGroupRequest,
  RegistrationRequest,
} from "@tearleads/validators/request";
import { buildInitialOrganizationPolicyRequest } from "../../data/principals/organizationPolicyRequest";
import { resolveDocumentCreateAuthor } from "../documents";
import { groupPolicyMutationHead } from "../organizations/groupPolicy/groupPolicyMutationHead";
import {
  buildInitialGroupPolicyRequest,
  buildInitialMemberGroupPolicyRequest,
} from "../organizations/principalPolicy";
import type { OrganizationProvisioningArtifacts } from "./organizationProvisioningArtifacts";
import {
  buildInitialOrganizationMetadataBootstrap,
  buildInitialRootProvisioning,
  buildInitialRosterProfileBootstrap,
  buildInitialSystemContainerBootstrap,
  type ProvisionedSystemContainerSpec,
} from "./provisioningBootstrapBuilders";
import { createInitialRootMetadataBootstrap } from "./rootMetadataBootstrap";

export type { OrganizationProvisioningArtifacts } from "./organizationProvisioningArtifacts";
export { persistOrganizationProvisioningState } from "./organizationProvisioningPersistence";
export type { ProvisionedSystemContainerSpec } from "./provisioningBootstrapBuilders";

interface OrganizationProvisioningPrincipalPolicies {
  initialAdminGroup: CreateOrganizationGroupRequest;
  initialMemberGroup: CreateOrganizationGroupRequest;
  initialOrganizationPolicy: RegistrationRequest["initialOrganizationPolicy"];
  organizationId: string;
  signingFingerprint: string;
}

/**
 * The freshly built provisioning artifacts, shared by registration and
 * additional-organization creation. `registerIdentity` generates a new
 * `userId`; creating an additional organization reuses the caller's existing
 * one. Everything here is derived purely from the caller's key material, so it
 * is identical for both flows.
 */
export interface OrganizationProvisioningArtifactsInput {
  identityTrustDomain: string;
  encapsulationKeyPair: EncapsulationKeyPair;
  organizationProfileName?: string | undefined;
  /**
   * App-owned system containers to provision atomically with the organization
   * (e.g. a trash bin). Omitted/empty leaves the org with only the roster and
   * organization-metadata system containers.
   */
  provisionedSystemContainers?:
    | ReadonlyArray<ProvisionedSystemContainerSpec>
    | undefined;
  rootContainerId: string;
  rosterProfileNickname?: string | undefined;
  signingKeyPair: SigningKeyPair;
  userId: string;
}

async function createOrganizationPrincipalPolicies(input: {
  identityTrustDomain: string;
  encapsulationKeyPair: EncapsulationKeyPair;
  organizationMetadataContainerId: string;
  rootContainerId: string;
  signingKeyPair: SigningKeyPair;
  userId: string;
}): Promise<OrganizationProvisioningPrincipalPolicies> {
  const organizationId = crypto.randomUUID();
  const signingFingerprint = await toFingerprint(
    input.signingKeyPair.signingPublicKey,
  );
  const initialAdminGroup = await buildInitialGroupPolicyRequest({
    identityTrustDomain: input.identityTrustDomain,
    creatorEncapsulationKeyPair: input.encapsulationKeyPair,
    groupId: crypto.randomUUID(),
    grants: [
      { containerId: input.rootContainerId, accessLevel: "admin" },
      {
        containerId: input.organizationMetadataContainerId,
        accessLevel: "admin",
      },
    ],
    name: "Admins",
    builtinRole: "admins",
    signerUserId: input.userId,
    signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
  const initialMemberGroup = await buildInitialMemberGroupPolicyRequest({
    identityTrustDomain: input.identityTrustDomain,
    creatorEncapsulationKeyPair: input.encapsulationKeyPair,
    groupId: crypto.randomUUID(),
    grants: [
      {
        containerId: input.organizationMetadataContainerId,
        accessLevel: "read",
      },
    ],
    signerUserId: input.userId,
    signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  });
  const initialOrganizationPolicy = await buildInitialOrganizationPolicyRequest(
    {
      identityTrustDomain: input.identityTrustDomain,
      adminGroupId: initialAdminGroup.groupId,
      encapsulationPublicKey: input.encapsulationKeyPair.publicKey,
      groupHeads: await Promise.all([
        groupPolicyMutationHead(initialAdminGroup.initialGroupPolicy),
        groupPolicyMutationHead(initialMemberGroup.initialGroupPolicy),
      ]),
      memberGroupId: initialMemberGroup.groupId,
      organizationId,
      signingKeyPair: input.signingKeyPair,
      userId: input.userId,
    },
  );

  return {
    initialAdminGroup,
    initialMemberGroup,
    initialOrganizationPolicy,
    organizationId,
    signingFingerprint,
  };
}

function requireOrganizationProvisioningAuthor(input: {
  readonly organizationId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
  readonly userId: string;
}) {
  const author = resolveDocumentCreateAuthor({
    auth: { organizationId: input.organizationId, userId: input.userId },
    crypto: {
      signingFingerprint: input.signingFingerprint,
      signingKeyPair: input.signingKeyPair,
    },
  });
  if (!author) {
    throw new Error(
      `Organization provisioning document author context is unavailable for user ${input.userId} in organization ${input.organizationId}.`,
    );
  }
  return author;
}

/** Builds the signed artifacts shared by registration and org creation. */
export async function buildOrganizationProvisioningArtifacts(
  input: OrganizationProvisioningArtifactsInput,
): Promise<OrganizationProvisioningArtifacts> {
  const bootstrap = await createInitialRootMetadataBootstrap(
    input.rootContainerId,
  );
  const organizationMetadataContainerId = crypto.randomUUID();
  const {
    initialAdminGroup,
    initialMemberGroup,
    initialOrganizationPolicy,
    organizationId,
    signingFingerprint,
  } = await createOrganizationPrincipalPolicies({
    ...input,
    organizationMetadataContainerId,
  });
  const author = requireOrganizationProvisioningAuthor({
    organizationId,
    signingFingerprint,
    signingKeyPair: input.signingKeyPair,
    userId: input.userId,
  });

  const {
    rootContainer,
    rootContainerProjection,
    rootMetadataDocument,
    rootMetadataDocumentRequest,
  } = await buildInitialRootProvisioning({
    adminGroup: initialAdminGroup,
    author,
    bootstrap,
    recipientEncapsulationPublicKey: input.encapsulationKeyPair.publicKey,
    rootContainerId: input.rootContainerId,
    targetSecretKey: input.encapsulationKeyPair.secretKey,
  });
  const rosterProfileBootstrap = await buildInitialRosterProfileBootstrap({
    author,
    encapsulationPublicKey: input.encapsulationKeyPair.publicKey,
    initialAdminGroup,
    rosterProfileNickname: input.rosterProfileNickname,
    rootContainer,
    rootContainerProjection,
    targetSecretKey: input.encapsulationKeyPair.secretKey,
  });
  const organizationMetadataBootstrap =
    await buildInitialOrganizationMetadataBootstrap({
      author,
      containerId: organizationMetadataContainerId,
      initialAdminGroup,
      initialMemberGroup,
      organizationProfileName: input.organizationProfileName,
      rootContainer,
      rootContainerProjection,
      targetSecretKey: input.encapsulationKeyPair.secretKey,
    });
  const systemContainerBootstraps = await Promise.all(
    (input.provisionedSystemContainers ?? []).map((spec) =>
      buildInitialSystemContainerBootstrap({
        author,
        initialAdminGroup,
        rootContainer,
        rootContainerProjection,
        signingPrivateKey: input.signingKeyPair.signingPrivateKey,
        spec,
        targetSecretKey: input.encapsulationKeyPair.secretKey,
      }),
    ),
  );

  return {
    replacementAuthorization: null,
    bootstrap,
    initialAdminGroup,
    initialMemberGroup,
    initialOrganizationPolicy,
    initialRootContainer: rootContainer.plan.request,
    organizationId,
    organizationMetadataBootstrap,
    rootContainer,
    rootMetadataDocument,
    rootMetadataDocumentRequest,
    rosterProfileBootstrap,
    systemContainerBootstraps,
  };
}
