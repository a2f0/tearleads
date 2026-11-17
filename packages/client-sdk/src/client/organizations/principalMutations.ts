import type { ContainerGrantSubjectType } from "@tearleads/crypto";
import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";
import { runWithSecurityIncidentReporting } from "../../data/keyingProjectionVerification/error";
import { ContainerMutationService } from "../../workflows/containers";
import { revokeOrganizationContainerGrant } from "../../workflows/organizations";
import { createSelectedCurrentGroupMetadataContainerVerifier } from "../../workflows/organizations/groupMetadata/currentGroupMetadataAuthority";
import { createRuntimeGroupMetadataAccess } from "../../workflows/organizations/groupMetadata/groupMetadataRuntime";
import { createCurrentOrganizationGroup } from "../../workflows/organizations/groups/createCurrentOrganizationGroup";
import { deleteCurrentOrganizationGroup } from "../../workflows/organizations/groups/deleteCurrentOrganizationGroup";
import { createRuntimeCurrentOrganizationMutation } from "../../workflows/organizations/principalMutations/runtimeCurrentOrganizationMutation";

import type { ContainerContents } from "../containerContents";
import type { InternalWorkflowRuntimeInput } from "../runtime/workflowRuntime";
import { createCurrentPrincipalMutation } from "./currentPrincipalMutations";
import { syncOrganizationMetadataProfile } from "./organizationMetadataProfileSync";
import type { OrganizationReadModelCoordinator } from "./organizationReadModels";
import type { GroupMemberAdmission } from "./recipientAdmission";

export interface OrganizationGrantRef {
  containerId: string;
  subjectId: string;
  subjectType: ContainerGrantSubjectType;
}

export interface OrganizationGroupUserMutationInput {
  groupId: string;
  expectedGroupName: string;
}

export interface AddOrganizationGroupUserInput
  extends OrganizationGroupUserMutationInput {
  targetUserId: string;
}

export interface RemoveOrganizationGroupUserInput
  extends OrganizationGroupUserMutationInput {
  removedUserId: string;
}

interface OrganizationSigningContext {
  identityTrustDomain: string;
  organizationId: string;
  signerUserId: string;
  signingFingerprint: string;
  signingKeyPair: NonNullable<
    InternalWorkflowRuntimeInput["crypto"]["signingKeyPair"]
  >;
}

/** The client's fixed trust domain and the mutation's runtime snapshot. */
interface OrganizationMutationScope {
  readonly identityTrustDomain: string | null;
  readonly runtime: InternalWorkflowRuntimeInput;
}

function requireSigningContext({
  identityTrustDomain,
  runtime,
}: OrganizationMutationScope): OrganizationSigningContext {
  if (
    !identityTrustDomain ||
    !runtime.auth.organizationId ||
    !runtime.auth.userId ||
    !runtime.crypto.signingFingerprint ||
    !runtime.crypto.signingKeyPair
  ) {
    throw new Error("Organization signing context is unavailable");
  }

  return {
    identityTrustDomain,
    organizationId: runtime.auth.organizationId,
    signerUserId: runtime.auth.userId,
    signingFingerprint: runtime.crypto.signingFingerprint,
    signingKeyPair: runtime.crypto.signingKeyPair,
  };
}

function requireEncapsulationKeyPair(
  runtime: InternalWorkflowRuntimeInput,
): NonNullable<InternalWorkflowRuntimeInput["crypto"]["encapsulationKeyPair"]> {
  if (!runtime.crypto.encapsulationKeyPair) {
    throw new Error("Organization encryption context is unavailable");
  }

  return runtime.crypto.encapsulationKeyPair;
}

interface PrincipalMutationRuntime extends OrganizationMutationScope {
  readonly stillCurrent: () => boolean;
  readonly containerContents: ContainerContents;
  readonly readModelCoordinator: OrganizationReadModelCoordinator;
}

export async function addUserToOrganizationGroup(
  input: PrincipalMutationRuntime &
    AddOrganizationGroupUserInput & {
      readonly admission: GroupMemberAdmission;
    },
) {
  const signingContext = requireSigningContext(input);
  return runWithSecurityIncidentReporting(
    input.runtime.util.reportSecurityIncident,
    {
      objectId: input.groupId,
      objectKind: "principal",
      operation: "group.member.add",
      organizationId: signingContext.organizationId,
    },
    async () => {
      const mutateCurrent = createCurrentPrincipalMutation({
        ...signingContext,
        runtime: input.runtime,
        stillCurrent: input.stillCurrent,
      });
      if (!mutateCurrent)
        throw new ProjectionDependencyUnavailableError(
          "Principal history recovery is unavailable",
        );
      const {
        memberGroupId,
        response: bundle,
        enrolled,
      } = await mutateCurrent(input.groupId, {
        kind: "add",
        expectedGroupName: input.expectedGroupName,
        targetUserId: input.targetUserId,
        admission: input.admission,
      });
      if (input.groupId === memberGroupId || enrolled) {
        await syncOrganizationMetadataProfile({
          containerContents: input.containerContents,
          log: input.runtime.util.log,
          organizationId: signingContext.organizationId,
        });
      }
      // The verified post-commit read is the mutation's own: callers apply
      // this directory instead of reading the read model a second time.
      const directoryAndGroups =
        await input.readModelCoordinator.reconcileAfterMutation(
          signingContext.organizationId,
        );
      return { directoryAndGroups, receipt: bundle };
    },
  );
}

export function createGroupForOrganization(
  input: OrganizationMutationScope & {
    readonly name: string;
    readonly stillCurrent: () => boolean;
  },
) {
  const signingContext = requireSigningContext(input);
  return runWithSecurityIncidentReporting(
    input.runtime.util.reportSecurityIncident,
    {
      objectId: signingContext.organizationId,
      objectKind: "principal",
      operation: "group.create",
      organizationId: signingContext.organizationId,
    },
    () => {
      const creatorEncapsulationKeyPair = requireEncapsulationKeyPair(
        input.runtime,
      );
      const mutate = createRuntimeCurrentOrganizationMutation(input.runtime);
      if (!mutate)
        throw new ProjectionDependencyUnavailableError(
          "Principal history recovery is unavailable",
        );
      return mutate(
        { ...signingContext, stillCurrent: input.stillCurrent },
        (context) =>
          createCurrentOrganizationGroup({
            ...signingContext,
            context,
            apiClient: input.runtime.apiClient,
            creatorEncapsulationKeyPair,
            execSql: input.runtime.infra.execSql,
            name: input.name,
            metadataAccess: createRuntimeGroupMetadataAccess(
              input.runtime,
              signingContext.organizationId,
              context.stillCurrent,
              createSelectedCurrentGroupMetadataContainerVerifier({
                authority: context,
                organizationId: signingContext.organizationId,
                stillCurrent: context.stillCurrent,
              }),
            ),
            reportSecurityIncident: input.runtime.util.reportSecurityIncident,
            resolveTrustedUserIdentity:
              input.runtime.resolveTrustedUserIdentity,
          }),
      );
    },
  );
}

export function deleteGroupForOrganization(
  input: OrganizationMutationScope & {
    readonly groupId: string;
    readonly stillCurrent: () => boolean;
  },
) {
  const signingContext = requireSigningContext(input);
  return runWithSecurityIncidentReporting(
    input.runtime.util.reportSecurityIncident,
    {
      objectId: input.groupId,
      objectKind: "principal",
      operation: "group.delete",
      organizationId: signingContext.organizationId,
    },
    () => {
      const mutate = createRuntimeCurrentOrganizationMutation(input.runtime);
      if (!mutate)
        throw new ProjectionDependencyUnavailableError(
          "Principal history recovery is unavailable",
        );
      return mutate(
        { ...signingContext, stillCurrent: input.stillCurrent },
        (context) =>
          deleteCurrentOrganizationGroup({
            ...signingContext,
            context,
            groupId: input.groupId,
            apiClient: input.runtime.apiClient,
            resolveTrustedUserIdentity:
              input.runtime.resolveTrustedUserIdentity,
          }),
      );
    },
  );
}

export async function removeUserFromOrganizationGroup(
  input: PrincipalMutationRuntime & RemoveOrganizationGroupUserInput,
) {
  const signingContext = requireSigningContext(input);
  return runWithSecurityIncidentReporting(
    input.runtime.util.reportSecurityIncident,
    {
      objectId: input.groupId,
      objectKind: "principal",
      operation: "group.member.remove",
      organizationId: signingContext.organizationId,
    },
    async () => {
      const mutateCurrent = createCurrentPrincipalMutation({
        ...signingContext,
        runtime: input.runtime,
        stillCurrent: input.stillCurrent,
      });
      if (!mutateCurrent)
        throw new ProjectionDependencyUnavailableError(
          "Principal history recovery is unavailable",
        );
      const { memberGroupId, response: bundle } = await mutateCurrent(
        input.groupId,
        {
          kind: "remove",
          expectedGroupName: input.expectedGroupName,
          removedUserId: input.removedUserId,
        },
      );
      if (input.groupId === memberGroupId) {
        await syncOrganizationMetadataProfile({
          containerContents: input.containerContents,
          log: input.runtime.util.log,
          organizationId: signingContext.organizationId,
        });
      }
      // The verified post-commit read is the mutation's own: callers apply
      // this directory instead of reading the read model a second time.
      const directoryAndGroups =
        await input.readModelCoordinator.reconcileAfterMutation(
          signingContext.organizationId,
        );
      return { directoryAndGroups, receipt: bundle };
    },
  );
}

export async function revokeOrganizationGrant(
  input: PrincipalMutationRuntime & OrganizationGrantRef,
) {
  const signingContext = requireSigningContext(input);
  const encapsulationKeyPair = requireEncapsulationKeyPair(input.runtime);
  if (input.runtime.infra.dbStatus !== "ready") {
    throw new Error("Organization local database is unavailable");
  }

  return runWithSecurityIncidentReporting(
    input.runtime.util.reportSecurityIncident,
    {
      objectId: input.subjectId,
      objectKind: "principal",
      operation: "principal.grant.revoke",
      organizationId: signingContext.organizationId,
    },
    async () => {
      const revoke = async () => {
        if (input.subjectType === "group") {
          const mutateCurrent = createCurrentPrincipalMutation({
            ...signingContext,
            runtime: input.runtime,
            stillCurrent: input.stillCurrent,
          });
          if (!mutateCurrent)
            throw new ProjectionDependencyUnavailableError(
              "Principal history recovery is unavailable",
            );
          return (
            await mutateCurrent(input.subjectId, {
              kind: "revoke",
              revokedContainerId: input.containerId,
            })
          ).response;
        }
        return revokeOrganizationContainerGrant({
          stillCurrent: input.stillCurrent,
          containerId: input.containerId,
          containers: new ContainerMutationService({
            api: input.runtime.apiClient,
            encapsulationSecretKey: encapsulationKeyPair.secretKey,
            execSql: input.runtime.infra.execSql,
            reportSecurityIncident: input.runtime.util.reportSecurityIncident,
            resolveTrustedUserIdentity:
              input.runtime.resolveTrustedUserIdentity,
          }),
          revokedSubject: {
            subjectId: input.subjectId,
            subjectType: input.subjectType,
          },
          resolveTrustedUserIdentity: input.runtime.resolveTrustedUserIdentity,
          warmReferencedPrincipalPolicies:
            input.runtime.principalPolicies.createWarmer(),
          ...signingContext,
        });
      };
      const response = await revoke();
      await input.readModelCoordinator.reconcileAfterMutation(
        signingContext.organizationId,
      );
      return response;
    },
  );
}
