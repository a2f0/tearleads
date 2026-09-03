import {
  KeyingVerificationError,
  type PrincipalPolicyExternalAuthority,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { throwKeyingVerificationErrorWithContext } from "../../data/keyingProjectionVerification/error";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
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

const RESERVED_GROUP_NAME_KEYS = new Set(
  ["Admins", "Members"].map(canonicalGroupNameKey),
);

/**
 * Signed group names are the only authenticated label a member can choose a
 * group by, and the API does not make them unique within an organization. So
 * uniqueness is enforced here, where a name enters: before an admin signs a
 * new group, every group committed in the signed organization directory is
 * loaded, verified against its directory head, and its committed name compared
 * by canonical key. A share then needs only the target's verified name. A
 * compromised server cannot mint a signed group, so it cannot create the
 * duplicate this check refuses.
 */
export async function assertGroupNameUniqueInDirectory(input: {
  readonly apiClient: {
    getCurrentPrincipalPolicy: (
      principalType: "group" | "organization",
      principalId: string,
    ) => Promise<PrincipalPolicyBundleResponse | null>;
  };
  readonly descriptor: OrganizationAuthorityDescriptor;
  readonly execSql: ExecSql;
  readonly externalAuthority: PrincipalPolicyExternalAuthority;
  readonly name: string;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
}): Promise<void> {
  const nameKey = canonicalGroupNameKey(input.name);
  // A taken name is user input to correct, not evidence of tampering, so the
  // two duplicate refusals are plain errors: group creation runs under
  // security-incident reporting, which records every KeyingVerificationError.
  // The reserved groups keep their fixed names and are verified on every
  // organization-authority load already; refuse their names outright and skip
  // fetching them here.
  if (RESERVED_GROUP_NAME_KEYS.has(nameKey)) {
    throw new Error("A reserved organization group already carries this name");
  }
  for (const head of input.descriptor.groupHeads) {
    if (
      head.principalId === input.descriptor.adminGroupId ||
      head.principalId === input.descriptor.memberGroupId
    ) {
      continue;
    }
    const bundle = await input.apiClient.getCurrentPrincipalPolicy(
      "group",
      head.principalId,
    );
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
        localCheckpoint: await loadPrincipalPolicyCheckpoint(
          input.execSql,
          "group",
          head.principalId,
        ),
        signerPublicKeys: signerPublicKeys.signerPublicKeys,
      });
    if (!verified.ok) {
      throwKeyingVerificationErrorWithContext(
        verified.error,
        "Organization directory group verification failed",
      );
    }
    if (canonicalGroupNameKey(readGroupPolicyPayloadName(bundle)) === nameKey) {
      throw new Error(
        "Another signed group in this organization already carries this name",
      );
    }
  }
}
