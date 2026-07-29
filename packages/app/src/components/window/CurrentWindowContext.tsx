import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
} from "react";

interface CurrentWindowContextValue {
  close: () => void;
  id: string;
  overlayHost: HTMLElement | null;
  showStatusMessage: (message: string) => void;
}

const CurrentWindowContext = createContext<CurrentWindowContextValue | null>(
  null,
);

export function CurrentWindowProvider({
  children,
  close,
  id,
  overlayHost,
  showStatusMessage,
}: PropsWithChildren<CurrentWindowContextValue>) {
  const value = useMemo(
    () => ({ close, id, overlayHost, showStatusMessage }),
    [close, id, overlayHost, showStatusMessage],
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
