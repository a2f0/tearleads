import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useWindowItemRegistration } from "./useWindowItemRegistration";
import {
  sameWindowItem,
  selectHighestPriorityItem,
  useWindowItemRegistry,
} from "./useWindowItemRegistry";
import { useWindowToolbarReservationRegistry } from "./useWindowToolbarReservationRegistry";
import {
  createBackAction,
  createRegisteredBackAction,
  createRegisteredTitleBarAction,
  createTitleBarActions,
  type RegisteredWindowBackAction,
  type RegisteredWindowTitleBarAction,
  type WindowBackAction,
  type WindowBackActionInput,
  type WindowTitleBarActionInput,
} from "./WindowChromeActions";
import type { WindowMenuItem } from "./WindowMenuBar";
import type { WindowTitleBarAction } from "./WindowTitleBar";
import {
  createMenuItems,
  createRefreshMenuItem,
  REFRESH_LABEL,
  type RegisteredWindowMenuItem,
  type RegisteredWindowRefreshMenuItem,
} from "./windowMenuRegistrations";

interface WindowRefreshMenuItemInput {
  disabled?: boolean;
  label?: string;
  onRefresh: () => unknown;
  priority?: number;
  refreshing?: boolean;
}

interface WindowFileMenuItemInput {
  disabled?: boolean;
  id: string;
  label: string;
  onClick: () => unknown;
  priority?: number;
}

function createRegisteredMenuItem(
  item: WindowFileMenuItemInput,
  onClick: () => unknown,
): RegisteredWindowMenuItem {
  return {
    disabled: item.disabled ?? false,
    id: item.id,
    label: item.label,
    onClick,
    priority: item.priority ?? 0,
  };
}

function createRegisteredRefreshMenuItem(
  item: WindowRefreshMenuItemInput,
  onRefresh: () => unknown,
): RegisteredWindowRefreshMenuItem {
  return {
    disabled: item.disabled ?? false,
    label: item.label ?? REFRESH_LABEL,
    onRefresh,
    priority: item.priority ?? 0,
    refreshing: item.refreshing ?? false,
  };
}

interface WindowMenuContextValue {
  fileMenuItems: WindowMenuItem[];
  viewMenuItems: WindowMenuItem[];
  /**
   * The winning refresh registration, also folded into `viewMenuItems` for the
   * windowed menu bar. Exposed on its own because the routed shell has no menu
   * bar and renders it as an app bar toolbar button instead.
   */
  refreshMenuItem: WindowMenuItem | null;
  titleBarActions: WindowTitleBarAction[];
  backAction: WindowBackAction | null;
  toolbarReserved: boolean;
  toolbarReservationReleased: boolean;
  registerFileMenuItem: (id: object, item: RegisteredWindowMenuItem) => void;
  unregisterFileMenuItem: (id: object) => void;
  registerViewMenuItem: (id: object, item: RegisteredWindowMenuItem) => void;
  unregisterViewMenuItem: (id: object) => void;
  registerTitleBarAction: (
    id: object,
    item: RegisteredWindowTitleBarAction,
  ) => void;
  unregisterTitleBarAction: (id: object) => void;
  registerBackAction: (id: object, item: RegisteredWindowBackAction) => void;
  unregisterBackAction: (id: object) => void;
  registerRefreshMenuItem: (
    id: object,
    item: RegisteredWindowRefreshMenuItem,
  ) => void;
  unregisterRefreshMenuItem: (id: object) => void;
  registerToolbarReservation: (id: object, reserved: boolean) => void;
  unregisterToolbarReservation: (id: object) => void;
}

const WindowMenuContext = createContext<WindowMenuContextValue>({
  fileMenuItems: [],
  viewMenuItems: [],
  refreshMenuItem: null,
  titleBarActions: [],
  backAction: null,
  toolbarReserved: false,
  toolbarReservationReleased: false,
  registerFileMenuItem: () => {},
  unregisterFileMenuItem: () => {},
  registerViewMenuItem: () => {},
  unregisterViewMenuItem: () => {},
  registerTitleBarAction: () => {},
  unregisterTitleBarAction: () => {},
  registerBackAction: () => {},
  unregisterBackAction: () => {},
  registerRefreshMenuItem: () => {},
  unregisterRefreshMenuItem: () => {},
  registerToolbarReservation: () => {},
  unregisterToolbarReservation: () => {},
});

function useWindowMenuContextValue(): WindowMenuContextValue {
  const fileMenu =
    useWindowItemRegistry<RegisteredWindowMenuItem>(sameWindowItem);
  const viewMenu =
    useWindowItemRegistry<RegisteredWindowMenuItem>(sameWindowItem);
  const titleBar =
    useWindowItemRegistry<RegisteredWindowTitleBarAction>(sameWindowItem);
  const back =
    useWindowItemRegistry<RegisteredWindowBackAction>(sameWindowItem);
  const refresh =
    useWindowItemRegistry<RegisteredWindowRefreshMenuItem>(sameWindowItem);
  const toolbarReservation = useWindowToolbarReservationRegistry();

  const fileMenuItemList = useMemo(
    () => createMenuItems(fileMenu.items),
    [fileMenu.items],
  );
  const refreshMenuItem = useMemo(
    () => createRefreshMenuItem(selectHighestPriorityItem(refresh.items)),
    [refresh.items],
  );
  const viewMenuItemList = useMemo(
    () => [
      ...createMenuItems(viewMenu.items),
      ...(refreshMenuItem ? [refreshMenuItem] : []),
    ],
    [refreshMenuItem, viewMenu.items],
  );
  const titleBarActionList = useMemo(
    () => createTitleBarActions(titleBar.items),
    [titleBar.items],
  );
  const backAction = useMemo(
    () => createBackAction(selectHighestPriorityItem(back.items)),
    [back.items],
  );

  const value = useMemo(
    () => ({
      fileMenuItems: fileMenuItemList,
      viewMenuItems: viewMenuItemList,
      refreshMenuItem,
      titleBarActions: titleBarActionList,
      backAction,
      toolbarReserved: toolbarReservation.reserved,
      toolbarReservationReleased: toolbarReservation.released,
      registerFileMenuItem: fileMenu.registerItem,
      unregisterFileMenuItem: fileMenu.unregisterItem,
      registerViewMenuItem: viewMenu.registerItem,
      unregisterViewMenuItem: viewMenu.unregisterItem,
      registerTitleBarAction: titleBar.registerItem,
      unregisterTitleBarAction: titleBar.unregisterItem,
      registerBackAction: back.registerItem,
      unregisterBackAction: back.unregisterItem,
      registerRefreshMenuItem: refresh.registerItem,
      unregisterRefreshMenuItem: refresh.unregisterItem,
      registerToolbarReservation: toolbarReservation.register,
      unregisterToolbarReservation: toolbarReservation.unregister,
    }),
    [
      fileMenuItemList,
      viewMenuItemList,
      refreshMenuItem,
      titleBarActionList,
      backAction,
      toolbarReservation,
      fileMenu.registerItem,
      fileMenu.unregisterItem,
      viewMenu.registerItem,
      viewMenu.unregisterItem,
      titleBar.registerItem,
      titleBar.unregisterItem,
      back.registerItem,
      back.unregisterItem,
      refresh.registerItem,
      refresh.unregisterItem,
    ],
  );

  return value;
}

export function WindowMenuProvider({ children }: PropsWithChildren) {
  const value = useWindowMenuContextValue();

  return (
    <WindowMenuContext.Provider value={value}>
      {children}
    </WindowMenuContext.Provider>
  );
}

export function useWindowFileMenuItems(): WindowMenuItem[] {
  return useContext(WindowMenuContext).fileMenuItems;
}

export function useWindowViewMenuItems(): WindowMenuItem[] {
  return useContext(WindowMenuContext).viewMenuItems;
}

export function useWindowRefreshMenuItemValue(): WindowMenuItem | null {
  return useContext(WindowMenuContext).refreshMenuItem;
}

export function useWindowTitleBarActions(): WindowTitleBarAction[] {
  return useContext(WindowMenuContext).titleBarActions;
}

export function useWindowBackActionValue(): WindowBackAction | null {
  return useContext(WindowMenuContext).backAction;
}

export function useWindowToolbarReserved(): boolean {
  return useContext(WindowMenuContext).toolbarReserved;
}

export function useWindowToolbarReservationReleased(): boolean {
  return useContext(WindowMenuContext).toolbarReservationReleased;
}

function useRegisteredWindowMenuItem(
  item: WindowFileMenuItemInput | null,
  registerMenuItem: (id: object, item: RegisteredWindowMenuItem) => void,
  unregisterMenuItem: (id: object) => void,
): void {
  useWindowItemRegistration({
    action: item?.onClick ?? null,
    createRegisteredItem: createRegisteredMenuItem,
    input: item,
    registerItem: registerMenuItem,
    unregisterItem: unregisterMenuItem,
  });
}

export function useWindowFileMenuItem(
  item: WindowFileMenuItemInput | null,
): void {
  const { registerFileMenuItem, unregisterFileMenuItem } =
    useContext(WindowMenuContext);
  useRegisteredWindowMenuItem(
    item,
    registerFileMenuItem,
    unregisterFileMenuItem,
  );
}

export function useWindowViewMenuItem(
  item: WindowFileMenuItemInput | null,
): void {
  const { registerViewMenuItem, unregisterViewMenuItem } =
    useContext(WindowMenuContext);
  useRegisteredWindowMenuItem(
    item,
    registerViewMenuItem,
    unregisterViewMenuItem,
  );
}

/**
 * Registers an action in the current window's title bar.
 *
 * Keep `item` and its `icon` reference-stable, such as by memoizing them with
 * `useMemo`, so the window does not re-register the action on every render.
 */
export function useWindowTitleBarAction(
  item: WindowTitleBarActionInput | null,
): void {
  const { registerTitleBarAction, unregisterTitleBarAction } =
    useContext(WindowMenuContext);
  useWindowItemRegistration({
    action: item?.onClick ?? null,
    createRegisteredItem: createRegisteredTitleBarAction,
    input: item,
    registerItem: registerTitleBarAction,
    unregisterItem: unregisterTitleBarAction,
  });
}

export function useWindowBackAction(item: WindowBackActionInput | null): void {
  const { registerBackAction, unregisterBackAction } =
    useContext(WindowMenuContext);
  useWindowItemRegistration({
    action: item?.onClick ?? null,
    createRegisteredItem: createRegisteredBackAction,
    input: item,
    registerItem: registerBackAction,
    unregisterItem: unregisterBackAction,
  });
}

/**
 * Keeps this window's toolbar row reserved (rendered) while the caller is
 * mounted, even when it registers no title-bar or back actions. A mini-app that
 * wants explorer-style chrome on every route — a blank bar on the routes that
 * have no actions rather than a collapsing/reappearing row — calls this once.
 * Pass `reserve = false` to release the reservation without unmounting.
 */
export function useWindowToolbarReservation(reserve = true): void {
  const { registerToolbarReservation, unregisterToolbarReservation } =
    useContext(WindowMenuContext);
  const idRef = useRef<object>({});
  const hasEverReservedRef = useRef(false);

  useEffect(() => {
    const id = idRef.current;

    if (reserve) {
      hasEverReservedRef.current = true;
      registerToolbarReservation(id, true);
      return () => unregisterToolbarReservation(id);
    }

    if (!hasEverReservedRef.current) {
      return;
    }

    // A caller that previously reserved the row is now explicitly releasing it.
    // This lets WindowToolBar clear its latched blank row while callers that
    // never opted into reservations keep the older latch-once behavior.
    registerToolbarReservation(id, false);
    return () => unregisterToolbarReservation(id);
  }, [reserve, registerToolbarReservation, unregisterToolbarReservation]);
}

export function useWindowRefreshMenuItem(
  item: WindowRefreshMenuItemInput | null,
): void {
  const { registerRefreshMenuItem, unregisterRefreshMenuItem } =
    useContext(WindowMenuContext);
  useWindowItemRegistration({
    action: item?.onRefresh ?? null,
    createRegisteredItem: createRegisteredRefreshMenuItem,
    input: item,
    registerItem: registerRefreshMenuItem,
    unregisterItem: unregisterRefreshMenuItem,
  });
}
