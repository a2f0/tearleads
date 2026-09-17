import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import { saveOrganizationGroupDisplayNames } from "../../data/persistence/organizations/organizationGroupNamePersistence";
import { retainVerifiedPrincipalPolicyBundle } from "../../data/persistence/verifiedPrincipalPolicyRetentionPersistence";
import {
  type DirectoryGroupWalkInput,
  verifyDirectoryGroup,
} from "./groupNameUniqueness";
import { loadGroupNameDirectoryAuthority } from "./organizationGroupNamePolicies";
import type { OrganizationDirectoryAndGroups } from "./readModel";

/** Verify names against the signed directory before projecting decrypted labels. */
export async function hydrateOrganizationGroupNames(
  input: Omit<DirectoryGroupWalkInput, "descriptor" | "externalAuthority"> & {
    readonly directory: OrganizationDirectoryAndGroups;
    readonly organizationPolicyReference?: ReferencedPrincipalHead | null;
    readonly stillCurrent: () => boolean;
  },
): Promise<OrganizationDirectoryAndGroups> {
  const authority = await loadGroupNameDirectoryAuthority(input);
  if (!authority) throw new Error("Group directory authority is unavailable");
  const names: { groupId: string; name: string; stateHash: string }[] = [];
  for (const group of input.directory.groups) {
    const head = authority.descriptor.groupHeads.find(
      (head) => head.principalId === group.groupId,
    );
    if (!head || head.stateHash !== group.currentState?.stateHash)
      throw new Error("Group listing does not match the signed directory");
    const verified = await verifyDirectoryGroup(
      {
        ...input,
        descriptor: authority.descriptor,
        externalAuthority: authority.externalAuthority,
      },
      head,
    );
    names.push({
      groupId: group.groupId,
      name: verified.name,
      stateHash: head.stateHash,
    });
    await retainVerifiedPrincipalPolicyBundle({
      ...input,
      bundle: verified.bundle,
      policy: verified.policy,
      updatedAt: new Date().toISOString(),
    });
  }
  if (!input.stillCurrent()) throw new Error("Group directory access changed");
  await saveOrganizationGroupDisplayNames({ ...input, names });
  const byId = new Map(names.map((entry) => [entry.groupId, entry.name]));
  return {
    ...input.directory,
    groups: input.directory.groups.map((group) => ({
      ...group,
      name: byId.get(group.groupId) ?? "",
    })),
  };
}
