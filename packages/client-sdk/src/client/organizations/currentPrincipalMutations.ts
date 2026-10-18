import type { SigningKeyPair } from "@tearleads/crypto";
import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { commitCurrentGroupPolicyMutation } from "../../workflows/organizations/commitCurrentGroupPolicyMutation";
import { assertGroupMembershipName } from "../../workflows/organizations/groupMembershipName";
import { createRuntimeGroupMetadataAccess } from "../../workflows/organizations/groupMetadataRuntime";
import {
  buildAddGroupUserPolicyRequest,
  buildGroupAccessSetShrinkPolicyRequest,
  buildRemoveGroupUserPolicyRequest,
} from "../../workflows/organizations/groupPolicyRequests";
import {
  createRuntimeCurrentGroupMutation,
  type RuntimeCurrentGroupMutationContext,
} from "../../workflows/organizations/runtimeCurrentGroupMutation";
import {
  projectionUserIds,
  resolveRequiredUserIdentities,
} from "../../workflows/organizations/trustedOrganizationUsers";
import type { InternalWorkflowRuntimeInput } from "../runtime/workflowRuntime";
import { preparePrincipalContainerMutations } from "./principalContainerMutations";

type CurrentGroupMutation =
  | {
      readonly kind: "add";
      readonly expectedGroupName: string;
      readonly targetUserId: string;
    }
  | {
      readonly kind: "remove";
      readonly expectedGroupName: string;
      readonly removedUserId: string;
    }
  | { readonly kind: "revoke"; readonly revokedContainerId: string };

/** Built-in hosts with private custody use bounded current-policy mutation work. */
interface CurrentPrincipalMutationInput {
  readonly runtime: InternalWorkflowRuntimeInput;
  readonly organizationId: string;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: SigningKeyPair;
  readonly stillCurrent: () => boolean;
}

export function createCurrentPrincipalMutation(
  input: CurrentPrincipalMutationInput,
) {
  const mutate = createRuntimeCurrentGroupMutation(input.runtime);
  if (!mutate) return undefined;
  return (groupId: string, mutation: CurrentGroupMutation) =>
    mutate(
      {
        groupId,
        organizationId: input.organizationId,
        signerUserId: input.signerUserId,
        stillCurrent: input.stillCurrent,
      },
      async (context) => {
        const prepareChange = async (
          selected: RuntimeCurrentGroupMutationContext,
          change: CurrentGroupMutation,
        ) => ({
          context: selected,
          request: await buildCurrentMutationRequest(input, selected, change),
          prepareContainerMutations: (
            nextPolicy: Parameters<
              typeof preparePrincipalContainerMutations
            >[0]["nextPolicy"],
            preceding?: Parameters<
              typeof preparePrincipalContainerMutations
            >[0]["preceding"],
          ) =>
            preparePrincipalContainerMutations({
              preceding,
              currentPolicy: selected.currentPolicy,
              nextPolicy,
              groupId: selected.currentPolicy.currentState.principalId,
              organizationId: input.organizationId,
              runtime: input.runtime,
              stillCurrent: selected.stillCurrent,
              recitationStillCurrent: input.stillCurrent,
              resolveAuthoredPolicyReferences:
                selected.resolveAuthoredPolicyReferences,
              revokedContainerId:
                change.kind === "revoke"
                  ? change.revokedContainerId
                  : undefined,
            }),
        });
        const primary = await prepareChange(context, mutation);
        let member: Awaited<ReturnType<typeof prepareChange>> | undefined;
        if (mutation.kind === "add" && groupId !== context.memberGroupId) {
          const members = await context.loadGroup(context.memberGroupId);
          if (
            !members.currentPolicy.currentProjection.some(
              (entry) => entry.userId === mutation.targetUserId,
            )
          ) {
            member = await prepareChange(members, {
              ...mutation,
              expectedGroupName: "Members",
            });
          }
        }
        assertProjectionVerificationCurrent(context.stillCurrent);
        const response = await commitCurrentGroupPolicyMutation({
          ...input,
          apiClient: input.runtime.apiClient,
          groupId,
          ...primary,
          member,
          resolveTrustedUserIdentity: input.runtime.resolveTrustedUserIdentity,
        });
        return {
          response,
          memberGroupId: context.memberGroupId,
          enrolled: Boolean(member),
        };
      },
    );
}

async function buildCurrentMutationRequest(
  input: CurrentPrincipalMutationInput,
  context: RuntimeCurrentGroupMutationContext,
  mutation: CurrentGroupMutation,
): Promise<PutPrincipalPolicyRequest> {
  const shared = {
    ...context,
    signerUserId: input.signerUserId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
  };
  if (mutation.kind !== "revoke") {
    await assertGroupMembershipName(
      context.currentPolicy,
      mutation.expectedGroupName,
      createRuntimeGroupMetadataAccess(
        input.runtime,
        input.organizationId,
        context.stillCurrent,
        context.verifyMetadataContainer,
      ).readName,
    );
  }
  const resolveUsers = (userIds: readonly string[]) =>
    resolveRequiredUserIdentities({
      resolveTrustedUserIdentity: input.runtime.resolveTrustedUserIdentity,
      userIds,
    });
  const projection = context.currentPolicy.currentProjection;
  let request: PutPrincipalPolicyRequest;
  if (mutation.kind === "add") {
    const currentUserSecretKey =
      input.runtime.crypto.encapsulationKeyPair?.secretKey;
    if (!currentUserSecretKey)
      throw new Error("Organization encryption context is unavailable");
    const identities = await resolveUsers([
      ...projectionUserIds(projection),
      mutation.targetUserId,
    ]);
    const targetUser = identities.find(
      (identity) => identity.userId === mutation.targetUserId,
    );
    if (!targetUser) throw new Error("Group target identity is unavailable");
    request = await buildAddGroupUserPolicyRequest({
      ...shared,
      currentUserSecretKey,
      targetUser,
      currentUsers: identities.filter(
        (identity) => identity.userId !== mutation.targetUserId,
      ),
      reportSecurityIncident: input.runtime.util.reportSecurityIncident,
    });
  } else if (mutation.kind === "remove") {
    request = await buildRemoveGroupUserPolicyRequest({
      ...shared,
      removedUserId: mutation.removedUserId,
      remainingUsers: await resolveUsers(
        projectionUserIds(
          projection.filter(
            (member) => member.userId !== mutation.removedUserId,
          ),
        ),
      ),
    });
  } else {
    request = await buildGroupAccessSetShrinkPolicyRequest({
      ...shared,
      revokedContainerId: mutation.revokedContainerId,
      currentUsers: await resolveUsers(projectionUserIds(projection)),
    });
  }

  return request;
}
