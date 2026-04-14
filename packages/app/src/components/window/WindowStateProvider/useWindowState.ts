import { useMemo } from "react";
import { useWindowActions } from "./useWindowActions";
import { useWindowStateData } from "./useWindowStateData";

export function useWindowState() {
  const state = useWindowStateData();
  const actions = useWindowActions();

  return useMemo(
    () => ({
      ...state,
      ...actions,
    }),
    [state, actions],
  );
}
