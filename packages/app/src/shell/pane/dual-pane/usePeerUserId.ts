import { useDualPane } from "./useDualPane";
import { usePaneSide } from "./usePaneSide";

export function usePeerUserId(): string | null {
  const { leftUserId, peerUserIdsEnabled, rightUserId } = useDualPane();
  const side = usePaneSide();
  if (!peerUserIdsEnabled) {
    return null;
  }

  return side === "left" ? rightUserId : leftUserId;
}
