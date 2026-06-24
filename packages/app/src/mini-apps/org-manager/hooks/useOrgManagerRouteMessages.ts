import { useCallback } from "react";
import { useMiniAppMessage } from "../../bus";
import type { OrgManagerGrantRouteRef } from "../routes";

export function useOrgManagerRouteMessages(
  openGroupRoute: (groupId: string) => void,
  openGrantRoute: (grantRef: OrgManagerGrantRouteRef) => void,
) {
  useMiniAppMessage(
    "org-manager",
    useCallback(
      (message) => {
        if (message.type === "open-group") {
          openGroupRoute(message.groupId);
          return;
        }

        if (message.type === "open-grant") {
          openGrantRoute({
            containerId: message.containerId,
            subjectId: message.subjectId,
            subjectType: message.subjectType,
          });
        }
      },
      [openGrantRoute, openGroupRoute],
    ),
  );
}
