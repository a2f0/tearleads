import {
  type PrincipalPolicyExternalAuthority,
  type ReferencedPrincipalHead,
  serializeKeyingCanonicalJson,
  type VerifiedPrincipalPolicyCurrent,
} from "@tearleads/crypto";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { advanceKeyingCheckpointsAtomically } from "../../data/persistence/keyingCheckpointAdvancePersistence";
import { requireOrganizationGroupHead } from "../../data/principals/organizationAuthorityDescriptor";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { createRuntimePrincipalPolicyCurrentResolver } from "../principals/runtimePolicyRecovery";
import { createSelectedCurrentGroupMetadataContainerVerifier } from "./currentGroupMetadataAuthority";
import { loadCurrentOrganizationMutationAuthority } from "./currentOrganizationMutationAuthority";
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
  const { authority, currentOrgAdminUserIds } =
    await loadCurrentOrganizationMutationAuthority(input);
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
  const references = new Map<string, Promise<VerifiedPrincipalPolicyCurrent>>();
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
      const owned = structuredClone(reference);
      const key = serializeKeyingCanonicalJson({ ...owned });
      let pending = references.get(key);
      if (!pending) {
        // Keep at most one bounded selection's citations, even across many paths.
        if (references.size === 128) {
          const oldest = references.keys().next().value;
          if (oldest !== undefined) references.delete(oldest);
        }
        pending = authority
          .readGroup(input.groupId, owned)
          .then((selected) => selected.policy);
        references.set(key, pending);
      }
      const policy = await pending.catch((error: unknown) => {
        if (references.get(key) === pending) references.delete(key);
        throw error;
      });
      assertProjectionVerificationCurrent(stillCurrent);
      return policy;
    },
    stillCurrent,
  };
}
