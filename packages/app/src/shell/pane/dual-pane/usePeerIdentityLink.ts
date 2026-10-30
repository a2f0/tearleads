import { useDualPane } from "./useDualPane";
import { usePaneSide } from "./usePaneSide";

/**
 * The other pane's identity link. A pane admits its peer (as a contact, roster
 * member, or share recipient) only by verifying this link, never by user ID.
 */
export function usePeerIdentityLink(): string | null {
  const { leftIdentityLink, peerUserIdsEnabled, rightIdentityLink } =
    useDualPane();
  const side = usePaneSide();
  if (!peerUserIdsEnabled) {
    return null;
  }

  return side === "left" ? rightIdentityLink : leftIdentityLink;
}
