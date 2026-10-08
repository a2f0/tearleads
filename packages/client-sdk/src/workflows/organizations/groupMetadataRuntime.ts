import type { EncapsulationKeyPair } from "@tearleads/crypto";
import { createProjectionUserKeyResolver } from "../../data/keyingProjectionVerification/userKeyResolver";
import type { SecurityIncidentReporter } from "../../data/securityIncidents";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import {
  createRuntimePrincipalPolicyCurrentResolver,
  type PrincipalPolicyRecoveryRuntime,
} from "../principals/runtimePolicyRecovery";
import { createRuntimePrincipalPolicyWarmer } from "../principals/runtimePolicyWarmer";
import { createCurrentGroupMetadataContainerVerifier } from "./currentGroupMetadataAuthority";
import {
  createGroupMetadataAccess,
  type GroupMetadataAccessInput,
} from "./groupMetadataAccess";
import { createGroupMetadataContainerVerifier } from "./groupMetadataContainerAuthority";
import type { PrincipalPolicyReadApi } from "./groupPolicyMutationContext";

interface GroupMetadataRuntime {
  readonly state?: PrincipalPolicyRecoveryRuntime["state"];
  readonly apiClient: GroupMetadataAccessInput["apiClient"] &
    PrincipalPolicyReadApi &
    PrincipalPolicyRecoveryRuntime["apiClient"];
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
  currentRecovery?: {
    readonly resolveCurrentPolicy: ReturnType<
      typeof createRuntimePrincipalPolicyCurrentResolver
    >;
    readonly recoveryBatch: object;
  },
) {
  const targetSecretKey = runtime.crypto.encapsulationKeyPair?.secretKey;
  if (!targetSecretKey) throw new Error("Group metadata identity is locked");
  const warmer = createRuntimePrincipalPolicyWarmer(runtime);
  const resolveCurrentPolicy =
    currentRecovery?.resolveCurrentPolicy ??
    createRuntimePrincipalPolicyCurrentResolver(runtime);
  const authorityInput = {
    apiClient: runtime.apiClient,
    execSql: runtime.infra.execSql,
    organizationId,
    reportSecurityIncident: runtime.util.reportSecurityIncident,
    resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
    stillCurrent: stillCurrent ?? (() => true),
  };
  return createGroupMetadataAccess({
    verifyMetadataContainer: resolveCurrentPolicy
      ? createCurrentGroupMetadataContainerVerifier({
          ...authorityInput,
          resolveCurrentPolicy,
          recoveryBatch: currentRecovery?.recoveryBatch,
        })
      : createGroupMetadataContainerVerifier(authorityInput),
    apiClient: runtime.apiClient,
    execSql: runtime.infra.execSql,
    organizationId,
    resolveProjectionUserKey: createProjectionUserKeyResolver(runtime),
    targetSecretKey,
    stillCurrent,
    warmReferencedPrincipalPolicies: warmer,
  });
}
