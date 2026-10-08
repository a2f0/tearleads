import {
  KeyingVerificationError,
  type ReferencedPrincipalHead,
} from "@tearleads/crypto";
import { assertProjectionVerificationCurrent } from "../../../data/keyingProjectionVerification/types";
import { advanceKeyingCheckpointsAtomically } from "../../../data/persistence/keyingCheckpointAdvancePersistence";
import { principalHeadMatchesReference } from "../../../data/principals/organizationAuthorityDescriptor";
import { createSelectedCurrentGroupMetadataContainerVerifier } from "../../organizations/currentGroupMetadataAuthority";
import { loadCurrentOrganizationAuthority } from "../../organizations/currentOrganizationAuthority";
import { createCurrentPrincipalMutationLease } from "../../organizations/currentPrincipalMutationLease";
import { assertGroupMetadataBinding } from "../../organizations/groupMetadataBinding";
import { createRuntimeGroupMetadataAccess } from "../../organizations/groupMetadataRuntime";
import type { PrincipalMutationRecoveryApi } from "../../organizations/principalMutationJournalManagement";
import {
  type GroupPolicyNameReader,
  groupPolicyNameMismatch,
} from "../../organizations/principalPolicyRequest";
import { GroupShareNameMismatchError } from "./sharePrincipalPolicy";

type CurrentShareRuntime = Parameters<
  typeof createRuntimeGroupMetadataAccess
>[0] &
  Parameters<typeof createCurrentPrincipalMutationLease>[0] & {
    readonly apiClient: {
      readonly recoverPendingPrincipalMutation?:
        | PrincipalMutationRecoveryApi["recoverPendingPrincipalMutation"]
        | undefined;
    };
  };

interface CurrentShareInput {
  readonly groupId: string;
  readonly organizationId: string;
  readonly expectedGroupHead?: ReferencedPrincipalHead | undefined;
  readonly expectedGroupName?: string | undefined;
  /** Trusted internal reader; it must authenticate the signed metadata container. */
  readonly readEncryptedName?: GroupPolicyNameReader | undefined;
  readonly stillCurrent: () => boolean;
}

type CurrentGroup = Awaited<
  ReturnType<
    Awaited<ReturnType<typeof loadCurrentOrganizationAuthority>>["readGroup"]
  >
>;

export interface CurrentSharePrincipalPolicy {
  readonly current: CurrentGroup["current"];
  readonly policy: CurrentGroup["policy"];
  readonly checkpointPolicies: readonly CurrentGroup["policy"][];
  readonly stillCurrent: () => boolean;
}

/** A share read need not be a group administrator; minting a grant checks that separately. */
export function createRuntimeCurrentSharePrincipalPolicy(
  runtime: CurrentShareRuntime,
) {
  const lease = createCurrentPrincipalMutationLease(runtime);
  if (!lease) return undefined;
  return async <T>(
    input: CurrentShareInput,
    work: (policy: CurrentSharePrincipalPolicy) => Promise<T>,
  ): Promise<T> => {
    input = {
      ...input,
      expectedGroupHead: input.expectedGroupHead
        ? { ...input.expectedGroupHead }
        : undefined,
    };
    return lease(
      input.stillCurrent,
      async ({ resolveCurrentPolicy, stillCurrent: leaseCurrent }) => {
        await runtime.apiClient.recoverPendingPrincipalMutation?.(
          input.organizationId,
        );
        assertProjectionVerificationCurrent(leaseCurrent);
        const authority = await loadCurrentOrganizationAuthority({
          execSql: runtime.infra.execSql,
          organizationId: input.organizationId,
          resolveCurrentPolicy,
          stillCurrent: leaseCurrent,
        });
        const group = await authority.readGroup(input.groupId);
        const stillCurrent = () =>
          leaseCurrent() && authority.stillCurrent() && group.stillCurrent();
        assertProjectionVerificationCurrent(stillCurrent);
        if (
          input.expectedGroupHead &&
          !principalHeadMatchesReference(
            group.policy.state,
            input.expectedGroupHead,
          )
        )
          throw new KeyingVerificationError(
            "object_mismatch",
            "Container share expected group head conflicts with the signed organization directory",
          );
        assertGroupMetadataBinding(group.current, authority.descriptor);
        await assertCurrentShareName({
          runtime,
          input,
          authority,
          group,
          stillCurrent,
        });
        assertProjectionVerificationCurrent(stillCurrent);
        const checkpointPolicies = [...group.dependencies, group.policy];
        await advanceKeyingCheckpointsAtomically({
          access: [],
          execSql: runtime.infra.execSql,
          organizationId: input.organizationId,
          policies: checkpointPolicies,
          stillCurrent,
        });
        assertProjectionVerificationCurrent(stillCurrent);
        const result = await work({
          current: group.current,
          policy: group.policy,
          checkpointPolicies,
          stillCurrent,
        });
        assertProjectionVerificationCurrent(stillCurrent);
        return result;
      },
    );
  };
}

async function assertCurrentShareName({
  runtime,
  input,
  authority,
  group,
  stillCurrent,
}: {
  runtime: CurrentShareRuntime;
  input: CurrentShareInput;
  authority: Awaited<ReturnType<typeof loadCurrentOrganizationAuthority>>;
  group: CurrentGroup;
  stillCurrent: () => boolean;
}) {
  if (input.expectedGroupName === undefined) return;
  const readName =
    input.readEncryptedName ??
    createRuntimeGroupMetadataAccess(
      runtime,
      input.organizationId,
      stillCurrent,
      createSelectedCurrentGroupMetadataContainerVerifier({
        authority,
        organizationId: input.organizationId,
        stillCurrent,
      }),
    ).readName;
  const mismatch = await groupPolicyNameMismatch(
    group.current,
    input.expectedGroupName,
    readName,
  );
  if (mismatch)
    throw new GroupShareNameMismatchError(
      mismatch === "forbidden_characters"
        ? "Container share group name contains control or format characters"
        : "Container share group name does not match the signed group policy",
    );
}
