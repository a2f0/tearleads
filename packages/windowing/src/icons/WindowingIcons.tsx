import { ArrowDownIcon } from "@phosphor-icons/react/dist/csr/ArrowDown";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
} from "react";
import type { WindowingIcon } from "./windowingIcon";

/** The icons the window chrome draws on its own. */
export interface WindowingIcons {
  /** The toolbar's Back button. */
  back: WindowingIcon;
  /** Move Backward, in a title bar's context menu. */
  moveBackward: WindowingIcon;
  /** Move Forward, in a title bar's context menu. */
  moveForward: WindowingIcon;
}

const PHOSPHOR_ICONS: WindowingIcons = {
  back: CaretLeftIcon,
  moveBackward: ArrowDownIcon,
  moveForward: ArrowUpIcon,
};

const WindowingIconsContext = createContext<WindowingIcons>(PHOSPHOR_ICONS);

/** The chrome's icons: Phosphor's, unless a provider replaces them. */
export function useWindowingIcons(): WindowingIcons {
  return useContext(WindowingIconsContext);
}

/**
 * Draws the chrome inside it with `icons` in place of its Phosphor defaults, so
 * the chrome can match a host's icon set. An icon left out keeps the one from
 * the nearest provider above, or the default.
 */
export function WindowingIconsProvider({
  children,
  icons,
}: PropsWithChildren<{ icons: Partial<WindowingIcons> }>) {
  const inherited = useWindowingIcons();
  const { back, moveBackward, moveForward } = icons;
  const value = useMemo(
    () => ({
      back: back ?? inherited.back,
      moveBackward: moveBackward ?? inherited.moveBackward,
      moveForward: moveForward ?? inherited.moveForward,
    }),
    [back, inherited, moveBackward, moveForward],
  );
  return (
    <WindowingIconsContext.Provider value={value}>
      {children}
    </WindowingIconsContext.Provider>
  );
}
