import type { UserIdentities } from "@tearleads/client-sdk";
import { useCallback } from "react";
import { useIdentityLinks } from "../../../providers/identity-links/useIdentityLinks";
import { prepareRosterImport } from "../groups/orgManagerMutationOperations";
import type { OrgManagerMutationsParams } from "../hooks/orgManagerMutationsTypes";
import { runScopedOrgMutation } from "../hooks/runScopedOrgMutation";

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

async function importRosterIdentityLink(
  input: RosterIdentityLinkImport,
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
        skipNextGroupDetailsEffect: true,
      });
      if (!isOperationActive(operationOrganizationId)) {
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
    () => importRosterIdentityLink(input, verifyLink),
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
