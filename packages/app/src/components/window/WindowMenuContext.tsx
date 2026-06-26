import {
  createContext,
  type PropsWithChildren,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { useWindowItemRegistry } from "./useWindowItemRegistry";
import type { WindowMenuItem } from "./WindowMenuBar";
import type { WindowTitleBarAction } from "./WindowTitleBar";

const REFRESH_LABEL = "Refresh";
const REFRESHING_LABEL = "Refreshing...";

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

interface WindowTitleBarActionInput {
  disabled?: boolean;
  icon: ReactNode;
  id: string;
  label: string;
  onClick: () => unknown;
  priority?: number;
}

interface RegisteredWindowMenuItem {
  disabled: boolean;
  id: string;
  label: string;
  onClick: () => unknown;
  priority: number;
}

interface RegisteredWindowTitleBarAction {
  disabled: boolean;
  icon: ReactNode;
  id: string;
  label: string;
  onClick: () => unknown;
  priority: number;
}

interface RegisteredWindowRefreshMenuItem {
  disabled: boolean;
  label: string;
  onRefresh: () => unknown;
  priority: number;
  refreshing: boolean;
}

interface WindowMenuContextValue {
  fileMenuItems: WindowMenuItem[];
  viewMenuItems: WindowMenuItem[];
  titleBarActions: WindowTitleBarAction[];
  registerFileMenuItem: (id: object, item: RegisteredWindowMenuItem) => void;
  unregisterFileMenuItem: (id: object) => void;
  registerViewMenuItem: (id: object, item: RegisteredWindowMenuItem) => void;
  unregisterViewMenuItem: (id: object) => void;
  registerTitleBarAction: (
    id: object,
    item: RegisteredWindowTitleBarAction,
  ) => void;
  unregisterTitleBarAction: (id: object) => void;
  registerRefreshMenuItem: (
    id: object,
    item: RegisteredWindowRefreshMenuItem,
  ) => void;
  unregisterRefreshMenuItem: (id: object) => void;
}

const WindowMenuContext = createContext<WindowMenuContextValue>({
  fileMenuItems: [],
  viewMenuItems: [],
  titleBarActions: [],
  registerFileMenuItem: () => {},
  unregisterFileMenuItem: () => {},
  registerViewMenuItem: () => {},
  unregisterViewMenuItem: () => {},
  registerTitleBarAction: () => {},
  unregisterTitleBarAction: () => {},
  registerRefreshMenuItem: () => {},
  unregisterRefreshMenuItem: () => {},
});

function sameMenuItem(
  left: RegisteredWindowMenuItem | undefined,
  right: RegisteredWindowMenuItem,
): boolean {
  return (
    left !== undefined &&
    left.disabled === right.disabled &&
    left.id === right.id &&
    left.label === right.label &&
    left.onClick === right.onClick &&
    left.priority === right.priority
  );
}

function sameTitleBarAction(
  left: RegisteredWindowTitleBarAction | undefined,
  right: RegisteredWindowTitleBarAction,
): boolean {
  return (
    left !== undefined &&
    left.disabled === right.disabled &&
    left.icon === right.icon &&
    left.id === right.id &&
    left.label === right.label &&
    left.onClick === right.onClick &&
    left.priority === right.priority
  );
}

function sameRefreshMenuItem(
  left: RegisteredWindowRefreshMenuItem | undefined,
  right: RegisteredWindowRefreshMenuItem,
): boolean {
  return (
    left !== undefined &&
    left.disabled === right.disabled &&
    left.label === right.label &&
    left.onRefresh === right.onRefresh &&
    left.priority === right.priority &&
    left.refreshing === right.refreshing
  );
}

function selectRefreshMenuItem(
  items: ReadonlyMap<object, RegisteredWindowRefreshMenuItem>,
): RegisteredWindowRefreshMenuItem | null {
  let selected: RegisteredWindowRefreshMenuItem | null = null;

  for (const item of items.values()) {
    if (!selected || item.priority > selected.priority) {
      selected = item;
    }
  }

  return selected;
}

function createMenuItems(
  items: ReadonlyMap<object, RegisteredWindowMenuItem>,
): WindowMenuItem[] {
  return Array.from(items.values())
    .sort((left, right) => right.priority - left.priority)
    .map((item) => ({
      disabled: item.disabled,
      id: item.id,
      label: item.label,
      onClick: () => {
        void item.onClick();
      },
    }));
}

function createTitleBarActions(
  items: ReadonlyMap<object, RegisteredWindowTitleBarAction>,
): WindowTitleBarAction[] {
  return Array.from(items.values())
    .sort((left, right) => right.priority - left.priority)
    .map((item) => ({
      disabled: item.disabled,
      icon: item.icon,
      id: item.id,
      label: item.label,
      onClick: () => {
        void item.onClick();
      },
    }));
}

function createRefreshMenuItem(
  item: RegisteredWindowRefreshMenuItem | null,
): WindowMenuItem | null {
  if (!item) {
    return null;
  }

  return {
    disabled: item.disabled || item.refreshing,
    id: "window-refresh",
    label: item.refreshing ? REFRESHING_LABEL : item.label,
    onClick: () => {
      void item.onRefresh();
    },
  };
}

function useWindowMenuContextValue(): WindowMenuContextValue {
  const fileMenu =
    useWindowItemRegistry<RegisteredWindowMenuItem>(sameMenuItem);
  const viewMenu =
    useWindowItemRegistry<RegisteredWindowMenuItem>(sameMenuItem);
  const titleBar =
    useWindowItemRegistry<RegisteredWindowTitleBarAction>(sameTitleBarAction);
  const refresh =
    useWindowItemRegistry<RegisteredWindowRefreshMenuItem>(sameRefreshMenuItem);

  const fileMenuItemList = useMemo(
    () => createMenuItems(fileMenu.items),
    [fileMenu.items],
  );
  const refreshMenuItem = useMemo(
    () => createRefreshMenuItem(selectRefreshMenuItem(refresh.items)),
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

  const value = useMemo(
    () => ({
      fileMenuItems: fileMenuItemList,
      viewMenuItems: viewMenuItemList,
      titleBarActions: titleBarActionList,
      registerFileMenuItem: fileMenu.registerItem,
      unregisterFileMenuItem: fileMenu.unregisterItem,
      registerViewMenuItem: viewMenu.registerItem,
      unregisterViewMenuItem: viewMenu.unregisterItem,
      registerTitleBarAction: titleBar.registerItem,
      unregisterTitleBarAction: titleBar.unregisterItem,
      registerRefreshMenuItem: refresh.registerItem,
      unregisterRefreshMenuItem: refresh.unregisterItem,
    }),
    [
      fileMenuItemList,
      viewMenuItemList,
      titleBarActionList,
      fileMenu.registerItem,
      fileMenu.unregisterItem,
      viewMenu.registerItem,
      viewMenu.unregisterItem,
      titleBar.registerItem,
      titleBar.unregisterItem,
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

export function useWindowTitleBarActions(): WindowTitleBarAction[] {
  const { titleBarActions } = useContext(WindowMenuContext);
  return titleBarActions;
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
  const registrationIdRef = useRef<object>({});
  const onClickRef = useRef<WindowTitleBarActionInput["onClick"] | null>(null);
  const enabled = item !== null;
  const disabled = item?.disabled ?? false;
  const icon = item?.icon ?? null;
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

    if (!enabled || !icon) {
      return;
    }

    registerTitleBarAction(registrationId, {
      disabled,
      icon,
      id: itemId,
      label,
      onClick: handleClick,
      priority,
    });

    return () => unregisterTitleBarAction(registrationId);
  }, [
    disabled,
    enabled,
    handleClick,
    icon,
    itemId,
    label,
    priority,
    registerTitleBarAction,
    unregisterTitleBarAction,
  ]);
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
