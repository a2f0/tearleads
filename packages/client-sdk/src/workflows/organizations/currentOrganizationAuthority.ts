import {
  KeyingVerificationError,
  type ReferencedPrincipalHead,
} from "@tearleads/crypto";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { validateKeyingCheckpointsAtomically } from "../../data/persistence/keyingCheckpointAdvancePersistence";
import { assertCurrentMatchesVerifiedPolicy } from "../../data/persistence/verifiedPrincipalPolicyCurrent";
import {
  parseOrganizationAuthorityDescriptor,
  principalHeadMatchesReference,
  requireOrganizationGroupHead,
} from "../../data/principals/organizationAuthorityDescriptor";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type {
  createRuntimePrincipalPolicyCurrentResolver,
  ResolvedPrincipalPolicyCurrent,
} from "../principals/runtimePolicyRecovery";

type CurrentPolicyResolver = NonNullable<
  ReturnType<typeof createRuntimePrincipalPolicyCurrentResolver>
>;

interface CurrentOrganizationAuthorityInput {
  readonly execSql: ExecSql;
  readonly organizationId: string;
  readonly organizationReference?: ReferencedPrincipalHead | null | undefined;
  readonly resolveCurrentPolicy: CurrentPolicyResolver;
  readonly stillCurrent: () => boolean;
}

/** One directory view with bounded, authenticated current artifacts for its groups. */
export async function loadCurrentOrganizationAuthority(
  input: CurrentOrganizationAuthorityInput,
) {
  if (input.organizationReference)
    assertReferenceScope(
      input.organizationReference,
      "organization",
      input.organizationId,
    );
  const recoveryBatch = {};
  const resolve = (reference?: ReferencedPrincipalHead | null) =>
    input.resolveCurrentPolicy({
      organizationId: input.organizationId,
      reference: reference ?? undefined,
      recoveryBatch,
      stillCurrent: input.stillCurrent,
    });
  const directory = await resolve(input.organizationReference);
  await assertExactCurrent(
    directory,
    input.organizationReference ?? directory.policy.state,
  );
  const descriptor = parseOrganizationAuthorityDescriptor(
    directory.current.currentPayload.ciphertext,
  );
  if (descriptor.organizationId !== input.organizationId)
    throw new KeyingVerificationError(
      "object_mismatch",
      "Organization current policy payload is outside its scope",
    );
  const adminHead = requireOrganizationGroupHead(
    descriptor,
    descriptor.adminGroupId,
  );
  const admins = await resolve(adminHead);
  await assertExactCurrent(admins, adminHead);
  assertDirectoryDependency(admins, directory);
  const stillCurrent = () =>
    input.stillCurrent() && directory.stillCurrent() && admins.stillCurrent();
  const validate = async (value: ResolvedPrincipalPolicyCurrent) => {
    assertProjectionVerificationCurrent(stillCurrent);
    await validateKeyingCheckpointsAtomically({
      access: [],
      execSql: input.execSql,
      policies: [...value.dependencies, value.policy],
      stillCurrent: () => stillCurrent() && value.stillCurrent(),
    });
    assertProjectionVerificationCurrent(
      () => stillCurrent() && value.stillCurrent(),
    );
  };
  await validate(admins);
  return {
    admins,
    descriptor,
    directory,
    stillCurrent,
    async readGroup(groupId: string, reference?: ReferencedPrincipalHead) {
      assertProjectionVerificationCurrent(stillCurrent);
      const head = requireOrganizationGroupHead(descriptor, groupId);
      const selected = reference ?? head;
      assertReferenceScope(selected, "group", groupId);
      const result =
        groupId === descriptor.adminGroupId &&
        principalHeadMatchesReference(admins.policy.state, selected)
          ? admins
          : await resolve(selected);
      await assertExactCurrent(result, head);
      assertDirectoryDependency(result, directory);
      if (groupId !== descriptor.adminGroupId)
        assertAdminsDependency(result, adminHead);
      await validate(result);
      return result;
    },
  };
}

function assertReferenceScope(
  reference: ReferencedPrincipalHead,
  principalType: ReferencedPrincipalHead["principalType"],
  principalId: string,
) {
  if (
    reference.principalType !== principalType ||
    reference.principalId !== principalId
  )
    throw new KeyingVerificationError(
      "object_mismatch",
      "Current policy reference is outside its scope",
    );
}

async function assertExactCurrent(
  value: ResolvedPrincipalPolicyCurrent,
  expected: ReferencedPrincipalHead,
) {
  assertProjectionVerificationCurrent(value.stillCurrent);
  await assertCurrentMatchesVerifiedPolicy(value);
  if (!principalHeadMatchesReference(value.policy.state, expected))
    throw new Error(
      "Current policy changed from the selected organization directory",
    );
  assertProjectionVerificationCurrent(value.stillCurrent);
}

function assertDirectoryDependency(
  value: ResolvedPrincipalPolicyCurrent,
  directory: ResolvedPrincipalPolicyCurrent,
) {
  const dependency = value.dependencies.find(
    (policy) =>
      policy.principalType === "organization" &&
      policy.principalId === directory.policy.principalId,
  );
  if (
    !dependency ||
    !principalHeadMatchesReference(dependency.state, directory.policy.state)
  )
    throw new Error(
      "Current policy belongs to a changed organization directory",
    );
}

function assertAdminsDependency(
  value: ResolvedPrincipalPolicyCurrent,
  expected: ReferencedPrincipalHead,
) {
  const authority = value.dependencies.find(
    (policy) =>
      policy.principalType === "group" &&
      policy.principalId === expected.principalId,
  );
  if (!authority || !principalHeadMatchesReference(authority.state, expected))
    throw new KeyingVerificationError(
      "missing_dependency",
      "Current group policy omits its exact Admins dependency",
    );
}
