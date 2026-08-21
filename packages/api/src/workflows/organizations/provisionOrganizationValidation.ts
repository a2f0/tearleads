import { computePrincipalStateHash } from "@symcrypt/crypto";
import type {
  OrganizationProvisioningRequest,
  PutPrincipalPolicyRequest,
} from "@symcrypt/validators/request";
import { parseOrganizationAuthorityDescriptor } from "./organizationAuthorityDescriptor";
import { groupHeadsEqual } from "./organizationGroupDirectoryValidation";
import { OrganizationProvisioningError } from "./provisionOrganizationError";

export const ADMIN_GROUP_NAME = "Admins";
export const MEMBER_GROUP_NAME = "Members";

interface ProvisioningValidationSigner {
  readonly fingerprint: string;
  readonly encapsulationFingerprint: string;
}

/**
 * Checks shared by every bootstrap policy bundle: it must be the first state of
 * its principal, signed by the registering user, and both project and wrap that
 * user as the sole admin member. `label` prefixes every error message (e.g.
 * "initialAdminGroup policy").
 */
function validateInitialPolicyBundle(input: {
  bundle: PutPrincipalPolicyRequest;
  firstStateKind: "organization" | "group";
  label: string;
  signer: ProvisioningValidationSigner;
  userId: string;
}): void {
  const { bundle, firstStateKind, label, signer, userId } = input;
  const { memberEnvelopes, projection, state } = bundle;

  if (
    state.signerUserId !== userId ||
    state.signerUserKeyFingerprint !== signer.fingerprint
  ) {
    throw new OrganizationProvisioningError(
      `${label} signer must match the registering user`,
      400,
    );
  }

  if (
    state.version !== 1 ||
    state.prevStateHash !== null ||
    state.keyEpoch !== 1
  ) {
    throw new OrganizationProvisioningError(
      `${label} state must be the first ${firstStateKind} state`,
      400,
    );
  }

  const onlyProjectionMember = projection[0];
  if (
    projection.length !== 1 ||
    onlyProjectionMember?.userId !== userId ||
    onlyProjectionMember.role !== "admin" ||
    state.memberCount !== 1
  ) {
    throw new OrganizationProvisioningError(
      `${label} projection must contain the registering user as sole admin`,
      400,
    );
  }

  const onlyMemberEnvelope = memberEnvelopes[0];
  if (
    memberEnvelopes.length !== 1 ||
    onlyMemberEnvelope?.userId !== userId ||
    onlyMemberEnvelope.memberKeyFingerprint !== signer.encapsulationFingerprint
  ) {
    throw new OrganizationProvisioningError(
      `${label} member envelope must wrap the registering user`,
      400,
    );
  }
}

async function validateInitialOrganizationPolicyInput(
  input: OrganizationProvisioningRequest,
  signer: ProvisioningValidationSigner,
): Promise<void> {
  const { encryptedPayload, state } = input.initialOrganizationPolicy;

  const descriptor = parseOrganizationAuthorityDescriptor(
    encryptedPayload.ciphertext,
  );
  if (
    !descriptor ||
    descriptor.organizationId !== input.organizationId ||
    descriptor.adminGroupId !== input.initialAdminGroup.groupId ||
    descriptor.memberGroupId !== input.initialMemberGroup.groupId
  ) {
    throw new OrganizationProvisioningError(
      "initialOrganizationPolicy authority descriptor must bind the reserved groups",
      400,
    );
  }
  if (input.initialOrganizationPolicy.grants.length !== 0) {
    throw new OrganizationProvisioningError(
      "initialOrganizationPolicy cannot contain container grants",
      400,
    );
  }
  const expectedGroupHeads = await Promise.all(
    [input.initialAdminGroup, input.initialMemberGroup].map(async (group) => ({
      principalType: "group" as const,
      principalId: group.groupId,
      version: group.initialGroupPolicy.state.version,
      keyEpoch: group.initialGroupPolicy.state.keyEpoch,
      stateHash: await computePrincipalStateHash(
        group.initialGroupPolicy.state,
      ),
      keyFingerprint: group.initialGroupPolicy.state.keyFingerprint,
    })),
  );
  expectedGroupHeads.sort((left, right) =>
    left.principalId.localeCompare(right.principalId),
  );
  const commitsExpectedGroupHeads =
    descriptor.groupHeads.length === expectedGroupHeads.length &&
    descriptor.groupHeads.every((head, index) => {
      const expectedHead = expectedGroupHeads[index];
      return Boolean(expectedHead && groupHeadsEqual(head, expectedHead));
    });
  if (!commitsExpectedGroupHeads) {
    throw new OrganizationProvisioningError(
      "initialOrganizationPolicy authority descriptor must commit the reserved group heads",
      400,
    );
  }

  if (
    state.principalType !== "organization" ||
    state.principalId !== input.organizationId
  ) {
    throw new OrganizationProvisioningError(
      "initialOrganizationPolicy state must target the registered organization",
      400,
    );
  }

  validateInitialPolicyBundle({
    bundle: input.initialOrganizationPolicy,
    firstStateKind: "organization",
    label: "initialOrganizationPolicy",
    signer,
    userId: input.userId,
  });
}

function validateInitialGroupInput(input: {
  expectedName: string;
  group: OrganizationProvisioningRequest["initialAdminGroup"];
  groupLabel: "initialAdminGroup" | "initialMemberGroup";
  signer: ProvisioningValidationSigner;
  targetDescription: string;
  userId: string;
}): void {
  const { expectedName, group, groupLabel, signer, targetDescription, userId } =
    input;
  const { state } = group.initialGroupPolicy;

  if (group.name.trim() !== expectedName) {
    throw new OrganizationProvisioningError(
      `${groupLabel} name must be ${expectedName}`,
      400,
    );
  }

  if (state.principalType !== "group" || state.principalId !== group.groupId) {
    throw new OrganizationProvisioningError(
      `${groupLabel} policy state must target the ${targetDescription}`,
      400,
    );
  }

  validateInitialPolicyBundle({
    bundle: group.initialGroupPolicy,
    firstStateKind: "group",
    label: `${groupLabel} policy`,
    signer,
    userId,
  });
}

/**
 * Validates that the client-signed provisioning artifacts are internally
 * consistent and signed by the founding admin. Shared by user registration and
 * additional-organization creation; throws {@link OrganizationProvisioningError}
 * (400) on any mismatch.
 */
export async function validateOrganizationProvisioningInput(
  input: OrganizationProvisioningRequest,
  signer: ProvisioningValidationSigner,
): Promise<void> {
  await validateInitialOrganizationPolicyInput(input, signer);
  validateInitialGroupInput({
    expectedName: ADMIN_GROUP_NAME,
    group: input.initialAdminGroup,
    groupLabel: "initialAdminGroup",
    signer,
    targetDescription: "admin group",
    userId: input.userId,
  });
  if (input.initialMemberGroup.groupId === input.initialAdminGroup.groupId) {
    throw new OrganizationProvisioningError(
      "initialMemberGroup must be distinct from initialAdminGroup",
      400,
    );
  }
  validateInitialGroupInput({
    expectedName: MEMBER_GROUP_NAME,
    group: input.initialMemberGroup,
    groupLabel: "initialMemberGroup",
    signer,
    targetDescription: "member group",
    userId: input.userId,
  });
}
