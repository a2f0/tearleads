/**
 * Hook for home icon arrangement (grid, scatter, cluster).
 */

import { useCallback } from 'react';
import type { navItems } from '@/components/Sidebar';
import type { Positions } from '../homeIconUtils';
import {
  calculateClusterPositions,
  calculateGridPositions,
  calculateScatterPositions,
  getIconButtonMeasurements,
  getItemsToArrange,
  sortItemsByLabel
} from '../homeIconUtils';

const STORAGE_KEY = 'desktop-icon-positions';

interface UseHomeArrangementResult {
  handleAutoArrange: () => void;
  handleScatter: () => void;
  handleCluster: () => void;
}

export function useHomeArrangement(
  appItems: typeof navItems,
  positions: Positions,
  setPositions: React.Dispatch<React.SetStateAction<Positions>>,
  containerRef: React.RefObject<HTMLDivElement | null>,
  selectedIcons: Set<string>,
  setSelectedIcons: React.Dispatch<React.SetStateAction<Set<string>>>,
  setCanvasContextMenu: React.Dispatch<
    React.SetStateAction<{ x: number; y: number } | null>
  >,
  isMobile: boolean,
  translateLabel: (labelKey: string) => string
): UseHomeArrangementResult {
  const applyArrangement = useCallback(
    (
      arrangementFn: (
        items: typeof navItems,
        width: number,
        height: number,
        isMobile: boolean,
        selectedPaths?: Set<string>,
        currentPositions?: Positions
      ) => Positions
    ) => {
      if (!containerRef.current) return;
      const { offsetWidth: width, offsetHeight: height } = containerRef.current;
      const hasSelection = selectedIcons.size > 0;

      const newPositions = arrangementFn(
        appItems,
        width,
        height,
        isMobile,
        hasSelection ? selectedIcons : undefined,
        hasSelection ? positions : undefined
      );

      setPositions(newPositions);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newPositions));
      if (hasSelection) {
        setSelectedIcons(new Set());
      }
      setCanvasContextMenu(null);
    },
    [
      appItems,
      isMobile,
      selectedIcons,
      positions,
      containerRef,
      setPositions,
      setSelectedIcons,
      setCanvasContextMenu
    ]
  );

  const handleAutoArrange = useCallback(() => {
    applyArrangement((items, width, _height, mobile, selected, current) => {
      const sortedItems = sortItemsByLabel(items, (item) =>
        translateLabel(item.labelKey)
      );
      return calculateGridPositions(
        sortedItems,
        width,
        mobile,
        selected,
        current
      );
    });
  }, [applyArrangement, translateLabel]);

  const handleScatter = useCallback(() => {
    applyArrangement(calculateScatterPositions);
  }, [applyArrangement]);

  const handleCluster = useCallback(() => {
    const hasSelection = selectedIcons.size > 0;
    const itemsToArrange = getItemsToArrange(
      appItems,
      hasSelection ? selectedIcons : undefined
    );
    const measurements = isMobile
      ? null
      : getIconButtonMeasurements(
          containerRef.current,
          itemsToArrange.map((item) => item.path)
        );

    applyArrangement((items, width, height, mobile, selected, current) =>
      calculateClusterPositions(
        items,
        width,
        height,
        mobile,
        selected,
        current,
        measurements?.maxWidth || undefined,
        measurements?.maxHeight || undefined,
        measurements?.itemHeights,
        measurements?.itemWidths
      )
    );
  }, [applyArrangement, appItems, isMobile, selectedIcons, containerRef]);

  return {
    handleAutoArrange,
    handleScatter,
    handleCluster
  };
}
