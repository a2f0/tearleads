import type {
  PrincipalPolicyExternalAuthority,
  ReferencedPrincipalHead,
} from "@tearleads/crypto";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { advanceKeyingCheckpointsAtomically } from "../../data/persistence/keyingCheckpointAdvancePersistence";
import { requireOrganizationGroupHead } from "../../data/principals/organizationAuthorityDescriptor";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { createRuntimePrincipalPolicyCurrentResolver } from "../principals/runtimePolicyRecovery";
import { createSelectedCurrentGroupMetadataContainerVerifier } from "./currentGroupMetadataAuthority";
import { loadCurrentOrganizationAuthority } from "./currentOrganizationAuthority";
import { assertGroupMetadataBinding } from "./groupMetadataBinding";
import { requireSignerCanManageGroup } from "./groupMutationAuthorization";

/** Exact current directory, strict Admins and group evidence for one mutation. */
export async function loadCurrentGroupPolicyMutationContext(input: {
  readonly execSql: ExecSql;
  readonly groupId: string;
  readonly organizationId: string;
  readonly signerUserId: string;
  readonly resolveCurrentPolicy: NonNullable<
    ReturnType<typeof createRuntimePrincipalPolicyCurrentResolver>
  >;
  readonly recoverPendingPrincipalMutation: (
    organizationId: string,
  ) => Promise<void>;
  readonly stillCurrent: () => boolean;
}) {
  input = { ...input };
  assertProjectionVerificationCurrent(input.stillCurrent);
  // Resolve uncertain prior writes before selecting the directory for a new one.
  await input.recoverPendingPrincipalMutation(input.organizationId);
  assertProjectionVerificationCurrent(input.stillCurrent);
  const authority = await loadCurrentOrganizationAuthority(input);
  const currentOrgAdminUserIds = authority.admins.policy.projection
    .filter((member) => member.role === "admin")
    .map((member) => member.userId);
  if (!currentOrgAdminUserIds.includes(input.signerUserId))
    throw new Error("Organization admin authority is required");
  const group = await authority.readGroup(input.groupId);
  const stillCurrent = () =>
    input.stillCurrent() && authority.stillCurrent() && group.stillCurrent();
  assertProjectionVerificationCurrent(stillCurrent);
  assertGroupMetadataBinding(group.current, authority.descriptor);
  requireSignerCanManageGroup(
    group.current,
    currentOrgAdminUserIds,
    input.signerUserId,
  );
  await advanceKeyingCheckpointsAtomically({
    access: [],
    execSql: input.execSql,
    organizationId: input.organizationId,
    policies: [...group.dependencies, group.policy],
    stillCurrent,
  });
  assertProjectionVerificationCurrent(stillCurrent);
  const adminHead = requireOrganizationGroupHead(
    authority.descriptor,
    authority.descriptor.adminGroupId,
  );
  const externalAuthority: PrincipalPolicyExternalAuthority = {
    currentHead: adminHead,
    states: [
      { head: adminHead, projection: authority.admins.policy.projection },
    ],
  };
  return {
    adminGroupId: authority.descriptor.adminGroupId,
    adminCurrent: authority.admins,
    currentPolicy: group.current,
    verifiedCurrentPolicy: group.policy,
    verifyMetadataContainer:
      createSelectedCurrentGroupMetadataContainerVerifier({
        authority,
        organizationId: input.organizationId,
        stillCurrent,
      }),
    currentOrgAdminUserIds,
    externalAuthority,
    isOrganizationAdminsGroup:
      input.groupId === authority.descriptor.adminGroupId,
    localPolicyCheckpoint: group.policy.checkpoint,
    memberGroupId: authority.descriptor.memberGroupId,
    organizationDescriptor: authority.descriptor,
    organizationCurrent: authority.directory,
    async readPredecessorReference(reference: ReferencedPrincipalHead) {
      assertProjectionVerificationCurrent(stillCurrent);
      const selected = await authority.readGroup(input.groupId, reference);
      assertProjectionVerificationCurrent(stillCurrent);
      return selected.policy;
    },
    stillCurrent,
  };
}
