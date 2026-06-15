import { useCallback } from "react";
import { useMiniAppMessage } from "../../bus";

export function useOrgManagerRouteMessages(
  openGroupRoute: (groupId: string) => void,
) {
  useMiniAppMessage(
    "org-manager",
    useCallback(
      (message) => {
        if (message.type === "open-group") {
          openGroupRoute(message.groupId);
        }
      },
      [openGroupRoute],
    ),
  );
}
