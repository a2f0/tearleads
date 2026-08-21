import type { OrganizationDirectoryAndGroups } from "@symcrypt/client-sdk";
import { useCallback } from "react";
import type { RuntimeSnapshot } from "../../../providers/sdk/SymCryptProvider";
import { getExplorerAttributionUserLabel } from "../detail/attributionDisplay";
import { useExplorerAttributionProfileDisplayNames } from "./useExplorerAttributionProfileDisplayNames";

export function useExplorerAttributionUserLabels(input: {
  appData: RuntimeSnapshot;
  enabled: boolean;
  readModelProjection?: OrganizationDirectoryAndGroups | null | undefined;
  readModelRevision?: number | undefined;
}) {
  const profileDisplayNamesByUserId = useExplorerAttributionProfileDisplayNames(
    {
      appData: input.appData,
      enabled: input.enabled,
      readModelProjection: input.readModelProjection,
      readModelRevision: input.readModelRevision,
    },
  );
  return useCallback(
    (userId: string | null | undefined) =>
      getExplorerAttributionUserLabel({
        currentUserId: input.appData.auth.userId,
        profileDisplayNamesByUserId,
        userId,
      }),
    [input.appData.auth.userId, profileDisplayNamesByUserId],
  );
}
