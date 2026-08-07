import { useCallback, useMemo, useState } from "react";

interface WindowItemRegistry<T> {
  items: ReadonlyMap<object, T>;
  registerItem: (id: object, item: T) => void;
  unregisterItem: (id: object) => void;
}

export function useWindowItemRegistry<T>(
  sameItem: (left: T | undefined, right: T) => boolean,
): WindowItemRegistry<T> {
  const [items, setItems] = useState<ReadonlyMap<object, T>>(() => new Map());

  const registerItem = useCallback(
    (id: object, item: T) => {
      setItems((currentItems) => {
        if (sameItem(currentItems.get(id), item)) {
          return currentItems;
        }

        const nextItems = new Map(currentItems);
        nextItems.set(id, item);
        return nextItems;
      });
    },
    [sameItem],
  );

  const unregisterItem = useCallback((id: object) => {
    setItems((currentItems) => {
      if (!currentItems.has(id)) {
        return currentItems;
      }

      const nextItems = new Map(currentItems);
      nextItems.delete(id);
      return nextItems;
    });
  }, []);

  return useMemo(
    () => ({ items, registerItem, unregisterItem }),
    [items, registerItem, unregisterItem],
  );
}

/** Highest priority wins among registered items; null when none registered. */
export function selectHighestPriorityItem<T extends { priority: number }>(
  items: ReadonlyMap<object, T>,
): T | null {
  let selected: T | null = null;

  for (const item of items.values()) {
    if (!selected || item.priority > selected.priority) {
      selected = item;
    }
  }

  return selected;
}
