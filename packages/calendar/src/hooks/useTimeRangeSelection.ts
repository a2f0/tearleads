import { useCallback, useEffect, useRef, useState } from 'react';

export interface TimeSlot {
  hour: number;
  quarter: 0 | 1 | 2 | 3;
}

export interface TimeRangeSelection {
  start: TimeSlot;
  end: TimeSlot;
}

interface UseTimeRangeSelectionOptions {
  enabled?: boolean;
  onSelectionComplete?: (selection: TimeRangeSelection) => void;
}

interface UseTimeRangeSelectionResult {
  selection: TimeRangeSelection | null;
  isSelecting: boolean;
  selectionAnchor: TimeSlot | null;
  handleSlotMouseDown: (slot: TimeSlot, event: React.MouseEvent) => void;
  handleSlotMouseEnter: (slot: TimeSlot) => void;
  handleSlotClick: (slot: TimeSlot, event: React.MouseEvent) => void;
  clearSelection: () => void;
}

function compareTimeSlots(a: TimeSlot, b: TimeSlot): number {
  const aMinutes = a.hour * 60 + a.quarter * 15;
  const bMinutes = b.hour * 60 + b.quarter * 15;
  return aMinutes - bMinutes;
}

function normalizeSelection(
  start: TimeSlot,
  end: TimeSlot
): TimeRangeSelection {
  if (compareTimeSlots(start, end) <= 0) {
    return { start, end };
  }
  return { start: end, end: start };
}

export function useTimeRangeSelection(
  options: UseTimeRangeSelectionOptions = {}
): UseTimeRangeSelectionResult {
  const { enabled = true, onSelectionComplete } = options;

  const [selection, setSelection] = useState<TimeRangeSelection | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionAnchor, setSelectionAnchor] = useState<TimeSlot | null>(null);

  const dragStartRef = useRef<TimeSlot | null>(null);
  const isDraggingRef = useRef(false);

  const clearSelection = useCallback(() => {
    setSelection(null);
    setSelectionAnchor(null);
    setIsSelecting(false);
    dragStartRef.current = null;
    isDraggingRef.current = false;
  }, []);

  const handleSlotMouseDown = useCallback(
    (slot: TimeSlot, event: React.MouseEvent) => {
      if (!enabled) return;

      event.preventDefault();
      dragStartRef.current = slot;
      isDraggingRef.current = true;
      setIsSelecting(true);
      setSelection({ start: slot, end: slot });
    },
    [enabled]
  );

  const handleSlotMouseEnter = useCallback(
    (slot: TimeSlot) => {
      if (!enabled || !isDraggingRef.current || !dragStartRef.current) return;

      setSelection(normalizeSelection(dragStartRef.current, slot));
    },
    [enabled]
  );

  const handleSlotClick = useCallback(
    (slot: TimeSlot, event: React.MouseEvent) => {
      if (!enabled) return;

      if (event.shiftKey && selectionAnchor) {
        const normalized = normalizeSelection(selectionAnchor, slot);
        setSelection(normalized);
        setIsSelecting(false);
        onSelectionComplete?.(normalized);
      } else {
        setSelectionAnchor(slot);
        setSelection({ start: slot, end: slot });
      }
    },
    [enabled, selectionAnchor, onSelectionComplete]
  );

  useEffect(() => {
    if (!enabled) return;

    const handleMouseUp = () => {
      if (isDraggingRef.current && selection) {
        isDraggingRef.current = false;
        setIsSelecting(false);
        setSelectionAnchor(selection.start);
        onSelectionComplete?.(selection);
      }
      dragStartRef.current = null;
    };

    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [enabled, selection, onSelectionComplete]);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        clearSelection();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, clearSelection]);

  return {
    selection,
    isSelecting,
    selectionAnchor,
    handleSlotMouseDown,
    handleSlotMouseEnter,
    handleSlotClick,
    clearSelection
  };
}

export function isSlotInSelection(
  slot: TimeSlot,
  selection: TimeRangeSelection | null
): boolean {
  if (!selection) return false;

  const slotMinutes = slot.hour * 60 + slot.quarter * 15;
  const startMinutes =
    selection.start.hour * 60 + selection.start.quarter * 15;
  const endMinutes = selection.end.hour * 60 + selection.end.quarter * 15;

  return slotMinutes >= startMinutes && slotMinutes <= endMinutes;
}

export function selectionToTimeRange(
  selection: TimeRangeSelection,
  baseDate: Date
): { startTime: Date; endTime: Date } {
  const startTime = new Date(baseDate);
  startTime.setHours(
    selection.start.hour,
    selection.start.quarter * 15,
    0,
    0
  );

  const endTime = new Date(baseDate);
  endTime.setHours(
    selection.end.hour,
    selection.end.quarter * 15 + 15,
    0,
    0
  );

  return { startTime, endTime };
}
