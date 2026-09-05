import {
  KeyingVerificationError,
  type PrincipalPolicyExternalAuthority,
  type VerifiedPrincipalPolicy,
  verifyPrincipalPolicyBundle,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { persistVerifiedPrincipalPolicyBundlesAtomically } from "../../data/persistence/keyingCheckpointAdvancePersistence";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import {
  type OrganizationAuthorityDescriptor,
  parseOrganizationAuthorityDescriptor,
  principalHeadMatchesReference,
  requireOrganizationGroupHead,
} from "../../data/principals/organizationAuthorityDescriptor";
import {
  organizationAdminExternalAuthority,
  organizationAdminSignerUserIds,
  principalPolicyReferenceFromBundle,
  verifyOrganizationAdminPolicy,
} from "../../data/principals/principalPolicyAdminSigners";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import { collectPrincipalPolicySignerPublicKeys } from "./policyVerification";

export interface VerifiedExternalAdminPolicy {
  readonly adminBundle: PrincipalPolicyBundleResponse;
  readonly adminGroupId: string;
  readonly adminPolicy: VerifiedPrincipalPolicy;
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly descriptor: OrganizationAuthorityDescriptor;
  readonly memberGroupId: string;
  readonly policy: VerifiedPrincipalPolicy;
  readonly externalAuthority: PrincipalPolicyExternalAuthority;
  readonly signerUserIds: readonly string[];
}

export function externalAdminPolicyPersistenceEntries(
  authority: VerifiedExternalAdminPolicy,
): ReadonlyArray<{
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly policy: VerifiedPrincipalPolicy;
}> {
  return [
    { bundle: authority.bundle, policy: authority.policy },
    { bundle: authority.adminBundle, policy: authority.adminPolicy },
  ];
}

function assertAdminsPolicyShape(policy: VerifiedPrincipalPolicy): void {
  if (
    (policy.history ?? [{ projection: policy.projection }]).some(
      (entry) =>
        entry.projection.length === 0 ||
        entry.projection.some((member) => member.role !== "admin"),
    )
  ) {
    throw new KeyingVerificationError(
      "invalid_shape",
      "reserved Admins policy must contain only direct admin users",
    );
  }
}

async function verifyOrganizationPolicy(input: {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly execSql: ExecSql;
  readonly organizationId: string;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}): Promise<VerifiedPrincipalPolicy | null> {
  const localCheckpoint = await loadPrincipalPolicyCheckpoint(
    input.execSql,
    "organization",
    input.organizationId,
  );
  const signerPublicKeys = await collectPrincipalPolicySignerPublicKeys({
    bundle: input.bundle,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  if ("error" in signerPublicKeys) {
    return null;
  }
  const verified = await verifyOrganizationAdminPolicy({
    bundle: input.bundle,
    localCheckpoint,
    organizationId: input.organizationId,
    signerPublicKeys: signerPublicKeys.signerPublicKeys,
  });
  if (!verified.ok) {
    throw verified.error;
  }
  return verified.value;
}

function parseScopedAuthorityDescriptor(
  bundle: PrincipalPolicyBundleResponse,
  organizationId: string,
): OrganizationAuthorityDescriptor {
  let descriptor: OrganizationAuthorityDescriptor;
  try {
    descriptor = parseOrganizationAuthorityDescriptor(
      bundle.currentPayload.ciphertext,
    );
  } catch {
    throw new KeyingVerificationError(
      "invalid_shape",
      "organization authority descriptor is invalid",
    );
  }
  if (descriptor.organizationId !== organizationId) {
    throw new KeyingVerificationError(
      "object_mismatch",
      "organization authority descriptor scope does not match",
    );
  }
  return descriptor;
}

async function loadVerifiedAdminsPolicy(input: {
  readonly adminGroupId: string;
  readonly expectedHead: ReturnType<typeof requireOrganizationGroupHead>;
  readonly execSql: ExecSql;
  readonly getCurrentPrincipalPolicy: (
    principalType: "group" | "organization",
    principalId: string,
  ) => Promise<PrincipalPolicyBundleResponse | null>;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}): Promise<{
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly policy: VerifiedPrincipalPolicy;
} | null> {
  const bundle = await input.getCurrentPrincipalPolicy(
    "group",
    input.adminGroupId,
  );
  if (!bundle) {
    return null;
  }
  if (
    !principalHeadMatchesReference(
      principalPolicyReferenceFromBundle(bundle),
      input.expectedHead,
    )
  ) {
    throw new KeyingVerificationError(
      "hash_mismatch",
      "reserved Admins policy does not match the signed organization directory",
    );
  }
  const localCheckpoint = await loadPrincipalPolicyCheckpoint(
    input.execSql,
    "group",
    input.adminGroupId,
  );
  const signerPublicKeys = await collectPrincipalPolicySignerPublicKeys({
    bundle,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  if ("error" in signerPublicKeys) {
    return null;
  }
  const verified = await verifyPrincipalPolicyBundle({
    bundle,
    expectedReference: input.expectedHead,
    localCheckpoint,
    signerPublicKeys: signerPublicKeys.signerPublicKeys,
  });
  if (!verified.ok) {
    throw verified.error;
  }
  if (
    verified.value.principalType !== "group" ||
    verified.value.principalId !== input.adminGroupId
  ) {
    throw new KeyingVerificationError(
      "object_mismatch",
      "reserved Admins policy target does not match",
    );
  }
  assertAdminsPolicyShape(verified.value);
  return { bundle, policy: verified.value };
}

export async function loadOrganizationExternalAdminPolicy(input: {
  readonly execSql: ExecSql;
  readonly getCurrentPrincipalPolicy: (
    principalType: "group" | "organization",
    principalId: string,
  ) => Promise<PrincipalPolicyBundleResponse | null>;
  readonly organizationId: string | null | undefined;

  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly stillCurrent?: (() => boolean) | undefined;
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
    const policy = await verifyOrganizationPolicy({
      bundle,
      execSql: input.execSql,
      organizationId: input.organizationId,
      resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    });
    if (!policy) {
      return null;
    }
    const descriptor = parseScopedAuthorityDescriptor(
      bundle,
      input.organizationId,
    );
    const admin = await loadVerifiedAdminsPolicy({
      adminGroupId: descriptor.adminGroupId,
      expectedHead: requireOrganizationGroupHead(
        descriptor,
        descriptor.adminGroupId,
      ),
      execSql: input.execSql,
      getCurrentPrincipalPolicy: input.getCurrentPrincipalPolicy,
      resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    });
    if (!admin) {
      return null;
    }

    const verified: VerifiedExternalAdminPolicy = {
      adminBundle: admin.bundle,
      adminGroupId: descriptor.adminGroupId,
      adminPolicy: admin.policy,
      bundle,
      descriptor,
      externalAuthority: organizationAdminExternalAuthority(admin.policy),
      memberGroupId: descriptor.memberGroupId,
      policy,
      signerUserIds: organizationAdminSignerUserIds(admin.policy),
    };
    await persistVerifiedPrincipalPolicyBundlesAtomically({
      entries: externalAdminPolicyPersistenceEntries(verified),
      execSql: input.execSql,
      organizationId: input.organizationId,
      stillCurrent: input.stillCurrent,
      updatedAt: new Date().toISOString(),
    });
    return verified;
  } catch (error) {
    if (error instanceof KeyingVerificationError) {
      throw error;
    }
    return null;
  }
}
