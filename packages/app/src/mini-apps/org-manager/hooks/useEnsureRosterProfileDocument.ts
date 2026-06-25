import type {
  OrganizationDirectory,
  OrganizationDirectoryUser,
  OrganizationUserDetail,
} from "@tearleads/client-sdk";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef } from "react";
import type { useTearleadsRuntime } from "../../../providers/sdk/TearleadsProvider";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import { ORG_MANAGER_LABELS } from "../labels";
import { setUnknownError } from "../refresh";

interface EnsureRosterProfileDocumentParams {
  appData: ReturnType<typeof useTearleadsRuntime>;
  canLoadAuthenticatedOrgData: boolean;
  canUpdateSelectedRosterEntry: boolean;
  orgManagerActions: ReturnType<typeof useOrgManagerActions>;
  selectedRosterUser: OrganizationDirectoryUser | null;
  selectedUserIdRef: { current: string | null };
  setDirectory: Dispatch<SetStateAction<OrganizationDirectory | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setMutating: Dispatch<SetStateAction<boolean>>;
  setUserDetail: Dispatch<SetStateAction<OrganizationUserDetail | null>>;
}

export function useEnsureRosterProfileDocument(
  params: EnsureRosterProfileDocumentParams,
) {
  const {
    appData,
    canLoadAuthenticatedOrgData,
    canUpdateSelectedRosterEntry,
    orgManagerActions,
    selectedRosterUser,
    selectedUserIdRef,
    setDirectory,
    setError,
    setMutating,
    setUserDetail,
  } = params;
  const profileDocumentCreationKeysRef = useRef<Set<string>>(new Set());

  const updateRosterUserState = useCallback(
    (updatedUser: OrganizationDirectoryUser) => {
      setDirectory((currentDirectory) => {
        if (!currentDirectory) {
          return currentDirectory;
        }

        return {
          ...currentDirectory,
          users: currentDirectory.users.map((user) =>
            user.userId === updatedUser.userId ? updatedUser : user,
          ),
        };
      });
      setUserDetail((currentUserDetail) =>
        currentUserDetail?.user.userId === updatedUser.userId
          ? { ...currentUserDetail, user: updatedUser }
          : currentUserDetail,
      );
    },
    [setDirectory, setUserDetail],
  );

  useEffect(() => {
    if (
      !selectedRosterUser ||
      selectedRosterUser.profileDocumentId ||
      !canLoadAuthenticatedOrgData ||
      !canUpdateSelectedRosterEntry ||
      !appData.auth.organizationId
    ) {
      return;
    }

    const profileDocumentCreationKey = `${appData.auth.organizationId}:${selectedRosterUser.userId}`;
    if (
      profileDocumentCreationKeysRef.current.has(profileDocumentCreationKey)
    ) {
      return;
    }

    profileDocumentCreationKeysRef.current.add(profileDocumentCreationKey);
    setMutating(true);
    setError(null);

    void orgManagerActions
      .ensureRosterProfileDocument(selectedRosterUser)
      .then((updatedUser) => {
        if (!updatedUser) {
          if (selectedUserIdRef.current === selectedRosterUser.userId) {
            setError(ORG_MANAGER_LABELS.failedCreateProfileDocument);
          }
          return;
        }

        updateRosterUserState(updatedUser);
      })
      .catch((nextError: unknown) => {
        if (selectedUserIdRef.current === selectedRosterUser.userId) {
          setUnknownError(setError, nextError);
        }
      })
      .finally(() => {
        profileDocumentCreationKeysRef.current.delete(
          profileDocumentCreationKey,
        );
        if (profileDocumentCreationKeysRef.current.size === 0) {
          setMutating(false);
        }
      });
  }, [
    appData.auth.organizationId,
    canLoadAuthenticatedOrgData,
    orgManagerActions,
    canUpdateSelectedRosterEntry,
    selectedRosterUser,
    selectedUserIdRef,
    setError,
    setMutating,
    updateRosterUserState,
  ]);
}
