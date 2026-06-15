import { type PropsWithChildren, useMemo, useState } from "react";

import { DualPaneContext } from "./context";

export function DualPaneProvider({ children }: PropsWithChildren) {
  const [leftUserId, setLeftUserId] = useState<string | null>(null);
  const [rightUserId, setRightUserId] = useState<string | null>(null);

  const value = useMemo(
    () => ({ leftUserId, rightUserId, setLeftUserId, setRightUserId }),
    [leftUserId, rightUserId],
  );

  return (
    <DualPaneContext.Provider value={value}>
      {children}
    </DualPaneContext.Provider>
  );
}
