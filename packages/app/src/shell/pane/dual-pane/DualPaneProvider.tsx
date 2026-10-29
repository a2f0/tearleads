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
  const [leftIdentityLink, setLeftIdentityLink] = useState<string | null>(null);
  const [rightIdentityLink, setRightIdentityLink] = useState<string | null>(
    null,
  );

  const value = useMemo(
    () => ({
      leftIdentityLink,
      leftUserId,
      peerUserIdsEnabled,
      rightIdentityLink,
      rightUserId,
      setLeftIdentityLink,
      setLeftUserId,
      setRightIdentityLink,
      setRightUserId,
    }),
    [
      leftIdentityLink,
      leftUserId,
      peerUserIdsEnabled,
      rightIdentityLink,
      rightUserId,
    ],
  );

  return (
    <dualPaneContext.context.Provider value={value}>
      {children}
    </dualPaneContext.context.Provider>
  );
}
