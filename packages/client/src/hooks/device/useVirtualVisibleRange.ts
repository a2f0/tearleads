import type { VirtualItem } from '@tanstack/react-virtual';

export function useVirtualVisibleRange(virtualItems: VirtualItem[]) {
  const firstVisible =
    virtualItems.length > 0 ? (virtualItems[0]?.index ?? null) : null;
  const lastVisible =
    virtualItems.length > 0
      ? (virtualItems[virtualItems.length - 1]?.index ?? null)
      : null;

  return { firstVisible, lastVisible };
}
