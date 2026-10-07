import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { organizationAdminSignerUserIds } from "../../data/principals/principalPolicyAdminSigners";
import { loadCurrentOrganizationAuthority } from "./currentOrganizationAuthority";

/** Resolve uncertain work and verify the signing administrator before any mutation pins. */
export async function loadCurrentOrganizationMutationAuthority(
  input: Omit<
    Parameters<typeof loadCurrentOrganizationAuthority>[0],
    "organizationReference"
  > & {
    readonly signerUserId: string;
    readonly recoverPendingPrincipalMutation: (
      organizationId: string,
    ) => Promise<void>;
  },
) {
  const owned = { ...input };
  assertProjectionVerificationCurrent(owned.stillCurrent);
  await owned.recoverPendingPrincipalMutation(owned.organizationId);
  assertProjectionVerificationCurrent(owned.stillCurrent);
  const authority = await loadCurrentOrganizationAuthority(owned);
  const currentOrgAdminUserIds = organizationAdminSignerUserIds(
    authority.admins.policy,
  );
  if (!currentOrgAdminUserIds.includes(owned.signerUserId))
    throw new Error("Organization admin authority is required");
  return { authority, currentOrgAdminUserIds };
}
