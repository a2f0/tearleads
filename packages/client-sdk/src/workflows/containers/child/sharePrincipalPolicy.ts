import type {
  ManagedPrincipalKind,
  PrincipalPolicyCheckpoint,
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import type { ContainerShareApi } from "../../../data/containers/shared/types";
import { throwKeyingVerificationErrorWithContext } from "../../../data/keyingProjectionVerification/error";
import { advanceKeyingCheckpointsAtomically } from "../../../data/persistence/keyingCheckpointAdvancePersistence";
import { loadPrincipalPolicyVerificationCheckpoint } from "../../../data/persistence/principalPolicyCheckpointSelection";
import {
  retainVerifiedPrincipalPolicyBundle,
  savePrincipalPolicyBundle,
} from "../../../data/persistence/principalPolicyPersistence";
import { loadPrincipalPolicyBundleForReference } from "../../../data/persistence/principalPolicyReferencePersistence";
import {
  principalPolicyReferenceFromBundle,
  verifyPrincipalPolicyBundleWithExternalOrganizationAdmins,
} from "../../../data/principals/principalPolicyAdminSigners";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../../data/trustedUserIdentity";
import {
  externalAdminPolicyPersistenceEntries,
  loadOrganizationExternalAdminPolicy,
  type VerifiedExternalAdminPolicy,
} from "../../principals/externalAdminPolicy";
import {
  collectPrincipalPolicySignerPublicKeys,
  type PrincipalPolicySignerPublicKeyLoadErrorCode,
} from "../../principals/policyVerification";

export interface ContainerManagedPrincipalShareApi extends ContainerShareApi {
  getCurrentPrincipalPolicy: (
    principalType: ManagedPrincipalKind,
    principalId: string,
  ) => Promise<PrincipalPolicyBundleResponse | null>;
}

export interface VerifiedSharePrincipalPolicy {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly checkpointPolicies: readonly VerifiedPrincipalPolicy[];
  readonly dependencyBundles: readonly PrincipalPolicyBundleResponse[];
  readonly policy: VerifiedPrincipalPolicy;
}

async function retainVerifiedSharePolicies(input: {
  bundle: PrincipalPolicyBundleResponse;
  execSql: ExecSql;
  organizationPolicy: VerifiedExternalAdminPolicy | null;
  policy: VerifiedPrincipalPolicy;
}): Promise<VerifiedPrincipalPolicy[]> {
  const retainedAt = new Date().toISOString();
  if (input.organizationPolicy) {
    for (const entry of externalAdminPolicyPersistenceEntries(
      input.organizationPolicy,
    )) {
      await retainVerifiedPrincipalPolicyBundle({
        ...entry,
        execSql: input.execSql,
        updatedAt: retainedAt,
      });
    }
  }
  await retainVerifiedPrincipalPolicyBundle({
    bundle: input.bundle,
    execSql: input.execSql,
    policy: input.policy,
    updatedAt: retainedAt,
  });
  return [
    ...(input.organizationPolicy
      ? externalAdminPolicyPersistenceEntries(input.organizationPolicy).map(
          (entry) => entry.policy,
        )
      : []),
    input.policy,
  ];
}

async function advanceAndSaveVerifiedSharePolicies(input: {
  checkpointPolicies: readonly VerifiedPrincipalPolicy[];
  execSql: ExecSql;
  organizationPolicy: VerifiedExternalAdminPolicy | null;
}): Promise<void> {
  await advanceKeyingCheckpointsAtomically({
    access: [],
    execSql: input.execSql,
    policies: input.checkpointPolicies,
  });
  if (!input.organizationPolicy) {
    return;
  }
  for (const dependency of externalAdminPolicyPersistenceEntries(
    input.organizationPolicy,
  )) {
    await savePrincipalPolicyBundle(
      input.execSql,
      dependency.bundle,
      new Date().toISOString(),
    );
  }
}

function assertGroupPolicyTarget(
  bundle: PrincipalPolicyBundleResponse,
  groupId: string,
): void {
  if (
    bundle.currentState.principalType !== "group" ||
    bundle.currentState.principalId !== groupId
  ) {
    throw new Error("Container share principal policy target mismatch");
  }
}

function signerPublicKeyLoadErrorMessage(
  code: PrincipalPolicySignerPublicKeyLoadErrorCode,
): string {
  switch (code) {
    case "fingerprint-mismatch":
      return "principal policy signer key fingerprint mismatch";
    case "not-found":
      return "principal policy signer key could not be loaded";
  }
}

async function loadGroupSharePolicyBundle(input: {
  apiClient: ContainerManagedPrincipalShareApi;
  execSql: ExecSql;
  expectedGroupHead?: ReferencedPrincipalHead | undefined;
  groupId: string;
  localCheckpoint: PrincipalPolicyCheckpoint | null;
}): Promise<PrincipalPolicyBundleResponse> {
  if (
    input.expectedGroupHead &&
    (input.expectedGroupHead.principalType !== "group" ||
      input.expectedGroupHead.principalId !== input.groupId)
  ) {
    throw new Error("Container share expected group policy target mismatch");
  }
  const bundleFromCache = input.expectedGroupHead
    ? await loadPrincipalPolicyBundleForReference(
        input.execSql,
        input.expectedGroupHead,
        input.localCheckpoint,
      )
    : null;
  let bundle = bundleFromCache;
  bundle ??= await input.apiClient.getCurrentPrincipalPolicy(
    "group",
    input.groupId,
  );
  if (!bundle) {
    throw new Error("Container share principal policy could not be loaded");
  }
  assertGroupPolicyTarget(bundle, input.groupId);
  return bundle;
}

export async function loadVerifiedGroupSharePrincipalPolicy(input: {
  apiClient: ContainerManagedPrincipalShareApi;
  deferCheckpointAdvance?: true | undefined;
  execSql: ExecSql;
  expectedGroupHead?: ReferencedPrincipalHead | undefined;
  groupId: string;
  organizationId: string;
  resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}): Promise<VerifiedSharePrincipalPolicy> {
  const localCheckpoint = await loadPrincipalPolicyVerificationCheckpoint({
    execSql: input.execSql,
    principalId: input.groupId,
    principalType: "group",
  });
  const bundle = await loadGroupSharePolicyBundle({
    ...input,
    localCheckpoint,
  });
  const signerPublicKeys = await collectPrincipalPolicySignerPublicKeys({
    bundle,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  if ("error" in signerPublicKeys) {
    throw new Error(signerPublicKeyLoadErrorMessage(signerPublicKeys.error));
  }

  let organizationAdminPolicy: Promise<VerifiedExternalAdminPolicy | null> | null =
    null;
  let usedOrganizationAdminPolicy = false;
  const loadOrganizationAdminPolicyOnce = () => {
    organizationAdminPolicy ??= loadOrganizationExternalAdminPolicy({
      execSql: input.execSql,
      getCurrentPrincipalPolicy: (principalType, principalId) =>
        principalType === "group" && principalId === input.groupId
          ? Promise.resolve(bundle)
          : input.apiClient.getCurrentPrincipalPolicy(
              principalType,
              principalId,
            ),
      organizationId: input.organizationId,
      resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    });
    return organizationAdminPolicy;
  };
  const verified =
    await verifyPrincipalPolicyBundleWithExternalOrganizationAdmins({
      bundle,
      expectedReference:
        input.expectedGroupHead ?? principalPolicyReferenceFromBundle(bundle),
      loadExternalAuthority: async () => {
        usedOrganizationAdminPolicy = true;
        return (
          (await loadOrganizationAdminPolicyOnce())?.externalAuthority ?? null
        );
      },
      localCheckpoint,
      signerPublicKeys: signerPublicKeys.signerPublicKeys,
    });
  if (!verified.ok) {
    throwKeyingVerificationErrorWithContext(
      verified.error,
      "Container share principal policy verification failed",
    );
  }

  const verifiedOrganizationPolicy = usedOrganizationAdminPolicy
    ? await loadOrganizationAdminPolicyOnce()
    : null;
  const checkpointPolicies = await retainVerifiedSharePolicies({
    bundle,
    execSql: input.execSql,
    organizationPolicy: verifiedOrganizationPolicy,
    policy: verified.value,
  });
  if (!input.deferCheckpointAdvance) {
    await advanceAndSaveVerifiedSharePolicies({
      checkpointPolicies,
      execSql: input.execSql,
      organizationPolicy: verifiedOrganizationPolicy,
    });
  }
  return {
    bundle,
    checkpointPolicies,
    dependencyBundles: verifiedOrganizationPolicy
      ? externalAdminPolicyPersistenceEntries(verifiedOrganizationPolicy).map(
          (entry) => entry.bundle,
        )
      : [],
    policy: verified.value,
  };
}
