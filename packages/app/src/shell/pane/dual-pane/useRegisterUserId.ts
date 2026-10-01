import { useEffect } from "react";

import { useDualPane } from "./useDualPane";
import { usePaneSide } from "./usePaneSide";

export function useRegisterUserId(userId: string | null): void {
  const { peerUserIdsEnabled, setLeftUserId, setRightUserId } = useDualPane();
  const side = usePaneSide();
  useEffect(() => {
    if (!peerUserIdsEnabled) {
      return;
    }

    const setter = side === "left" ? setLeftUserId : setRightUserId;
    setter(userId);
    return () => {
      setter((currentUserId) =>
        currentUserId === userId ? null : currentUserId,
      );
    };
  }, [userId, side, peerUserIdsEnabled, setLeftUserId, setRightUserId]);
}
