import {
  createContext,
  type Dispatch,
  type PropsWithChildren,
  type SetStateAction,
  useContext,
  useEffect,
} from "react";

type MobileAppTitleSetter = Dispatch<SetStateAction<string | null>>;

const MobileAppTitleContext = createContext<MobileAppTitleSetter | null>(null);

export function formatMobileBrandLabel(
  title: string | null,
): string | undefined {
  return title ? `Tearleads - ${title}` : undefined;
}

export function MobileAppTitleProvider({
  children,
  setTitle,
}: PropsWithChildren<{ setTitle: MobileAppTitleSetter }>) {
  return (
    <MobileAppTitleContext.Provider value={setTitle}>
      {children}
    </MobileAppTitleContext.Provider>
  );
}

export function usePublishMobileAppTitle(title: string | null): void {
  const setTitle = useContext(MobileAppTitleContext);

  useEffect(() => {
    if (!setTitle) {
      return;
    }

    setTitle(title);
    return () => setTitle(null);
  }, [setTitle, title]);
}
