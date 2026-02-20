/**
 * Hook for home icon drag and selection handling.
 */

import { useCallback, useRef, useState } from 'react';
import type { Position, Positions } from '../homeIconUtils';
import {
  boxIntersectsIcon,
  constrainPosition,
  LABEL_HEIGHT
} from '../homeIconUtils';

const MIN_SELECTION_DRAG_DISTANCE = 5;
const STORAGE_KEY = 'desktop-icon-positions';

interface SelectionBox {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

function isElement(target: EventTarget | null): target is Element {
  return target !== null && target instanceof Element;
}

interface UseHomeIconDragResult {
  dragging: string | null;
  hasDragged: boolean;
  selectionBox: SelectionBox | null;
  selectedIcons: Set<string>;
  setSelectedIcons: React.Dispatch<React.SetStateAction<Set<string>>>;
  handlePointerDown: (e: React.PointerEvent, path: string) => void;
  handleCanvasPointerDown: (e: React.PointerEvent) => void;
  handlePointerMove: (e: React.PointerEvent) => void;
  handlePointerUp: () => void;
}

export function useHomeIconDrag(
  positions: Positions,
  setPositions: React.Dispatch<React.SetStateAction<Positions>>,
  containerRef: React.RefObject<HTMLDivElement | null>,
  appItems: Array<{ path: string }>,
  iconSize: number,
  itemHeight: number,
  isMobile: boolean
): UseHomeIconDragResult {
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<Position>({ x: 0, y: 0 });
  const [hasDragged, setHasDragged] = useState(false);
  const [selectedIcons, setSelectedIcons] = useState<Set<string>>(new Set());
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const isSelectingRef = useRef(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, path: string) => {
      if (isMobile) return;
      if (e.button !== 0) return;
      e.preventDefault();
      const pos = positions[path];
      if (!pos || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setDragging(path);
      setHasDragged(false);
      setSelectedIcons(new Set());
      setDragOffset({
        x: e.clientX - rect.left - pos.x,
        y: e.clientY - rect.top - pos.y
      });
      if (isElement(e.target)) {
        e.target.setPointerCapture(e.pointerId);
      }
    },
    [positions, isMobile, containerRef]
  );

  const handleCanvasPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (isMobile) return;
      if (e.button !== 0) return;
      if (isElement(e.target) && e.target.closest('button')) return;
      if (!containerRef.current) return;

      e.preventDefault();
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      isSelectingRef.current = true;
      setSelectionBox({ startX: x, startY: y, endX: x, endY: y });
      setSelectedIcons(new Set());
    },
    [isMobile, containerRef]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();

      // Handle selection box drawing
      if (isSelectingRef.current && selectionBox) {
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        setSelectionBox((prev) =>
          prev ? { ...prev, endX: x, endY: y } : null
        );
        return;
      }

      // Handle icon dragging
      if (!dragging) return;
      setHasDragged(true);
      const newX = e.clientX - rect.left - dragOffset.x;
      const newY = e.clientY - rect.top - dragOffset.y;
      const constrained = constrainPosition(
        { x: newX, y: newY },
        rect.width,
        rect.height,
        iconSize,
        LABEL_HEIGHT
      );
      setPositions((prev) => ({
        ...prev,
        [dragging]: constrained
      }));
    },
    [dragging, dragOffset, iconSize, selectionBox, containerRef, setPositions]
  );

  const handlePointerUp = useCallback(() => {
    // Handle selection box finalization
    if (isSelectingRef.current && selectionBox) {
      const boxWidth = Math.abs(selectionBox.endX - selectionBox.startX);
      const boxHeight = Math.abs(selectionBox.endY - selectionBox.startY);

      if (
        boxWidth > MIN_SELECTION_DRAG_DISTANCE ||
        boxHeight > MIN_SELECTION_DRAG_DISTANCE
      ) {
        const selected = new Set<string>();
        appItems.forEach((item) => {
          const pos = positions[item.path];
          if (
            pos &&
            boxIntersectsIcon(selectionBox, pos, iconSize, itemHeight)
          ) {
            selected.add(item.path);
          }
        });
        setSelectedIcons(selected);
      }

      isSelectingRef.current = false;
      setSelectionBox(null);
      return;
    }

    // Handle icon drag finalization
    if (dragging && hasDragged) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
    }
    setDragging(null);
  }, [
    dragging,
    hasDragged,
    positions,
    selectionBox,
    appItems,
    iconSize,
    itemHeight
  ]);

  return {
    dragging,
    hasDragged,
    selectionBox,
    selectedIcons,
    setSelectedIcons,
    handlePointerDown,
    handleCanvasPointerDown,
    handlePointerMove,
    handlePointerUp
  };
}
