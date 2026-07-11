import type {
  ManagedPrincipalKind,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type {
  EncapsulationKeyResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import type { ContainerShareApi } from "../../../data/containers/shared/types";
import {
  loadPrincipalPolicyBundle,
  savePrincipalPolicyBundle,
} from "../../../data/persistence/principalPolicyPersistence";
import {
  principalPolicyReferenceFromBundle,
  verifyOrganizationAdminSignerUserIds,
  verifyPrincipalPolicyBundleWithExternalOrganizationAdmins,
} from "../../../data/principalPolicyAdminSigners";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  collectPrincipalPolicySignerPublicKeys,
  type PrincipalPolicySignerPublicKeyLoadErrorCode,
  principalPolicyCheckpoint,
} from "../../principals/policyVerification";

export interface ContainerManagedPrincipalShareApi extends ContainerShareApi {
  getCurrentPrincipalPolicy: (
    principalType: ManagedPrincipalKind,
    principalId: string,
  ) => Promise<PrincipalPolicyBundleResponse | null>;
  getEncapsulationKey: (
    userId: string,
  ) => Promise<EncapsulationKeyResponse | null>;
}

interface VerifiedSharePrincipalPolicy {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly policy: VerifiedPrincipalPolicy;
}

function signerPublicKeyLoadErrorMessage(
  code: PrincipalPolicySignerPublicKeyLoadErrorCode,
): string {
  switch (code) {
    case "fingerprint-invalid":
      return "principal policy signer key fingerprint is invalid";
    case "fingerprint-mismatch":
      return "principal policy signer key fingerprint mismatch";
    case "not-found":
      return "principal policy signer key could not be loaded";
    case "user-mismatch":
      return "principal policy signer key user mismatch";
  }
}

async function loadOrganizationAdminSignerUserIds(input: {
  apiClient: ContainerManagedPrincipalShareApi;
  execSql?: ExecSql | undefined;
  organizationId: string;
}): Promise<string[]> {
  try {
    const bundle = await input.apiClient.getCurrentPrincipalPolicy(
      "organization",
      input.organizationId,
    );
    if (!bundle) {
      return [];
    }

    const cachedBundle = input.execSql
      ? await loadPrincipalPolicyBundle(
          input.execSql,
          "organization",
          input.organizationId,
        )
      : null;
    const signerPublicKeys = await collectPrincipalPolicySignerPublicKeys({
      bundle,
      getEncapsulationKey: (userId) =>
        input.apiClient.getEncapsulationKey(userId),
    });
    if ("error" in signerPublicKeys) {
      return [];
    }

    const signerUserIds = await verifyOrganizationAdminSignerUserIds({
      bundle,
      localCheckpoint: principalPolicyCheckpoint(cachedBundle),
      organizationId: input.organizationId,
      signerPublicKeys: signerPublicKeys.signerPublicKeys,
    });
    if (signerUserIds.length > 0 && input.execSql) {
      await savePrincipalPolicyBundle(
        input.execSql,
        bundle,
        new Date().toISOString(),
      );
    }
    return signerUserIds;
  } catch {
    return [];
  }
}

export async function loadVerifiedGroupSharePrincipalPolicy(input: {
  apiClient: ContainerManagedPrincipalShareApi;
  execSql?: ExecSql | undefined;
  groupId: string;
  organizationId: string;
}): Promise<VerifiedSharePrincipalPolicy> {
  const bundle = await input.apiClient.getCurrentPrincipalPolicy(
    "group",
    input.groupId,
  );
  if (!bundle) {
    throw new Error("Container share principal policy could not be loaded");
  }
  if (
    bundle.currentState.principalType !== "group" ||
    bundle.currentState.principalId !== input.groupId
  ) {
    throw new Error("Container share principal policy target mismatch");
  }

  const cachedBundle = input.execSql
    ? await loadPrincipalPolicyBundle(input.execSql, "group", input.groupId)
    : null;
  const signerPublicKeys = await collectPrincipalPolicySignerPublicKeys({
    bundle,
    getEncapsulationKey: (userId) =>
      input.apiClient.getEncapsulationKey(userId),
  });
  if ("error" in signerPublicKeys) {
    throw new Error(signerPublicKeyLoadErrorMessage(signerPublicKeys.error));
  }

  const verified =
    await verifyPrincipalPolicyBundleWithExternalOrganizationAdmins({
      bundle,
      expectedReference: principalPolicyReferenceFromBundle(bundle),
      loadExternalAdminSignerUserIds: () =>
        loadOrganizationAdminSignerUserIds({
          apiClient: input.apiClient,
          execSql: input.execSql,
          organizationId: input.organizationId,
        }),
      localCheckpoint: principalPolicyCheckpoint(cachedBundle),
      signerPublicKeys: signerPublicKeys.signerPublicKeys,
    });
  if (!verified.ok) {
    throw new Error(
      `Container share principal policy verification failed: ${verified.error.message}`,
    );
  }

  return { bundle, policy: verified.value };
}
