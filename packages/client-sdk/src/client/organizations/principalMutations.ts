import type { ContainerGrantSubjectType } from "@tearleads/crypto";
import { runWithSecurityIncidentReporting } from "../../data/keyingProjectionVerification/error";
import {
  addOrganizationGroupUser,
  createOrganizationGroup,
  removeOrganizationGroupUser,
  revokeOrganizationContainerGrant,
  rotateOrganizationGroupForAccessSetShrink,
} from "../../workflows/organizations";
import { createRuntimePrincipalPolicyWarmer } from "../../workflows/principals/runtimePolicyWarmer";
import type { ContainerContents } from "../containerContents";
import type { InternalWorkflowRuntimeInput } from "../workflowRuntime";
import { syncOrganizationMetadataProfile } from "./organizationMetadataProfileSync";
import type { OrganizationReadModelCoordinator } from "./organizationReadModels";
import { preparePrincipalContainerMutations } from "./principalContainerMutations";

export interface OrganizationGrantRef {
  containerId: string;
  subjectId: string;
  subjectType: ContainerGrantSubjectType;
}

export interface OrganizationGroupUserMutationInput {
  groupId: string;
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
      let memberGroupId: string | null = null;
      const bundle = await addOrganizationGroupUser({
        apiClient: input.runtime.apiClient,
        beforePolicyCommit: (_head, authority) => {
          memberGroupId = authority.memberGroupId;
        },
        currentUserSecretKey: requireEncapsulationKeyPair(input.runtime)
          .secretKey,
        execSql: input.runtime.infra.execSql,
        groupId: input.groupId,
        prepareContainerMutations: ({ nextPolicy }) =>
          preparePrincipalContainerMutations({
            groupId: input.groupId,
            nextPolicy,
            organizationId: signingContext.organizationId,
            readModelCoordinator: input.readModelCoordinator,
            runtime: input.runtime,
          }),
        resolveTrustedUserIdentity: input.runtime.resolveTrustedUserIdentity,
        targetUserId: input.targetUserId,
        ...signingContext,
      });
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
    () =>
      createOrganizationGroup({
        apiClient: input.runtime.apiClient,
        creatorEncapsulationKeyPair: requireEncapsulationKeyPair(input.runtime),
        execSql: input.runtime.infra.execSql,
        name: input.name,
        resolveTrustedUserIdentity: input.runtime.resolveTrustedUserIdentity,
        ...signingContext,
      }),
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
      let memberGroupId: string | null = null;
      const bundle = await removeOrganizationGroupUser({
        apiClient: input.runtime.apiClient,
        beforePolicyCommit: (_head, authority) => {
          memberGroupId = authority.memberGroupId;
        },
        execSql: input.runtime.infra.execSql,
        groupId: input.groupId,
        prepareContainerMutations: ({ nextPolicy }) =>
          preparePrincipalContainerMutations({
            groupId: input.groupId,
            nextPolicy,
            organizationId: signingContext.organizationId,
            readModelCoordinator: input.readModelCoordinator,
            runtime: input.runtime,
          }),
        removedUserId: input.removedUserId,
        resolveTrustedUserIdentity: input.runtime.resolveTrustedUserIdentity,
        ...signingContext,
      });
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
      const response =
        input.subjectType === "group"
          ? await rotateOrganizationGroupForAccessSetShrink({
              apiClient: input.runtime.apiClient,
              execSql: input.runtime.infra.execSql,
              groupId: input.subjectId,
              prepareContainerMutations: ({ nextPolicy }) =>
                preparePrincipalContainerMutations({
                  groupId: input.subjectId,
                  nextPolicy,
                  organizationId: signingContext.organizationId,
                  readModelCoordinator: input.readModelCoordinator,
                  revokedContainerId: input.containerId,
                  runtime: input.runtime,
                }),
              resolveTrustedUserIdentity:
                input.runtime.resolveTrustedUserIdentity,
              ...signingContext,
            })
          : await revokeOrganizationContainerGrant({
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
              warmReferencedPrincipalPolicies:
                createRuntimePrincipalPolicyWarmer(input.runtime),
              ...signingContext,
            });
      await input.readModelCoordinator.reconcileAfterMutation(
        signingContext.organizationId,
      );
      return response;
    },
  );
}
