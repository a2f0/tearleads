import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
} from "react";

interface CurrentWindowContextValue {
  close: () => void;
  id: string;
  showStatusMessage: (message: string) => void;
}

const CurrentWindowContext = createContext<CurrentWindowContextValue | null>(
  null,
);

export function CurrentWindowProvider({
  children,
  close,
  id,
  showStatusMessage,
}: PropsWithChildren<CurrentWindowContextValue>) {
  const value = useMemo(
    () => ({ close, id, showStatusMessage }),
    [close, id, showStatusMessage],
  );

  return (
    <CurrentWindowContext.Provider value={value}>
      {children}
    </CurrentWindowContext.Provider>
  );
}

export function useCurrentWindow() {
  return useContext(CurrentWindowContext);
}
