import { type PropsWithChildren, useMemo, useState } from "react";

import { dualPaneContext } from "./context";

interface DualPaneProviderProps extends PropsWithChildren {
  peerUserIdsEnabled?: boolean | undefined;
}

export function DualPaneProvider({
  children,
  peerUserIdsEnabled = true,
}: DualPaneProviderProps) {
  const [leftUserId, setLeftUserId] = useState<string | null>(null);
  const [rightUserId, setRightUserId] = useState<string | null>(null);

  const value = useMemo(
    () => ({
      leftUserId,
      peerUserIdsEnabled,
      rightUserId,
      setLeftUserId,
      setRightUserId,
    }),
    [leftUserId, peerUserIdsEnabled, rightUserId],
  );

  return (
    <dualPaneContext.context.Provider value={value}>
      {children}
    </dualPaneContext.context.Provider>
  );
}
