import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import {
  selectHighestPriorityItem,
  useWindowItemRegistry,
} from "./useWindowItemRegistry";
import { useWindowToolbarReservationRegistry } from "./useWindowToolbarReservationRegistry";
import {
  createBackAction,
  createTitleBarActions,
  type RegisteredWindowBackAction,
  type RegisteredWindowTitleBarAction,
  sameBackAction,
  sameTitleBarAction,
  useRegisteredWindowBackAction,
  useRegisteredWindowTitleBarAction,
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
  sameMenuItem,
  sameRefreshMenuItem,
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
    useWindowItemRegistry<RegisteredWindowMenuItem>(sameMenuItem);
  const viewMenu =
    useWindowItemRegistry<RegisteredWindowMenuItem>(sameMenuItem);
  const titleBar =
    useWindowItemRegistry<RegisteredWindowTitleBarAction>(sameTitleBarAction);
  const back =
    useWindowItemRegistry<RegisteredWindowBackAction>(sameBackAction);
  const refresh =
    useWindowItemRegistry<RegisteredWindowRefreshMenuItem>(sameRefreshMenuItem);
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
  const { fileMenuItems } = useContext(WindowMenuContext);
  return fileMenuItems;
}

export function useWindowViewMenuItems(): WindowMenuItem[] {
  const { viewMenuItems } = useContext(WindowMenuContext);
  return viewMenuItems;
}

export function useWindowRefreshMenuItemValue(): WindowMenuItem | null {
  const { refreshMenuItem } = useContext(WindowMenuContext);
  return refreshMenuItem;
}

export function useWindowTitleBarActions(): WindowTitleBarAction[] {
  const { titleBarActions } = useContext(WindowMenuContext);
  return titleBarActions;
}

export function useWindowBackActionValue(): WindowBackAction | null {
  const { backAction } = useContext(WindowMenuContext);
  return backAction;
}

export function useWindowToolbarReserved(): boolean {
  const { toolbarReserved } = useContext(WindowMenuContext);
  return toolbarReserved;
}

export function useWindowToolbarReservationReleased(): boolean {
  const { toolbarReservationReleased } = useContext(WindowMenuContext);
  return toolbarReservationReleased;
}

function useRegisteredWindowMenuItem(
  item: WindowFileMenuItemInput | null,
  registerMenuItem: (id: object, item: RegisteredWindowMenuItem) => void,
  unregisterMenuItem: (id: object) => void,
): void {
  const registrationIdRef = useRef<object>({});
  const onClickRef = useRef<WindowFileMenuItemInput["onClick"] | null>(null);
  const enabled = item !== null;
  const disabled = item?.disabled ?? false;
  const itemId = item?.id ?? "";
  const label = item?.label ?? "";
  const onClick = item?.onClick ?? null;
  const priority = item?.priority ?? 0;

  useLayoutEffect(() => {
    onClickRef.current = onClick;
  }, [onClick]);

  const handleClick = useCallback(() => {
    return onClickRef.current?.();
  }, []);

  useEffect(() => {
    const registrationId = registrationIdRef.current;

    if (!enabled) {
      return;
    }

    registerMenuItem(registrationId, {
      disabled,
      id: itemId,
      label,
      onClick: handleClick,
      priority,
    });

    return () => unregisterMenuItem(registrationId);
  }, [
    disabled,
    enabled,
    handleClick,
    itemId,
    label,
    priority,
    registerMenuItem,
    unregisterMenuItem,
  ]);
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
  useRegisteredWindowTitleBarAction(
    item,
    registerTitleBarAction,
    unregisterTitleBarAction,
  );
}

export function useWindowBackAction(item: WindowBackActionInput | null): void {
  const { registerBackAction, unregisterBackAction } =
    useContext(WindowMenuContext);
  useRegisteredWindowBackAction(item, registerBackAction, unregisterBackAction);
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
  const idRef = useRef<object>({});
  const onRefreshRef = useRef<WindowRefreshMenuItemInput["onRefresh"] | null>(
    null,
  );
  const enabled = item !== null;
  const disabled = item?.disabled ?? false;
  const label = item?.label ?? REFRESH_LABEL;
  const onRefresh = item?.onRefresh ?? null;
  const priority = item?.priority ?? 0;
  const refreshing = item?.refreshing ?? false;

  useLayoutEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  const handleRefresh = useCallback(() => {
    return onRefreshRef.current?.();
  }, []);

  useEffect(() => {
    const id = idRef.current;

    if (!enabled) {
      unregisterRefreshMenuItem(id);
      return;
    }

    registerRefreshMenuItem(id, {
      disabled,
      label,
      onRefresh: handleRefresh,
      priority,
      refreshing,
    });

    return () => unregisterRefreshMenuItem(id);
  }, [
    disabled,
    enabled,
    handleRefresh,
    label,
    priority,
    refreshing,
    registerRefreshMenuItem,
    unregisterRefreshMenuItem,
  ]);
}
