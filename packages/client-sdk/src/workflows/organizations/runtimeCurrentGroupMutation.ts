import type { ApiClient } from "@tearleads/api-client";
import type { PrincipalPolicyHistoryProgressOptions } from "@tearleads/crypto";
import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";
import type { CommitOrganizationGroupPolicyResponse } from "@tearleads/validators/response";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import type { CurrentPolicyReferenceResolver } from "../../data/principals/currentPolicyReferenceResolver";
import { readPrincipalHistoryProtection } from "../../data/principals/principalHistoryRuntime";
import {
  directoryHistoryProtection,
  scopedGroupHistoryProtection,
} from "../../data/principals/principalHistoryScopeProtection";
import { principalPolicyReferenceFromBundle } from "../../data/principals/principalPolicyAdminSigners";
import {
  createRuntimePrincipalPolicyCurrentResolver,
  type PrincipalPolicyRecoveryRuntime,
} from "../principals/runtimePolicyRecovery";
import { resolveCurrentGroupMutationReferences } from "./currentGroupMutationReferences";
import { loadCurrentGroupPolicyMutationContext } from "./currentGroupPolicyMutationContext";
import type { PrincipalMutationRecoveryApi } from "./principalMutationJournalManagement";
import {
  type AcknowledgedPrincipalCurrentInput,
  retainAcknowledgedPrincipalCurrents,
} from "./retainAcknowledgedPrincipalCurrents";

type MutationRuntime = PrincipalPolicyRecoveryRuntime & {
  readonly apiClient: PrincipalPolicyRecoveryRuntime["apiClient"] &
    Pick<PrincipalMutationRecoveryApi, "recoverPendingPrincipalMutation">;
};

type CurrentMutationContext = Awaited<
  ReturnType<typeof loadCurrentGroupPolicyMutationContext>
>;

export type RuntimeCurrentGroupMutationContext = CurrentMutationContext & {
  readonly resolveAuthoredPolicyReferences: CurrentPolicyReferenceResolver;
  readonly retainAcknowledged: (
    receipt: CurrentMutationReceipt,
  ) => Promise<void>;
};

interface CurrentMutationReceipt {
  readonly request: PutPrincipalPolicyRequest;
  readonly organizationRequest: PutPrincipalPolicyRequest;
  readonly response: CommitOrganizationGroupPolicyResponse;
  readonly retiredContainerIds?: readonly string[] | undefined;
}

interface MutationInput {
  readonly groupId: string;
  readonly organizationId: string;
  readonly signerUserId: string;
  readonly stillCurrent: () => boolean;
}

/** Keep private prefix custody inside the entire mutation and its acknowledgement. */
export function createRuntimeCurrentGroupMutation(runtime: MutationRuntime) {
  const lease = readPrincipalHistoryProtection(runtime);
  const resolveCurrentPolicy =
    createRuntimePrincipalPolicyCurrentResolver(runtime);
  const readPages = runtime.apiClient.getPrincipalPolicyPages?.bind(
    runtime.apiClient,
  );
  if (!lease || !resolveCurrentPolicy || !readPages) return undefined;
  return async <T>(
    input: MutationInput,
    work: (context: RuntimeCurrentGroupMutationContext) => Promise<T>,
  ): Promise<T> => {
    input = { ...input };
    return lease(async ({ protection, stillCurrent: leaseCurrent }) => {
      let active = true;
      const stillCurrent = () =>
        active && leaseCurrent() && input.stillCurrent();
      try {
        const context = await loadCurrentGroupPolicyMutationContext({
          ...input,
          execSql: runtime.infra.execSql,
          resolveCurrentPolicy,
          recoverPendingPrincipalMutation: (organizationId) =>
            runtime.apiClient.recoverPendingPrincipalMutation(organizationId),
          stillCurrent,
        });
        const result = await work({
          ...context,
          resolveAuthoredPolicyReferences: (current, references) =>
            resolveCurrentGroupMutationReferences({
              current,
              predecessor: context.verifiedCurrentPolicy,
              references,
              readPredecessorReference: context.readPredecessorReference,
              stillCurrent: context.stillCurrent,
            }),
          retainAcknowledged: createCurrentMutationRetention(
            runtime,
            input,
            context,
            protection,
            readPages,
          ),
        });
        assertProjectionVerificationCurrent(context.stillCurrent);
        return result;
      } finally {
        active = false;
      }
    });
  };
}

function createCurrentMutationRetention(
  runtime: MutationRuntime,
  input: MutationInput,
  context: CurrentMutationContext,
  protection: PrincipalPolicyHistoryProgressOptions,
  readPages: ApiClient["getPrincipalPolicyPages"],
) {
  const common = {
    apiClient: { getPrincipalPolicyPages: readPages },
    resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
  };
  const groupRecovery: AcknowledgedPrincipalCurrentInput["recovery"] = {
    ...common,
    expectedHead: principalPolicyReferenceFromBundle(context.currentPolicy),
    protection: context.isOrganizationAdminsGroup
      ? protection
      : scopedGroupHistoryProtection(
          protection,
          input.organizationId,
          context.adminGroupId,
        ),
    historyVerification: context.isOrganizationAdminsGroup
      ? "direct-admins"
      : "standard",
    ...(context.isOrganizationAdminsGroup
      ? {}
      : { loadExternalAuthority: async () => context.externalAuthority }),
  };
  const directoryRecovery: AcknowledgedPrincipalCurrentInput["recovery"] = {
    ...common,
    expectedHead: principalPolicyReferenceFromBundle(
      context.organizationCurrent.current,
    ),
    protection: directoryHistoryProtection(protection),
  };
  return async (receipt: CurrentMutationReceipt): Promise<void> => {
    assertProjectionVerificationCurrent(context.stillCurrent);
    await retainAcknowledgedPrincipalCurrents({
      execSql: runtime.infra.execSql,
      organizationId: input.organizationId,
      entries: [
        {
          recovery: groupRecovery,
          request: receipt.request,
          response: receipt.response.groupPolicy,
        },
        {
          recovery: directoryRecovery,
          request: receipt.organizationRequest,
          response: receipt.response.organizationPolicy,
        },
      ],
      retirements: [
        {
          principalId: input.groupId,
          principalType: "group",
          containerIds: receipt.retiredContainerIds ?? [],
        },
      ],
      stillCurrent: context.stillCurrent,
    });
  };
}
