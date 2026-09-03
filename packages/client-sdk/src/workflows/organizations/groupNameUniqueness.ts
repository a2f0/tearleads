import {
  KeyingVerificationError,
  type PrincipalPolicyExternalAuthority,
  type VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { throwKeyingVerificationErrorWithContext } from "../../data/keyingProjectionVerification/error";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { loadPrincipalPolicyBundleForReference } from "../../data/persistence/principalPolicyReferencePersistence";
import { retainVerifiedPrincipalPolicyBundle } from "../../data/persistence/verifiedPrincipalPolicyRetentionPersistence";
import {
  type OrganizationAuthorityDescriptor,
  principalHeadMatchesReference,
} from "../../data/principals/organizationAuthorityDescriptor";
import {
  principalPolicyReferenceFromBundle,
  verifyPrincipalPolicyBundleWithExternalOrganizationAdmins,
} from "../../data/principals/principalPolicyAdminSigners";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import { collectPrincipalPolicySignerPublicKeys } from "../principals/policyVerification";
import {
  canonicalGroupNameKey,
  readGroupPolicyPayloadName,
} from "./principalPolicyRequest";

interface DirectoryGroupWalkInput {
  readonly apiClient: {
    getCurrentPrincipalPolicy: (
      principalType: "group" | "organization",
      principalId: string,
    ) => Promise<PrincipalPolicyBundleResponse | null>;
  };
  readonly descriptor: OrganizationAuthorityDescriptor;
  readonly execSql: ExecSql;
  readonly externalAuthority: PrincipalPolicyExternalAuthority;
  readonly organizationId: string;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}

type DirectoryGroupHead = OrganizationAuthorityDescriptor["groupHeads"][number];

interface VerifiedDirectoryGroup {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly nameKey: string;
  readonly policy: VerifiedPrincipalPolicy;
}

/**
 * Loads one directory group at its committed head: from the local retained
 * bundles when they already hold that head, and from the API otherwise.
 */
async function loadDirectoryGroupBundle(
  input: DirectoryGroupWalkInput,
  head: DirectoryGroupHead,
) {
  const localCheckpoint = await loadPrincipalPolicyCheckpoint(
    input.execSql,
    "group",
    head.principalId,
  );
  const cached = await loadPrincipalPolicyBundleForReference(
    input.execSql,
    head,
    localCheckpoint,
  );
  const bundle =
    cached ??
    (await input.apiClient.getCurrentPrincipalPolicy(
      "group",
      head.principalId,
    ));
  if (!bundle) {
    throw new Error(
      `Organization directory group ${head.principalId} could not be loaded`,
    );
  }
  if (
    !principalHeadMatchesReference(
      principalPolicyReferenceFromBundle(bundle),
      head,
    )
  ) {
    throw new KeyingVerificationError(
      "object_mismatch",
      "Organization directory group policy does not match its signed head",
    );
  }
  return { bundle, localCheckpoint };
}

async function verifyDirectoryGroup(
  input: DirectoryGroupWalkInput,
  head: DirectoryGroupHead,
): Promise<VerifiedDirectoryGroup> {
  const { bundle, localCheckpoint } = await loadDirectoryGroupBundle(
    input,
    head,
  );
  const signerPublicKeys = await collectPrincipalPolicySignerPublicKeys({
    bundle,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  if ("error" in signerPublicKeys) {
    throw new Error(
      `Organization directory group signer key could not be loaded (${signerPublicKeys.error})`,
    );
  }
  const verified =
    await verifyPrincipalPolicyBundleWithExternalOrganizationAdmins({
      bundle,
      expectedReference: head,
      loadExternalAuthority: async () => input.externalAuthority,
      localCheckpoint,
      signerPublicKeys: signerPublicKeys.signerPublicKeys,
    });
  if (!verified.ok) {
    throwKeyingVerificationErrorWithContext(
      verified.error,
      "Organization directory group verification failed",
    );
  }
  return {
    bundle,
    nameKey: canonicalGroupNameKey(readGroupPolicyPayloadName(bundle)),
    policy: verified.value,
  };
}

/**
 * Signed group names are the only authenticated label a member can choose a
 * group by, and the API does not make them unique within an organization. So
 * uniqueness is enforced here, where a name enters: before an admin signs a
 * new group, every group committed in the signed organization directory
 * (the reserved Admins and Members groups included) is loaded, verified
 * against its directory head, and its committed name compared by canonical
 * key. A share then needs only the target's verified name. A compromised
 * server cannot mint a signed group, so it cannot create the duplicate this
 * check refuses.
 *
 * The walk is fail-closed: one group that cannot be loaded or verified blocks
 * the creation, since an unverifiable group could carry any name. It runs the
 * loads in parallel and retains every verified bundle, so a later creation
 * finds unchanged groups locally and fetches only those whose head moved.
 */
export async function assertGroupNameUniqueInDirectory(
  input: DirectoryGroupWalkInput & { readonly name: string },
): Promise<void> {
  const nameKey = canonicalGroupNameKey(input.name);
  const groups = await Promise.all(
    input.descriptor.groupHeads.map((head) =>
      verifyDirectoryGroup(input, head),
    ),
  );
  // Retention writes go one at a time on the shared connection; they warm the
  // cache whether or not the name turns out to be taken.
  const retainedAt = new Date().toISOString();
  for (const group of groups) {
    await retainVerifiedPrincipalPolicyBundle({
      bundle: group.bundle,
      execSql: input.execSql,
      organizationId: input.organizationId,
      policy: group.policy,
      updatedAt: retainedAt,
    });
  }
  // A taken name is user input to correct, not evidence of tampering, so this
  // is a plain error: group creation runs under security-incident reporting,
  // which records every KeyingVerificationError.
  if (groups.some((group) => group.nameKey === nameKey)) {
    throw new Error(
      "Another signed group in this organization already carries this name",
    );
  }
}
