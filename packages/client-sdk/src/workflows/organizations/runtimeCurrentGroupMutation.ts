import type { PrincipalPolicyHistoryProgressOptions } from "@tearleads/crypto";
import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";
import type { CommitOrganizationGroupPolicyResponse } from "@tearleads/validators/response";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import type { CurrentPolicyReferenceResolver } from "../../data/principals/currentPolicyReferenceResolver";
import { scopedGroupHistoryProtection } from "../../data/principals/principalHistoryScopeProtection";
import { principalPolicyReferenceFromBundle } from "../../data/principals/principalPolicyAdminSigners";
import type { PrincipalPolicyPageReader } from "../principals/principalPolicyHistoryReader";
import type { PrincipalPolicyRecoveryRuntime } from "../principals/runtimePolicyRecovery";
import { captureAcknowledgedPrincipalPredecessor } from "./acknowledgedPrincipalPredecessor";
import { resolveCurrentGroupMutationReferences } from "./currentGroupMutationReferences";
import { loadCurrentGroupPolicyMutationContext } from "./currentGroupPolicyMutationContext";
import { createCurrentPrincipalMutationLease } from "./currentPrincipalMutationLease";
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
  readonly loadGroup: (
    groupId: string,
  ) => Promise<RuntimeCurrentGroupMutationContext>;
  readonly groupRetention: Pick<
    AcknowledgedPrincipalCurrentInput,
    "recovery" | "predecessor"
  >;
  readonly retainAcknowledged: (
    receipt: CurrentMutationReceipt,
  ) => Promise<void>;
};

interface CurrentMutationReceipt {
  readonly additionalGroups?:
    | readonly (AcknowledgedPrincipalCurrentInput & {
        readonly retiredContainerIds?: readonly string[] | undefined;
      })[]
    | undefined;
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
  const lease = createCurrentPrincipalMutationLease(runtime);
  if (!lease) return undefined;
  return async <T>(
    input: MutationInput,
    work: (context: RuntimeCurrentGroupMutationContext) => Promise<T>,
  ): Promise<T> => {
    input = { ...input };
    return lease(
      input.stillCurrent,
      async ({
        protection,
        stillCurrent,
        resolveCurrentPolicy,
        historyReader,
        directoryRecovery,
      }) => {
        const loadGroup = async (
          groupId: string,
        ): Promise<RuntimeCurrentGroupMutationContext> => {
          const context = await loadCurrentGroupPolicyMutationContext({
            ...input,
            groupId,
            execSql: runtime.infra.execSql,
            resolveCurrentPolicy,
            recoverPendingPrincipalMutation: (organizationId) =>
              runtime.apiClient.recoverPendingPrincipalMutation(organizationId),
            stillCurrent,
          });
          const retention = await createCurrentMutationRetention(
            runtime,
            { ...input, groupId },
            context,
            protection,
            historyReader,
            directoryRecovery(context.organizationCurrent.current),
          );
          return {
            ...context,
            ...retention,
            loadGroup,
            resolveAuthoredPolicyReferences: (current, references) =>
              resolveCurrentGroupMutationReferences({
                current,
                predecessor: context.verifiedCurrentPolicy,
                references,
                readPredecessorReference: context.readPredecessorReference,
                stillCurrent: context.stillCurrent,
              }),
          };
        };
        const context = await loadGroup(input.groupId);
        const result = await work(context);
        assertProjectionVerificationCurrent(context.stillCurrent);
        return result;
      },
    );
  };
}

async function createCurrentMutationRetention(
  runtime: MutationRuntime,
  input: MutationInput,
  context: CurrentMutationContext,
  protection: PrincipalPolicyHistoryProgressOptions,
  historyReader: PrincipalPolicyPageReader,
  directoryRecovery: AcknowledgedPrincipalCurrentInput["recovery"],
) {
  const common = {
    historyReader,
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
  const capture = (recovery: AcknowledgedPrincipalCurrentInput["recovery"]) =>
    captureAcknowledgedPrincipalPredecessor({
      ...recovery,
      execSql: runtime.infra.execSql,
      organizationId: input.organizationId,
      stillCurrent: context.stillCurrent,
    });
  const groupPredecessor = await capture(groupRecovery);
  const directoryPredecessor = await capture(directoryRecovery);
  const retainAcknowledged = async (
    receipt: CurrentMutationReceipt,
  ): Promise<void> => {
    assertProjectionVerificationCurrent(context.stillCurrent);
    await retainAcknowledgedPrincipalCurrents({
      execSql: runtime.infra.execSql,
      organizationId: input.organizationId,
      entries: [
        ...(receipt.additionalGroups ?? []),
        {
          recovery: groupRecovery,
          predecessor: groupPredecessor,
          request: receipt.request,
          response: receipt.response.groupPolicy,
        },
        {
          recovery: directoryRecovery,
          predecessor: directoryPredecessor,
          request: receipt.organizationRequest,
          response: receipt.response.organizationPolicy,
        },
      ],
      retirements: [
        ...(receipt.additionalGroups ?? []).map((entry) => ({
          principalId: entry.request.state.principalId,
          principalType: "group" as const,
          containerIds: entry.retiredContainerIds ?? [],
        })),
        {
          principalId: input.groupId,
          principalType: "group",
          containerIds: receipt.retiredContainerIds ?? [],
        },
      ],
      stillCurrent: context.stillCurrent,
    });
  };
  return {
    groupRetention: { recovery: groupRecovery, predecessor: groupPredecessor },
    retainAcknowledged,
  };
}
