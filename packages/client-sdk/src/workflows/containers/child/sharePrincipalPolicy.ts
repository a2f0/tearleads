import type {
  ManagedPrincipalKind,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { KeyingVerificationError } from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import type { ContainerShareApi } from "../../../data/containers/shared/types";
import { throwKeyingVerificationErrorWithContext } from "../../../data/keyingProjectionVerification/error";
import { advanceKeyingCheckpointsAtomically } from "../../../data/persistence/keyingCheckpointAdvancePersistence";
import { loadPrincipalPolicyVerificationCheckpoint } from "../../../data/persistence/principalPolicyCheckpointSelection";
import {
  loadPrincipalPolicyBundle,
  retainVerifiedPrincipalPolicyBundle,
  savePrincipalPolicyBundle,
} from "../../../data/persistence/principalPolicyPersistence";
import {
  organizationAdminSignerUserIds,
  principalPolicyReferenceFromBundle,
  verifyOrganizationAdminPolicy,
  verifyPrincipalPolicyBundleWithExternalOrganizationAdmins,
} from "../../../data/principalPolicyAdminSigners";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../../data/trustedUserIdentity";
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

interface VerifiedOrganizationAdminPolicy {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly policy: VerifiedPrincipalPolicy;
  readonly signerUserIds: readonly string[];
}

async function retainVerifiedSharePolicies(input: {
  bundle: PrincipalPolicyBundleResponse;
  execSql: ExecSql;
  organizationPolicy: VerifiedOrganizationAdminPolicy | null;
  policy: VerifiedPrincipalPolicy;
}): Promise<VerifiedPrincipalPolicy[]> {
  const retainedAt = new Date().toISOString();
  if (input.organizationPolicy) {
    await retainVerifiedPrincipalPolicyBundle({
      bundle: input.organizationPolicy.bundle,
      execSql: input.execSql,
      policy: input.organizationPolicy.policy,
      updatedAt: retainedAt,
    });
  }
  await retainVerifiedPrincipalPolicyBundle({
    bundle: input.bundle,
    execSql: input.execSql,
    policy: input.policy,
    updatedAt: retainedAt,
  });
  return [
    ...(input.organizationPolicy ? [input.organizationPolicy.policy] : []),
    input.policy,
  ];
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

async function loadOrganizationAdminPolicy(input: {
  apiClient: ContainerManagedPrincipalShareApi;
  execSql: ExecSql;
  organizationId: string;
  resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}): Promise<VerifiedOrganizationAdminPolicy | null> {
  try {
    const bundle = await input.apiClient.getCurrentPrincipalPolicy(
      "organization",
      input.organizationId,
    );
    if (!bundle) {
      return null;
    }

    const cachedBundle = await loadPrincipalPolicyBundle(
      input.execSql,
      "organization",
      input.organizationId,
    );
    const localCheckpoint = await loadPrincipalPolicyVerificationCheckpoint({
      cachedBundle,
      execSql: input.execSql,
      principalId: input.organizationId,
      principalType: "organization",
    });
    const signerPublicKeys = await collectPrincipalPolicySignerPublicKeys({
      bundle,
      resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    });
    if ("error" in signerPublicKeys) {
      return null;
    }

    const verified = await verifyOrganizationAdminPolicy({
      bundle,
      localCheckpoint,
      organizationId: input.organizationId,
      signerPublicKeys: signerPublicKeys.signerPublicKeys,
    });
    if (!verified.ok) {
      throw verified.error;
    }

    return {
      bundle,
      policy: verified.value,
      signerUserIds: organizationAdminSignerUserIds(verified.value),
    };
  } catch (error) {
    if (error instanceof KeyingVerificationError) {
      throw error;
    }
    return null;
  }
}

export async function loadVerifiedGroupSharePrincipalPolicy(input: {
  apiClient: ContainerManagedPrincipalShareApi;
  deferCheckpointAdvance?: true | undefined;
  execSql: ExecSql;
  groupId: string;
  organizationId: string;
  resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}): Promise<VerifiedSharePrincipalPolicy> {
  const bundle = await input.apiClient.getCurrentPrincipalPolicy(
    "group",
    input.groupId,
  );
  if (!bundle) {
    throw new Error("Container share principal policy could not be loaded");
  }
  assertGroupPolicyTarget(bundle, input.groupId);

  const cachedBundle = await loadPrincipalPolicyBundle(
    input.execSql,
    "group",
    input.groupId,
  );
  const localCheckpoint = await loadPrincipalPolicyVerificationCheckpoint({
    cachedBundle,
    execSql: input.execSql,
    principalId: input.groupId,
    principalType: "group",
  });
  const signerPublicKeys = await collectPrincipalPolicySignerPublicKeys({
    bundle,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  if ("error" in signerPublicKeys) {
    throw new Error(signerPublicKeyLoadErrorMessage(signerPublicKeys.error));
  }

  let organizationAdminPolicy: Promise<VerifiedOrganizationAdminPolicy | null> | null =
    null;
  let usedOrganizationAdminPolicy = false;
  const loadOrganizationAdminPolicyOnce = () => {
    organizationAdminPolicy ??= loadOrganizationAdminPolicy({
      apiClient: input.apiClient,
      execSql: input.execSql,
      organizationId: input.organizationId,
      resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    });
    return organizationAdminPolicy;
  };
  const verified =
    await verifyPrincipalPolicyBundleWithExternalOrganizationAdmins({
      bundle,
      expectedReference: principalPolicyReferenceFromBundle(bundle),
      loadExternalAdminSignerUserIds: async () => {
        usedOrganizationAdminPolicy = true;
        return (await loadOrganizationAdminPolicyOnce())?.signerUserIds ?? [];
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
    await advanceKeyingCheckpointsAtomically({
      access: [],
      execSql: input.execSql,
      policies: checkpointPolicies,
    });
    if (verifiedOrganizationPolicy) {
      await savePrincipalPolicyBundle(
        input.execSql,
        verifiedOrganizationPolicy.bundle,
        new Date().toISOString(),
      );
    }
  }
  return {
    bundle,
    checkpointPolicies,
    dependencyBundles: verifiedOrganizationPolicy
      ? [verifiedOrganizationPolicy.bundle]
      : [],
    policy: verified.value,
  };
}
