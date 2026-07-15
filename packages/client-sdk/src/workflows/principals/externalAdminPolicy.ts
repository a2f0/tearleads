import {
  KeyingVerificationError,
  type VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { loadPrincipalPolicyVerificationCheckpoint } from "../../data/persistence/principalPolicyCheckpointSelection";
import {
  organizationAdminSignerUserIds,
  verifyOrganizationAdminPolicy,
} from "../../data/principalPolicyAdminSigners";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import { collectPrincipalPolicySignerPublicKeys } from "./policyVerification";

export interface VerifiedExternalAdminPolicy {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly policy: VerifiedPrincipalPolicy;
  readonly signerUserIds: readonly string[];
}

export async function loadOrganizationExternalAdminPolicy(input: {
  readonly execSql: ExecSql;
  readonly getCurrentPrincipalPolicy: (
    principalType: "group" | "organization",
    principalId: string,
  ) => Promise<PrincipalPolicyBundleResponse | null>;
  readonly organizationId: string | null | undefined;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}): Promise<VerifiedExternalAdminPolicy | null> {
  if (!input.organizationId) {
    return null;
  }
  try {
    const bundle = await input.getCurrentPrincipalPolicy(
      "organization",
      input.organizationId,
    );
    if (!bundle) {
      return null;
    }
    const localCheckpoint = await loadPrincipalPolicyVerificationCheckpoint({
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
