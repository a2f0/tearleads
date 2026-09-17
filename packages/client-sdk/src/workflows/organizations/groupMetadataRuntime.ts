import type { EncapsulationKeyPair } from "@tearleads/crypto";
import type { ContainerKekLogResponse } from "@tearleads/validators/response";
import { createProjectionUserKeyResolver } from "../../data/keyingProjectionVerification/userKeyResolver";
import type { SecurityIncidentReporter } from "../../data/securityIncidents";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import { createRuntimePrincipalPolicyWarmer } from "../principals/runtimePolicyWarmer";
import {
  createGroupMetadataAccess,
  type GroupMetadataAccessInput,
} from "./groupMetadataAccess";
import { recoverGroupMetadataReadKey } from "./groupMetadataKeyRecovery";
import type { PrincipalPolicyReadApi } from "./groupPolicyMutationContext";
import { loadGroupNameDirectoryAuthority } from "./organizationGroupNamePolicies";

interface GroupMetadataRuntime {
  readonly apiClient: GroupMetadataAccessInput["apiClient"] &
    PrincipalPolicyReadApi & {
      getContainerKekLog?(
        containerId: string,
        options?: { afterKeyEpoch?: number; keyringForEpoch?: number },
      ): Promise<ContainerKekLogResponse | null>;
    };
  readonly crypto: {
    readonly encapsulationKeyPair: EncapsulationKeyPair | null;
  };
  readonly infra: { readonly execSql: ExecSql };
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly util: {
    readonly log: (message: string) => void;
    readonly reportSecurityIncident: SecurityIncidentReporter;
  };
}

export function createRuntimeGroupMetadataAccess(
  runtime: GroupMetadataRuntime,
  organizationId: string,
  stillCurrent?: () => boolean,
) {
  const targetSecretKey = runtime.crypto.encapsulationKeyPair?.secretKey;
  if (!targetSecretKey) throw new Error("Group metadata identity is locked");
  const getLog = runtime.apiClient.getContainerKekLog;
  const warmer = createRuntimePrincipalPolicyWarmer(runtime);
  return createGroupMetadataAccess({
    apiClient: runtime.apiClient,
    execSql: runtime.infra.execSql,
    organizationId,
    resolveProjectionUserKey: createProjectionUserKeyResolver(runtime),
    targetSecretKey,
    stillCurrent,
    warmReferencedPrincipalPolicies: warmer,
    recoverReadKey: getLog
      ? (metadata) =>
          recoverGroupMetadataReadKey({
            apiClient: {
              getContainerKekLog: (id, options) =>
                getLog.call(runtime.apiClient, id, options),
            },
            execSql: runtime.infra.execSql,
            metadata,
            targetSecretKey,
            stillCurrent,
            warmKeys: async () => {
              const authority = await loadGroupNameDirectoryAuthority({
                apiClient: runtime.apiClient,
                execSql: runtime.infra.execSql,
                organizationId,
                resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
                stillCurrent: stillCurrent ?? (() => true),
              });
              if (!authority)
                throw new Error(
                  "Group metadata directory authority is unavailable",
                );
              await warmer({
                organizationId,
                references: authority.descriptor.groupHeads.filter(
                  (head) => head.principalId === authority.memberGroupId,
                ),
                stillCurrent,
              });
            },
          })
      : undefined,
  });
}
