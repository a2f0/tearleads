import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { WindowMenuItem } from "./WindowMenuBar";

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

interface RegisteredWindowFileMenuItem {
  disabled: boolean;
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
  registerFileMenuItem: (
    id: object,
    item: RegisteredWindowFileMenuItem,
  ) => void;
  refreshMenuItem: WindowMenuItem | null;
  unregisterFileMenuItem: (id: object) => void;
  registerRefreshMenuItem: (
    id: object,
    item: RegisteredWindowRefreshMenuItem,
  ) => void;
  unregisterRefreshMenuItem: (id: object) => void;
}

const WindowMenuContext = createContext<WindowMenuContextValue>({
  fileMenuItems: [],
  registerFileMenuItem: () => {},
  refreshMenuItem: null,
  unregisterFileMenuItem: () => {},
  registerRefreshMenuItem: () => {},
  unregisterRefreshMenuItem: () => {},
});

function sameFileMenuItem(
  left: RegisteredWindowFileMenuItem | undefined,
  right: RegisteredWindowFileMenuItem,
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

function createFileMenuItems(
  items: ReadonlyMap<object, RegisteredWindowFileMenuItem>,
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

export function WindowMenuProvider({ children }: PropsWithChildren) {
  const [fileMenuItems, setFileMenuItems] = useState<
    ReadonlyMap<object, RegisteredWindowFileMenuItem>
  >(() => new Map());
  const [refreshMenuItems, setRefreshMenuItems] = useState<
    ReadonlyMap<object, RegisteredWindowRefreshMenuItem>
  >(() => new Map());

  const registerFileMenuItem = useCallback(
    (id: object, item: RegisteredWindowFileMenuItem) => {
      setFileMenuItems((currentItems) => {
        if (sameFileMenuItem(currentItems.get(id), item)) {
          return currentItems;
        }

        const nextItems = new Map(currentItems);
        nextItems.set(id, item);
        return nextItems;
      });
    },
    [],
  );

  const unregisterFileMenuItem = useCallback((id: object) => {
    setFileMenuItems((currentItems) => {
      if (!currentItems.has(id)) {
        return currentItems;
      }

      const nextItems = new Map(currentItems);
      nextItems.delete(id);
      return nextItems;
    });
  }, []);

  const registerRefreshMenuItem = useCallback(
    (id: object, item: RegisteredWindowRefreshMenuItem) => {
      setRefreshMenuItems((currentItems) => {
        if (sameRefreshMenuItem(currentItems.get(id), item)) {
          return currentItems;
        }

        const nextItems = new Map(currentItems);
        nextItems.set(id, item);
        return nextItems;
      });
    },
    [],
  );

  const unregisterRefreshMenuItem = useCallback((id: object) => {
    setRefreshMenuItems((currentItems) => {
      if (!currentItems.has(id)) {
        return currentItems;
      }

      const nextItems = new Map(currentItems);
      nextItems.delete(id);
      return nextItems;
    });
  }, []);

  const fileMenuItemList = useMemo(
    () => createFileMenuItems(fileMenuItems),
    [fileMenuItems],
  );
  const refreshMenuItem = useMemo(
    () => createRefreshMenuItem(selectRefreshMenuItem(refreshMenuItems)),
    [refreshMenuItems],
  );
  const value = useMemo(
    () => ({
      fileMenuItems: fileMenuItemList,
      registerFileMenuItem,
      refreshMenuItem,
      unregisterFileMenuItem,
      registerRefreshMenuItem,
      unregisterRefreshMenuItem,
    }),
    [
      fileMenuItemList,
      refreshMenuItem,
      registerFileMenuItem,
      registerRefreshMenuItem,
      unregisterFileMenuItem,
      unregisterRefreshMenuItem,
    ],
  );

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
  const { refreshMenuItem } = useContext(WindowMenuContext);
  return useMemo(
    () => (refreshMenuItem ? [refreshMenuItem] : []),
    [refreshMenuItem],
  );
}

export function useWindowFileMenuItem(
  item: WindowFileMenuItemInput | null,
): void {
  const { registerFileMenuItem, unregisterFileMenuItem } =
    useContext(WindowMenuContext);
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
      unregisterFileMenuItem(registrationId);
      return;
    }

    registerFileMenuItem(registrationId, {
      disabled,
      id: itemId,
      label,
      onClick: handleClick,
      priority,
    });

    return () => unregisterFileMenuItem(registrationId);
  }, [
    disabled,
    enabled,
    handleClick,
    itemId,
    label,
    priority,
    registerFileMenuItem,
    unregisterFileMenuItem,
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
