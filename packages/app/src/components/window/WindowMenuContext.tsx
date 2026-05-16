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

interface RegisteredWindowRefreshMenuItem {
  disabled: boolean;
  label: string;
  onRefresh: () => unknown;
  priority: number;
  refreshing: boolean;
}

interface WindowMenuContextValue {
  refreshMenuItem: WindowMenuItem | null;
  registerRefreshMenuItem: (
    id: object,
    item: RegisteredWindowRefreshMenuItem,
  ) => void;
  unregisterRefreshMenuItem: (id: object) => void;
}

const WindowMenuContext = createContext<WindowMenuContextValue>({
  refreshMenuItem: null,
  registerRefreshMenuItem: () => {},
  unregisterRefreshMenuItem: () => {},
});

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
  const [refreshMenuItems, setRefreshMenuItems] = useState<
    ReadonlyMap<object, RegisteredWindowRefreshMenuItem>
  >(() => new Map());

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

  const refreshMenuItem = useMemo(
    () => createRefreshMenuItem(selectRefreshMenuItem(refreshMenuItems)),
    [refreshMenuItems],
  );
  const value = useMemo(
    () => ({
      refreshMenuItem,
      registerRefreshMenuItem,
      unregisterRefreshMenuItem,
    }),
    [refreshMenuItem, registerRefreshMenuItem, unregisterRefreshMenuItem],
  );

  return (
    <WindowMenuContext.Provider value={value}>
      {children}
    </WindowMenuContext.Provider>
  );
}

export function useWindowViewMenuItems(): WindowMenuItem[] {
  const { refreshMenuItem } = useContext(WindowMenuContext);
  return useMemo(
    () => (refreshMenuItem ? [refreshMenuItem] : []),
    [refreshMenuItem],
  );
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
