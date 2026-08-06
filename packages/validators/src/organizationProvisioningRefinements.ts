export const organizationProvisioningGroupNameRefinement = {
  description: "organization provisioning group names must not be blank",
  id: "request.organization-provisioning-non-blank-group-name",
} as const;

export const organizationProvisioningDocumentSeedRefinement = {
  description:
    "each provisioned document seed must contain exactly one outgoing update and no container rekeys",
  id: "request.organization-provisioning-document-seed",
} as const;

export const organizationProvisioningContainerSeedRefinement = {
  description:
    "each provisioned system-container metadata seed must contain exactly one outgoing update and no container rekeys",
  id: "request.organization-provisioning-container-seed",
} as const;

export const organizationProvisioningRequestRuntimeRefinements = [
  organizationProvisioningContainerSeedRefinement,
  organizationProvisioningDocumentSeedRefinement,
  organizationProvisioningGroupNameRefinement,
] as const;

export const organizationProvisioningContainerKeyringRefinement = {
  description:
    "a container response keyring is null exactly for container key epoch 1",
  id: "response.organization-provisioning-container-keyring",
} as const;

export const organizationProvisioningCommittedUpdateIdsRefinement = {
  description:
    "core and profile metadata update id arrays contain no duplicates",
  id: "response.organization-provisioning-unique-update-ids",
} as const;

export const organizationProvisioningResponseRuntimeRefinements = [
  organizationProvisioningCommittedUpdateIdsRefinement,
  organizationProvisioningContainerKeyringRefinement,
] as const;
