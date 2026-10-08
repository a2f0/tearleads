import { KeyingVerificationError } from "@tearleads/crypto";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { advanceKeyingCheckpointsAtomically } from "../../data/persistence/keyingCheckpointAdvancePersistence";
import { saveOrganizationGroupDisplayNames } from "../../data/persistence/organizations/organizationGroupNamePersistence";
import type { SecurityIncidentReporter } from "../../data/securityIncidents";
import { loadCurrentOrganizationAuthority } from "./currentOrganizationAuthority";
import { GroupMetadataUnreadableError } from "./groupMetadataAccess";
import { assertGroupMetadataBinding } from "./groupMetadataBinding";
import {
  type GroupPolicyNameReader,
  readGroupPolicyPayloadName,
} from "./principalPolicyRequest";
import type { OrganizationDirectoryAndGroups } from "./readModel";

type Input = Parameters<typeof loadCurrentOrganizationAuthority>[0] & {
  readonly directory: OrganizationDirectoryAndGroups;
  readonly readEncryptedName?: GroupPolicyNameReader | undefined;
  readonly reportSecurityIncident: SecurityIncidentReporter;
};

/** Names consume verified current artifacts; paged recovery retains their separate evidence. */
export async function hydrateCurrentOrganizationGroupNames(
  input: Input,
): Promise<OrganizationDirectoryAndGroups> {
  const authority = await loadCurrentOrganizationAuthority(input);
  const names: { groupId: string; name: string; stateHash: string }[] = [];
  const unreadable = new Set<string>();
  const lifetimes: (() => boolean)[] = [authority.stillCurrent];
  for (const group of input.directory.groups) {
    const head = authority.descriptor.groupHeads.find(
      (head) => head.principalId === group.groupId,
    );
    if (!head || head.stateHash !== group.currentState?.stateHash)
      throw new Error("Group listing does not match the signed directory");
    const verified = await authority.readGroup(group.groupId);
    lifetimes.push(verified.stillCurrent);
    assertGroupMetadataBinding(verified.current, authority.descriptor);
    const name = await readCurrentGroupName(input, verified.current);
    if (name === null) unreadable.add(group.groupId);
    else
      names.push({ groupId: group.groupId, name, stateHash: head.stateHash });
  }
  const stillCurrent = () =>
    input.stillCurrent() && lifetimes.every((current) => current());
  assertProjectionVerificationCurrent(stillCurrent);
  // Match the authority admission performed by the full-bundle path. Group
  // name reads alone do not move group checkpoints.
  await advanceKeyingCheckpointsAtomically({
    access: [],
    execSql: input.execSql,
    organizationId: input.organizationId,
    policies: [authority.directory.policy, authority.admins.policy],
    stillCurrent,
  });
  await saveOrganizationGroupDisplayNames({ ...input, names, stillCurrent });
  assertProjectionVerificationCurrent(stillCurrent);
  const byId = new Map(names.map((entry) => [entry.groupId, entry.name]));
  return {
    ...input.directory,
    groups: input.directory.groups.map((group) => ({
      ...group,
      name: byId.get(group.groupId) ?? "",
      nameUnreadable: unreadable.has(group.groupId),
    })),
  };
}

async function readCurrentGroupName(
  input: Input,
  current: Parameters<GroupPolicyNameReader>[0],
) {
  try {
    return await readGroupPolicyPayloadName(current, input.readEncryptedName);
  } catch (error) {
    if (!(error instanceof GroupMetadataUnreadableError)) throw error;
    await input.reportSecurityIncident(
      new KeyingVerificationError(
        "invalid_shape",
        "Signed group name does not open under the cited metadata key",
      ),
      {
        evidenceHashes: { stateHash: current.currentState.stateHash },
        objectId: current.currentState.principalId,
        objectKind: "principal",
        operation: "organization.groupName",
        organizationId: input.organizationId,
      },
    );
    return null;
  }
}
