import type { ContainerGrantSubjectType } from "@tearleads/crypto";
import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";
import { runWithSecurityIncidentReporting } from "../../data/keyingProjectionVerification/error";
import { revokeOrganizationContainerGrant } from "../../workflows/organizations";
import { createCurrentOrganizationGroup } from "../../workflows/organizations/createCurrentOrganizationGroup";
import { createSelectedCurrentGroupMetadataContainerVerifier } from "../../workflows/organizations/currentGroupMetadataAuthority";
import { deleteCurrentOrganizationGroup } from "../../workflows/organizations/deleteCurrentOrganizationGroup";
import { createRuntimeGroupMetadataAccess } from "../../workflows/organizations/groupMetadataRuntime";
import { createRuntimeCurrentOrganizationMutation } from "../../workflows/organizations/runtimeCurrentOrganizationMutation";
import { createRuntimePrincipalPolicyWarmer } from "../../workflows/principals/runtimePolicyWarmer";
import type { ContainerContents } from "../containerContents";
import type { InternalWorkflowRuntimeInput } from "../workflowRuntime";
import { createCurrentPrincipalMutation } from "./currentPrincipalMutations";
import { syncOrganizationMetadataProfile } from "./organizationMetadataProfileSync";
import type { OrganizationReadModelCoordinator } from "./organizationReadModels";

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
  organizationId: string;
  signerUserId: string;
  signingFingerprint: string;
  signingKeyPair: NonNullable<
    InternalWorkflowRuntimeInput["crypto"]["signingKeyPair"]
  >;
}

function requireSigningContext(
  runtime: InternalWorkflowRuntimeInput,
): OrganizationSigningContext {
  if (
    !runtime.auth.organizationId ||
    !runtime.auth.userId ||
    !runtime.crypto.signingFingerprint ||
    !runtime.crypto.signingKeyPair
  ) {
    throw new Error("Organization signing context is unavailable");
  }

  return {
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

interface PrincipalMutationRuntime {
  readonly stillCurrent: () => boolean;
  readonly containerContents: ContainerContents;
  readonly readModelCoordinator: OrganizationReadModelCoordinator;
  readonly runtime: InternalWorkflowRuntimeInput;
}

export async function addUserToOrganizationGroup(
  input: PrincipalMutationRuntime & AddOrganizationGroupUserInput,
) {
  const signingContext = requireSigningContext(input.runtime);
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
      const { memberGroupId, response: bundle } = await mutateCurrent(
        input.groupId,
        {
          kind: "add",
          expectedGroupName: input.expectedGroupName,
          targetUserId: input.targetUserId,
        },
      );
      if (input.groupId === memberGroupId) {
        await syncOrganizationMetadataProfile({
          containerContents: input.containerContents,
          log: input.runtime.util.log,
          organizationId: signingContext.organizationId,
        });
      }
      await input.readModelCoordinator.reconcileAfterMutation(
        signingContext.organizationId,
      );
      return bundle;
    },
  );
}

export function createGroupForOrganization(input: {
  readonly name: string;
  readonly runtime: InternalWorkflowRuntimeInput;
  readonly stillCurrent: () => boolean;
}) {
  const signingContext = requireSigningContext(input.runtime);
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

export function deleteGroupForOrganization(input: {
  readonly groupId: string;
  readonly runtime: InternalWorkflowRuntimeInput;
  readonly stillCurrent: () => boolean;
}) {
  const signingContext = requireSigningContext(input.runtime);
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
  const signingContext = requireSigningContext(input.runtime);
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
      await input.readModelCoordinator.reconcileAfterMutation(
        signingContext.organizationId,
      );
      return bundle;
    },
  );
}

export async function revokeOrganizationGrant(
  input: PrincipalMutationRuntime & OrganizationGrantRef,
) {
  const signingContext = requireSigningContext(input.runtime);
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
        } else {
          return revokeOrganizationContainerGrant({
            stillCurrent: input.stillCurrent,
            reportSecurityIncident: input.runtime.util.reportSecurityIncident,
            apiClient: input.runtime.apiClient,
            containerId: input.containerId,
            encapsulationKeyPair,
            execSql: input.runtime.infra.execSql,
            revokedSubject: {
              subjectId: input.subjectId,
              subjectType: input.subjectType,
            },
            resolveTrustedUserIdentity:
              input.runtime.resolveTrustedUserIdentity,
            warmReferencedPrincipalPolicies: createRuntimePrincipalPolicyWarmer(
              input.runtime,
            ),
            ...signingContext,
          });
        }
      };
      const response = await revoke();
      await input.readModelCoordinator.reconcileAfterMutation(
        signingContext.organizationId,
      );
      return response;
    },
  );
}
