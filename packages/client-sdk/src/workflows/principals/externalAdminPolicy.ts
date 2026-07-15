import {
  KeyingVerificationError,
  type VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type {
  EncapsulationKeyResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import { loadPrincipalPolicyVerificationCheckpoint } from "../../data/persistence/principalPolicyCheckpointSelection";
import { loadPrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import {
  organizationAdminSignerUserIds,
  verifyOrganizationAdminPolicy,
} from "../../data/principalPolicyAdminSigners";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
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
  readonly getEncapsulationKey: (
    userId: string,
  ) => Promise<EncapsulationKeyResponse | null>;
  readonly organizationId: string | null | undefined;
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
      getEncapsulationKey: input.getEncapsulationKey,
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
