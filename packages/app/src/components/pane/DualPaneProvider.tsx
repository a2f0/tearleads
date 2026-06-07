import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type PaneSide = "left" | "right";

interface DualPaneContextValue {
  leftUserId: string | null;
  rightUserId: string | null;
  setLeftUserId: (id: string | null) => void;
  setRightUserId: (id: string | null) => void;
}

const DualPaneContext = createContext<DualPaneContextValue | null>(null);
const PaneSideContext = createContext<PaneSide | null>(null);

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

export function PaneSideProvider({
  side,
  children,
}: PropsWithChildren<{ side: PaneSide }>) {
  return (
    <PaneSideContext.Provider value={side}>{children}</PaneSideContext.Provider>
  );
}

function useDualPane(): DualPaneContextValue {
  const ctx = useContext(DualPaneContext);
  if (!ctx) {
    throw new Error("useDualPane must be used within a DualPaneProvider.");
  }
  return ctx;
}

export function usePaneSide(): PaneSide {
  const side = useContext(PaneSideContext);
  if (!side) {
    throw new Error("usePaneSide must be used within a PaneSideProvider.");
  }
  return side;
}

export function usePeerUserId(): string | null {
  const { leftUserId, rightUserId } = useDualPane();
  const side = usePaneSide();
  return side === "left" ? rightUserId : leftUserId;
}

export function useRegisterUserId(userId: string | null): void {
  const { setLeftUserId, setRightUserId } = useDualPane();
  const side = usePaneSide();
  useEffect(() => {
    const setter = side === "left" ? setLeftUserId : setRightUserId;
    setter(userId);
  }, [userId, side, setLeftUserId, setRightUserId]);
}
