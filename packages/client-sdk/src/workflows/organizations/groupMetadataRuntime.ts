import type { EncapsulationKeyPair } from "@tearleads/crypto";
import { createProjectionUserKeyResolver } from "../../data/keyingProjectionVerification/userKeyResolver";
import type { SecurityIncidentReporter } from "../../data/securityIncidents";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import { createRuntimePrincipalPolicyWarmer } from "../principals/runtimePolicyWarmer";
import {
  createGroupMetadataAccess,
  type GroupMetadataAccessInput,
} from "./groupMetadataAccess";
import { createGroupMetadataContainerVerifier } from "./groupMetadataContainerAuthority";
import type { PrincipalPolicyReadApi } from "./groupPolicyMutationContext";

interface GroupMetadataRuntime {
  readonly apiClient: GroupMetadataAccessInput["apiClient"] &
    PrincipalPolicyReadApi;
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
  const warmer = createRuntimePrincipalPolicyWarmer(runtime);
  return createGroupMetadataAccess({
    verifyMetadataContainer: createGroupMetadataContainerVerifier({
      apiClient: runtime.apiClient,
      execSql: runtime.infra.execSql,
      organizationId,
      resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
      stillCurrent: stillCurrent ?? (() => true),
    }),
    apiClient: runtime.apiClient,
    execSql: runtime.infra.execSql,
    organizationId,
    resolveProjectionUserKey: createProjectionUserKeyResolver(runtime),
    targetSecretKey,
    stillCurrent,
    warmReferencedPrincipalPolicies: warmer,
  });
}
