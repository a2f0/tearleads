import type { EncapsulationKeyPair } from "@tearleads/crypto";
import { ProjectionDependencyUnavailableError } from "../../../data/keyingProjectionVerification/dependencyUnavailable";
import { createProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification/userKeyResolver";
import type { SecurityIncidentReporter } from "../../../data/shared/securityIncidents";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../../data/trustedUserIdentity";
import type { PrincipalPolicyService } from "../../principals/principalPolicyService";
import type { PrincipalPolicyCurrentResolver } from "../../principals/runtimePolicyRecovery";
import type { PrincipalPolicyReadApi } from "../groupPolicy/groupPolicyMutationContext";
import { createCurrentGroupMetadataContainerVerifier } from "./currentGroupMetadataAuthority";
import {
  createGroupMetadataAccess,
  type GroupMetadataAccessInput,
} from "./groupMetadataAccess";

interface GroupMetadataRuntime {
  readonly apiClient: GroupMetadataAccessInput["apiClient"] &
    PrincipalPolicyReadApi;
  readonly crypto: {
    readonly encapsulationKeyPair: EncapsulationKeyPair | null;
  };
  readonly infra: { readonly execSql: ExecSql };
  readonly principalPolicies: PrincipalPolicyService;
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
  verifyMetadataContainer?: GroupMetadataAccessInput["verifyMetadataContainer"],
  currentRecovery?: {
    readonly resolveCurrentPolicy: PrincipalPolicyCurrentResolver | undefined;
    readonly recoveryBatch: object;
  },
) {
  const targetSecretKey = runtime.crypto.encapsulationKeyPair?.secretKey;
  if (!targetSecretKey) throw new Error("Group metadata identity is locked");
  // The signed metadata projection selects exact citations. Reuse matching
  // private evidence with its dependencies and pins before bounded online reads.
  const warmer = runtime.principalPolicies.createWarmer({
    preferLocalCurrent: true,
  });
  const resolveCurrentPolicy =
    currentRecovery?.resolveCurrentPolicy ??
    runtime.principalPolicies.createCurrentPolicyResolver();
  const authorityInput = {
    apiClient: runtime.apiClient,
    execSql: runtime.infra.execSql,
    organizationId,
    reportSecurityIncident: runtime.util.reportSecurityIncident,
    resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
    stillCurrent: stillCurrent ?? (() => true),
  };
  return createGroupMetadataAccess({
    verifyMetadataContainer:
      verifyMetadataContainer ??
      createCurrentGroupMetadataContainerVerifier({
        ...authorityInput,
        resolveCurrentPolicy: requireCurrentResolver(resolveCurrentPolicy),
        recoveryBatch: currentRecovery?.recoveryBatch,
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

function requireCurrentResolver(
  resolve: PrincipalPolicyCurrentResolver | undefined,
) {
  if (!resolve)
    throw new ProjectionDependencyUnavailableError(
      "Group metadata requires private paged recovery",
    );
  return resolve;
}
