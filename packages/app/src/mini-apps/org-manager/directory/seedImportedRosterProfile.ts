import type { RosterProfileNames } from "../../../stores/org-manager/profileDocuments";
import type { OrgManagerMutationsParams } from "../hooks/orgManagerMutationsTypes";
import { ORG_MANAGER_LABELS } from "../labels";

type SeedImportedRosterProfileInput = Pick<
  OrgManagerMutationsParams,
  "refreshDirectoryAndGroups" | "setError"
> & {
  readonly isOperationActive: (organizationId: string) => boolean;
  readonly names: RosterProfileNames;
  readonly operationOrganizationId: string;
  readonly orgManagerActions: Pick<
    OrgManagerMutationsParams["orgManagerActions"],
    "ensureRosterProfileDocument" | "loadUserDetail"
  >;
  readonly userId: string;
};

/**
 * Gives a newly added member the roster profile the operator named in the
 * dialog. A member who already has a profile keeps it untouched. Returns false
 * when the profile could not be created, which keeps the dialog and its names
 * open: retrying finds the member already added and only creates the profile.
 */
export async function seedImportedRosterProfile(
  input: SeedImportedRosterProfileInput,
): Promise<boolean> {
  const isActive = () => input.isOperationActive(input.operationOrganizationId);
  const detail = await input.orgManagerActions.loadUserDetail(input.userId);
  if (!isActive()) return false;
  if (!detail) {
    input.setError(ORG_MANAGER_LABELS.failedCreateProfileDocument);
    return false;
  }
  if (detail.user.profileDocumentId) return true;

  const updatedUser = await input.orgManagerActions.ensureRosterProfileDocument(
    detail.user,
    input.names,
  );
  if (!isActive()) return false;
  if (!updatedUser?.profileDocumentId) {
    input.setError(ORG_MANAGER_LABELS.failedCreateProfileDocument);
    return false;
  }

  // Reload the roster before selecting the member, or its profile-less row
  // would start a second, nameless profile creation.
  await input.refreshDirectoryAndGroups({
    afterMutation: true,
    skipNextGroupDetailsEffect: true,
  });
  return isActive();
}
