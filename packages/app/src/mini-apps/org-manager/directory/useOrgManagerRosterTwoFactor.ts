import { useCallback } from "react";
import type { OrgManagerMutationsParams } from "../hooks/orgManagerMutationsTypes";
import { runScopedOrgMutation } from "../hooks/runScopedOrgMutation";

type RosterTwoFactorParams = Pick<
  OrgManagerMutationsParams,
  | "directory"
  | "orgManagerActions"
  | "refreshDirectoryAndGroups"
  | "refreshSelectedUserDetail"
  | "setError"
  | "setMutating"
> & {
  readonly isOperationActive: (organizationId: string) => boolean;
  readonly logError: (message: string | Error, cause?: unknown) => void;
};

/**
 * An administrator requires, or stops requiring, two-factor sign-in for a
 * member. The server enforces it; the roster shows it once reloaded.
 */
export function useOrgManagerRosterTwoFactor({
  directory,
  isOperationActive,
  logError,
  orgManagerActions,
  refreshDirectoryAndGroups,
  refreshSelectedUserDetail,
  setError,
  setMutating,
}: RosterTwoFactorParams) {
  return useCallback(
    async (userId: string, required: boolean) => {
      if (!directory?.currentUser.isOrgAdmin) return;
      const operationOrganizationId = directory.organizationId;
      await runScopedOrgMutation({
        isOperationActive,
        logError,
        operationOrganizationId,
        run: async () => {
          const updated = await orgManagerActions.setRosterTwoFactorRequired(
            userId,
            required,
          );
          if (!updated) {
            throw new Error("Could not change the two-factor requirement.");
          }
          if (!isOperationActive(operationOrganizationId)) return;
          await refreshDirectoryAndGroups({
            afterMutation: true,
            skipNextGroupDetailsEffect: true,
          });
          if (!isOperationActive(operationOrganizationId)) return;
          await refreshSelectedUserDetail(userId);
        },
        setError,
        setMutating,
      });
    },
    [
      directory,
      isOperationActive,
      logError,
      orgManagerActions,
      refreshDirectoryAndGroups,
      refreshSelectedUserDetail,
      setError,
      setMutating,
    ],
  );
}
