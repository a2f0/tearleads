import type { OrganizationDirectory } from "@symcrypt/client-sdk";
import { useEffect } from "react";

export function useClearMissingOrgManagerUser(
  directory: OrganizationDirectory | null,
  selectedUserId: string | null,
  selectUser: (userId: string | null) => void,
): void {
  useEffect(() => {
    if (
      directory &&
      selectedUserId &&
      !directory.users.some((user) => user.userId === selectedUserId)
    ) {
      selectUser(null);
    }
  }, [directory, selectedUserId, selectUser]);
}
