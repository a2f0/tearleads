import {
  KeyingVerificationError,
  type ManagedPrincipalKind,
  type PrincipalPolicyCheckpoint,
  type PrincipalPolicyExternalAuthority,
  type ReferencedPrincipalHead,
  type VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { CommitOrganizationGroupPolicyRequest } from "@tearleads/validators/request";
import type {
  CommitOrganizationGroupPolicyResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import type { ContainerShareApi } from "../../../data/containers/shared/types";
import { throwKeyingVerificationErrorWithContext } from "../../../data/keyingProjectionVerification/error";
import { advanceKeyingCheckpointsAtomically } from "../../../data/persistence/keyingCheckpointAdvancePersistence";
import { loadPrincipalPolicyCheckpoint } from "../../../data/persistence/keyingCheckpointPersistence";
import { savePrincipalPolicyBundle } from "../../../data/persistence/principalPolicyPersistence";
import { loadPrincipalPolicyBundleForReference } from "../../../data/persistence/principalPolicyReferencePersistence";
import { retainVerifiedPrincipalPolicyBundle } from "../../../data/persistence/verifiedPrincipalPolicyRetentionPersistence";
import {
  type OrganizationAuthorityDescriptor,
  principalHeadMatchesReference,
  requireOrganizationGroupHead,
} from "../../../data/principals/organizationAuthorityDescriptor";
import {
  principalPolicyReferenceFromBundle,
  verifyPrincipalPolicyBundleWithExternalOrganizationAdmins,
} from "../../../data/principals/principalPolicyAdminSigners";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../../data/trustedUserIdentity";
import {
  canonicalGroupNameKey,
  readGroupPolicyPayloadName,
} from "../../organizations/principalPolicyRequest";
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
  commitOrganizationGroupPolicy: (
    organizationId: string,
    groupId: string,
    input: CommitOrganizationGroupPolicyRequest,
  ) => Promise<CommitOrganizationGroupPolicyResponse | null>;
  getCurrentPrincipalPolicy: (
    principalType: ManagedPrincipalKind,
    principalId: string,
  ) => Promise<PrincipalPolicyBundleResponse | null>;
}

export interface VerifiedSharePrincipalPolicy {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly checkpointPolicies: readonly VerifiedPrincipalPolicy[];
  readonly dependencyBundles: readonly PrincipalPolicyBundleResponse[];
  readonly organizationId: string;
  readonly policy: VerifiedPrincipalPolicy;
}

async function retainVerifiedSharePolicies(input: {
  bundle: PrincipalPolicyBundleResponse;
  execSql: ExecSql;
  organizationId: string;
  organizationPolicy: VerifiedExternalAdminPolicy | null;
  policy: VerifiedPrincipalPolicy;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<VerifiedPrincipalPolicy[]> {
  const retainedAt = new Date().toISOString();
  if (input.organizationPolicy) {
    for (const entry of externalAdminPolicyPersistenceEntries(
      input.organizationPolicy,
    )) {
      await retainVerifiedPrincipalPolicyBundle({
        ...entry,
        execSql: input.execSql,
        organizationId: input.organizationId,
        stillCurrent: input.stillCurrent,
        updatedAt: retainedAt,
      });
    }
  }
  await retainVerifiedPrincipalPolicyBundle({
    bundle: input.bundle,
    execSql: input.execSql,
    organizationId: input.organizationId,
    policy: input.policy,
    stillCurrent: input.stillCurrent,
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

/**
 * Commits the verification a loadVerifiedGroupSharePrincipalPolicy call
 * deferred: advances the keying checkpoints for the verified policies and
 * caches the dependency bundles they were verified against.
 */
export async function advanceVerifiedSharePolicies(
  execSql: ExecSql,
  verified: Pick<
    VerifiedSharePrincipalPolicy,
    "checkpointPolicies" | "dependencyBundles" | "organizationId"
  >,
  stillCurrent?: (() => boolean) | undefined,
): Promise<void> {
  await advanceKeyingCheckpointsAtomically({
    access: [],
    execSql,
    organizationId: verified.organizationId,
    policies: verified.checkpointPolicies,
    stillCurrent,
  });
  if (stillCurrent?.() === false) return;
  for (const bundle of verified.dependencyBundles) {
    await savePrincipalPolicyBundle(
      execSql,
      bundle,
      new Date().toISOString(),
      verified.organizationId,
      { stillCurrent },
    );
    if (stillCurrent?.() === false) return;
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
  if (
    input.expectedGroupHead &&
    !principalHeadMatchesReference(
      principalPolicyReferenceFromBundle(bundle),
      input.expectedGroupHead,
    )
  ) {
    throw new Error(
      "Container share group policy does not match the signed organization directory",
    );
  }
  return bundle;
}

/**
 * The share picker labels groups from the organization read model, which a
 * compromised server can relabel, and the API does not make group names unique
 * within an organization. So the name the user chose must equal the name
 * committed in the target's verified policy, and no other group in the signed
 * organization directory may commit the same name — otherwise a swapped id
 * between two same-named groups would still pass. Names compare by their
 * canonical key so look-alike spellings count as the same name.
 *
 * Every other group's policy is loaded and verified against its directory
 * head before its name is trusted. That is one policy per group in the
 * organization, but verified bundles are retained locally and reused while
 * their directory head is unchanged, so after the first share only groups
 * whose head moved cost a fetch. A withheld or unverifiable group policy fails
 * the share closed, which is the protocol's stated availability boundary.
 */
async function assertShareGroupName(input: {
  apiClient: ContainerManagedPrincipalShareApi;
  bundle: PrincipalPolicyBundleResponse;
  descriptor: OrganizationAuthorityDescriptor;
  execSql: ExecSql;
  expectedGroupName: string;
  groupId: string;
  loadExternalAuthority: () => Promise<PrincipalPolicyExternalAuthority>;
  resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}): Promise<void> {
  const expectedKey = canonicalGroupNameKey(input.expectedGroupName);
  if (
    canonicalGroupNameKey(readGroupPolicyPayloadName(input.bundle)) !==
    expectedKey
  ) {
    throw new KeyingVerificationError(
      "object_mismatch",
      "Container share group name does not match the signed group policy",
    );
  }
  for (const head of input.descriptor.groupHeads) {
    if (head.principalId === input.groupId) {
      continue;
    }
    const localCheckpoint = await loadPrincipalPolicyCheckpoint(
      input.execSql,
      "group",
      head.principalId,
    );
    const otherBundle = await loadGroupSharePolicyBundle({
      apiClient: input.apiClient,
      execSql: input.execSql,
      expectedGroupHead: head,
      groupId: head.principalId,
      localCheckpoint,
    });
    const signerPublicKeys = await collectPrincipalPolicySignerPublicKeys({
      bundle: otherBundle,
      resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    });
    if ("error" in signerPublicKeys) {
      throw new Error(signerPublicKeyLoadErrorMessage(signerPublicKeys.error));
    }
    const verified =
      await verifyPrincipalPolicyBundleWithExternalOrganizationAdmins({
        bundle: otherBundle,
        expectedReference: head,
        loadExternalAuthority: input.loadExternalAuthority,
        localCheckpoint,
        signerPublicKeys: signerPublicKeys.signerPublicKeys,
      });
    if (!verified.ok) {
      throwKeyingVerificationErrorWithContext(
        verified.error,
        "Container share directory group verification failed",
      );
    }
    if (
      canonicalGroupNameKey(readGroupPolicyPayloadName(otherBundle)) ===
      expectedKey
    ) {
      throw new KeyingVerificationError(
        "duplicate_entry",
        "Container share group name is shared by another signed group",
      );
    }
  }
}

export async function loadVerifiedGroupSharePrincipalPolicy(input: {
  apiClient: ContainerManagedPrincipalShareApi;
  execSql: ExecSql;
  expectedGroupHead?: ReferencedPrincipalHead | undefined;
  /**
   * The display name the user chose the group by. The read model that labels
   * groups is a server projection; only the name committed in the signed
   * group payload can confirm the share lands on the group the user saw.
   */
  expectedGroupName?: string | undefined;
  groupId: string;
  organizationId: string;
  resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<VerifiedSharePrincipalPolicy> {
  const organizationAdminPolicy = await loadOrganizationExternalAdminPolicy({
    execSql: input.execSql,
    getCurrentPrincipalPolicy: (principalType, principalId) =>
      input.apiClient.getCurrentPrincipalPolicy(principalType, principalId),
    organizationId: input.organizationId,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    stillCurrent: input.stillCurrent,
  });
  if (!organizationAdminPolicy) {
    throw new Error("Organization admin authority could not be verified");
  }
  const committedGroupHead = requireOrganizationGroupHead(
    organizationAdminPolicy.descriptor,
    input.groupId,
  );
  if (
    input.expectedGroupHead &&
    !principalHeadMatchesReference(input.expectedGroupHead, committedGroupHead)
  ) {
    throw new Error(
      "Container share expected group head conflicts with the signed organization directory",
    );
  }
  const localCheckpoint = await loadPrincipalPolicyCheckpoint(
    input.execSql,
    "group",
    input.groupId,
  );
  const bundle = await loadGroupSharePolicyBundle({
    ...input,
    expectedGroupHead: committedGroupHead,
    localCheckpoint,
  });
  const signerPublicKeys = await collectPrincipalPolicySignerPublicKeys({
    bundle,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  if ("error" in signerPublicKeys) {
    throw new Error(signerPublicKeyLoadErrorMessage(signerPublicKeys.error));
  }

  const verified =
    await verifyPrincipalPolicyBundleWithExternalOrganizationAdmins({
      bundle,
      expectedReference: committedGroupHead,
      loadExternalAuthority: async () =>
        organizationAdminPolicy.externalAuthority,
      localCheckpoint,
      signerPublicKeys: signerPublicKeys.signerPublicKeys,
    });
  if (!verified.ok) {
    throwKeyingVerificationErrorWithContext(
      verified.error,
      "Container share principal policy verification failed",
    );
  }
  if (input.expectedGroupName !== undefined) {
    await assertShareGroupName({
      ...input,
      bundle,
      descriptor: organizationAdminPolicy.descriptor,
      expectedGroupName: input.expectedGroupName,
      loadExternalAuthority: async () =>
        organizationAdminPolicy.externalAuthority,
    });
  }

  const checkpointPolicies = await retainVerifiedSharePolicies({
    bundle,
    execSql: input.execSql,
    organizationId: input.organizationId,
    organizationPolicy: organizationAdminPolicy,
    policy: verified.value,
    stillCurrent: input.stillCurrent,
  });
  return {
    bundle,
    checkpointPolicies,
    dependencyBundles: externalAdminPolicyPersistenceEntries(
      organizationAdminPolicy,
    ).map((entry) => entry.bundle),
    organizationId: input.organizationId,
    policy: verified.value,
  };
}
