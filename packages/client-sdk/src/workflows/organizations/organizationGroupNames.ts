import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import { hydrateCurrentOrganizationGroupNames } from "./currentOrganizationGroupNames";
import type { DirectoryGroupWalkInput } from "./groupNameUniqueness";
import type { OrganizationDirectoryAndGroups } from "./readModel";

/** Verify names against the signed directory before projecting decrypted labels. */
export async function hydrateOrganizationGroupNames(
  input: Omit<DirectoryGroupWalkInput, "descriptor" | "externalAuthority"> & {
    readonly directory: OrganizationDirectoryAndGroups;
    readonly organizationPolicyReference?: ReferencedPrincipalHead | null;
    readonly recoveryBatch?: object | undefined;
    readonly stillCurrent: () => boolean;
    readonly createCurrentNameReader?: Parameters<
      typeof hydrateCurrentOrganizationGroupNames
    >[0]["createCurrentNameReader"];
    readonly resolveCurrentPolicy?:
      | Parameters<
          typeof hydrateCurrentOrganizationGroupNames
        >[0]["resolveCurrentPolicy"]
      | undefined;
  },
): Promise<OrganizationDirectoryAndGroups> {
  if (!input.resolveCurrentPolicy)
    throw new Error("Group names require private paged recovery");
  return hydrateCurrentOrganizationGroupNames({
    ...input,
    organizationReference: input.organizationPolicyReference,
    resolveCurrentPolicy: input.resolveCurrentPolicy,
  });
}
