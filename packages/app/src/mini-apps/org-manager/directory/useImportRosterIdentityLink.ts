import type { UserIdentities } from "@tearleads/client-sdk";
import { useCallback } from "react";
import { useIdentityLinks } from "../../../providers/identity-links/useIdentityLinks";
import type { RosterProfileNames } from "../../../stores/org-manager/profileDocuments";
import { prepareRosterImport } from "../groups/orgManagerMutationOperations";
import type { OrgManagerMutationsParams } from "../hooks/orgManagerMutationsTypes";
import { runScopedOrgMutation } from "../hooks/runScopedOrgMutation";
import { ORG_MANAGER_LABELS } from "../labels";

type RosterIdentityLinkImport = Pick<
  OrgManagerMutationsParams,
  | "appData"
  | "canImportRosterUser"
  | "directory"
  | "importUserIdDraft"
  | "memberGroupId"
  | "orgManagerActions"
  | "refreshDirectoryAndGroups"
  | "refreshSelectedUserDetail"
  | "selectUser"
  | "setOrgManagerView"
  | "setError"
  | "setImportUserIdDraft"
  | "setIsImportUserDialogOpen"
  | "setMutating"
> & {
  isOperationActive: (organizationId: string) => boolean;
  logError: (message: string | Error, cause?: unknown) => void;
};

/**
 * Gives a newly added member the roster profile the operator named in the
 * dialog. A member who already has a profile keeps it untouched. Returns false
 * when the profile could not be created, leaving the dialog open: retrying
 * finds the member already added and only creates the profile.
 */
async function seedImportedRosterProfile(input: {
  isOperationActive: (organizationId: string) => boolean;
  names: RosterProfileNames;
  operationOrganizationId: string;
  orgManagerActions: RosterIdentityLinkImport["orgManagerActions"];
  refreshDirectoryAndGroups: RosterIdentityLinkImport["refreshDirectoryAndGroups"];
  setError: RosterIdentityLinkImport["setError"];
  userId: string;
}): Promise<boolean> {
  const detail = await input.orgManagerActions.loadUserDetail(input.userId);
  if (!input.isOperationActive(input.operationOrganizationId)) return false;
  if (!detail || detail.user.profileDocumentId) return true;

  const updatedUser = await input.orgManagerActions.ensureRosterProfileDocument(
    detail.user,
    input.names,
  );
  if (!input.isOperationActive(input.operationOrganizationId)) return false;
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
  return input.isOperationActive(input.operationOrganizationId);
}

async function importRosterIdentityLink(
  input: RosterIdentityLinkImport,
  names: RosterProfileNames,
  verifyLink: UserIdentities["verifyLink"],
) {
  const {
    appData,
    canImportRosterUser,
    directory,
    importUserIdDraft,
    memberGroupId,
    orgManagerActions,
    refreshDirectoryAndGroups,
    refreshSelectedUserDetail,
    selectUser,
    setOrgManagerView,
    setError,
    setImportUserIdDraft,
    setIsImportUserDialogOpen,
    setMutating,
    isOperationActive,
    logError,
  } = input;
  const identityLink = importUserIdDraft.trim();
  if (
    !canImportRosterUser ||
    !directory ||
    !memberGroupId ||
    identityLink.length === 0 ||
    !appData.auth.userId ||
    !appData.crypto.signingFingerprint ||
    !appData.crypto.signingKeyPair ||
    !appData.crypto.encapsulationKeyPair
  ) {
    return;
  }
  const operationOrganizationId = directory.organizationId;
  await runScopedOrgMutation({
    isOperationActive,
    logError,
    operationOrganizationId,
    run: async () => {
      const identity = await verifyLink(identityLink);
      if (!isOperationActive(operationOrganizationId)) return;
      const targetUserId = identity.userId;
      const targetUser = await prepareRosterImport({
        isOperationActive,
        memberGroupId,
        operationOrganizationId,
        orgManagerActions,
        setError,
        targetUserId,
      });
      if (!targetUser) {
        return;
      }

      await refreshDirectoryAndGroups({
        afterMutation: true,
        mutationResult: targetUser.mutationResult,
        skipNextGroupDetailsEffect: true,
      });
      if (!isOperationActive(operationOrganizationId)) {
        return;
      }
      const profileSeeded = await seedImportedRosterProfile({
        isOperationActive,
        names,
        operationOrganizationId,
        orgManagerActions,
        refreshDirectoryAndGroups,
        setError,
        userId: targetUser.userId,
      });
      if (!profileSeeded) {
        return;
      }
      setImportUserIdDraft("");
      setIsImportUserDialogOpen(false);
      setOrgManagerView("directory");
      selectUser(targetUser.userId);
      await refreshSelectedUserDetail(targetUser.userId);
    },
    setError,
    setMutating,
  });
}

export function useImportRosterIdentityLink(input: RosterIdentityLinkImport) {
  const { verifyLink } = useIdentityLinks();
  return useCallback(
    (names: RosterProfileNames) =>
      importRosterIdentityLink(input, names, verifyLink),
    [
      verifyLink,
      input.appData,
      input.canImportRosterUser,
      input.directory,
      input.importUserIdDraft,
      input.memberGroupId,
      input.orgManagerActions,
      input.refreshDirectoryAndGroups,
      input.refreshSelectedUserDetail,
      input.selectUser,
      input.setOrgManagerView,
      input.setError,
      input.setImportUserIdDraft,
      input.setIsImportUserDialogOpen,
      input.setMutating,
      input.isOperationActive,
      input.logError,
    ],
  );
}
