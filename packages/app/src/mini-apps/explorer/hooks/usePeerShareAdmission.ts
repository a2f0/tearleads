import type { ContainerShareAccessLevel } from "@tearleads/client-sdk";
import { useMemo } from "react";
import { useIdentityLinks } from "../../../providers/identity-links/useIdentityLinks";
import {
  usePeerIdentityLink,
  usePeerUserId,
} from "../../../shell/pane/dual-pane";
import type { useExplorer } from "../../../stores/explorer/ExplorerProvider";

type ExplorerValue = ReturnType<typeof useExplorer>;

/**
 * A peer pane's published link provides direct recipient admission. Verify it
 * when available; otherwise leave admission through signed Members history to
 * the SDK, as for any roster selection. Neither path trusts directory keys.
 */
export function usePeerShareAdmission(explorer: ExplorerValue): ExplorerValue {
  const peerUserId = usePeerUserId();
  const peerLink = usePeerIdentityLink();
  const { verifyLink } = useIdentityLinks();
  return useMemo(() => {
    const share = explorer.shareWithUser;
    return {
      ...explorer,
      shareWithUser: async (
        containerId: string,
        userId: string,
        accessLevel: ContainerShareAccessLevel,
      ) => {
        if (userId === peerUserId && peerLink) {
          const identity = await verifyLink(peerLink);
          if (identity.userId !== userId) {
            throw new Error("The peer's identity link names another user.");
          }
        }
        return share(containerId, userId, accessLevel);
      },
    };
  }, [explorer, peerLink, peerUserId, verifyLink]);
}
