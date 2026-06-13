import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
} from "react";

interface CurrentWindowContextValue {
  close: () => void;
  id: string;
}

const CurrentWindowContext = createContext<CurrentWindowContextValue | null>(
  null,
);

export function CurrentWindowProvider({
  children,
  close,
  id,
}: PropsWithChildren<CurrentWindowContextValue>) {
  const value = useMemo(() => ({ close, id }), [close, id]);

  return (
    <CurrentWindowContext.Provider value={value}>
      {children}
    </CurrentWindowContext.Provider>
  );
}

export function useCurrentWindow() {
  return useContext(CurrentWindowContext);
}
