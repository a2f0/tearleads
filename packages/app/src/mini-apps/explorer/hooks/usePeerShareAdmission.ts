import { useMemo } from "react";
import { useIdentityLinks } from "../../../providers/identity-links/useIdentityLinks";
import {
  usePeerIdentityLink,
  usePeerUserId,
} from "../../../shell/pane/dual-pane";
import type { useExplorer } from "../../../stores/explorer/ExplorerProvider";

type ExplorerValue = ReturnType<typeof useExplorer>;

/**
 * Sharing a folder admits its recipient, and only a verified identity link can
 * do that. Share with Peer therefore verifies the peer pane's published link
 * before the share; the SDK refuses a recipient that is not link-verified.
 */
export function usePeerShareAdmission(explorer: ExplorerValue): ExplorerValue {
  const peerUserId = usePeerUserId();
  const peerLink = usePeerIdentityLink();
  const { verifyLink } = useIdentityLinks();
  return useMemo(() => {
    const share = explorer.shareWithUser;
    return {
      ...explorer,
      shareWithUser: async (containerId: string, userId: string) => {
        if (userId === peerUserId && peerLink) {
          const identity = await verifyLink(peerLink);
          if (identity.userId !== userId) {
            throw new Error("The peer's identity link names another user.");
          }
        }
        return share(containerId, userId);
      },
    };
  }, [explorer, peerLink, peerUserId, verifyLink]);
}
