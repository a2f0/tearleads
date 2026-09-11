import { useEffect, useEffectEvent } from "react";

export function useRecoveryKeyPrivacy(hide: () => void) {
  const hideForBackground = useEffectEvent(hide);
  useEffect(() => {
    const onPageHide = () => hideForBackground();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") hideForBackground();
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);
}
