import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  isSlotInSelection,
  selectionToTimeRange,
  type TimeRangeSelection,
  type TimeSlot,
  useTimeRangeSelection
} from './useTimeRangeSelection';

describe('useTimeRangeSelection', () => {
  const createMouseEvent = (
    shiftKey = false
  ): React.MouseEvent => ({ shiftKey, preventDefault: vi.fn() }) as never;

  describe('click-drag selection', () => {
    it('starts selection on mousedown', () => {
      const { result } = renderHook(() => useTimeRangeSelection());

      const slot: TimeSlot = { hour: 9, quarter: 0 };

      act(() => {
        result.current.handleSlotMouseDown(slot, createMouseEvent());
      });

      expect(result.current.selection).toEqual({ start: slot, end: slot });
      expect(result.current.isSelecting).toBe(true);
    });

    it('extends selection on mouseenter during drag', () => {
      const { result } = renderHook(() => useTimeRangeSelection());

      const startSlot: TimeSlot = { hour: 9, quarter: 0 };
      const endSlot: TimeSlot = { hour: 11, quarter: 2 };

      act(() => {
        result.current.handleSlotMouseDown(startSlot, createMouseEvent());
      });

      act(() => {
        result.current.handleSlotMouseEnter(endSlot);
      });

      expect(result.current.selection).toEqual({
        start: startSlot,
        end: endSlot
      });
    });

    it('normalizes selection when dragging backwards', () => {
      const { result } = renderHook(() => useTimeRangeSelection());

      const startSlot: TimeSlot = { hour: 14, quarter: 0 };
      const endSlot: TimeSlot = { hour: 10, quarter: 0 };

      act(() => {
        result.current.handleSlotMouseDown(startSlot, createMouseEvent());
      });

      act(() => {
        result.current.handleSlotMouseEnter(endSlot);
      });

      expect(result.current.selection).toEqual({
        start: endSlot,
        end: startSlot
      });
    });

    it('completes selection on mouseup', () => {
      const onSelectionComplete = vi.fn();
      const { result } = renderHook(() =>
        useTimeRangeSelection({ onSelectionComplete })
      );

      const startSlot: TimeSlot = { hour: 9, quarter: 0 };
      const endSlot: TimeSlot = { hour: 10, quarter: 0 };

      act(() => {
        result.current.handleSlotMouseDown(startSlot, createMouseEvent());
      });

      act(() => {
        result.current.handleSlotMouseEnter(endSlot);
      });

      act(() => {
        window.dispatchEvent(new MouseEvent('mouseup'));
      });

      expect(result.current.isSelecting).toBe(false);
      expect(onSelectionComplete).toHaveBeenCalledWith({
        start: startSlot,
        end: endSlot
      });
    });
  });

  describe('shift-click selection', () => {
    it('sets anchor on first click', () => {
      const { result } = renderHook(() => useTimeRangeSelection());

      const slot: TimeSlot = { hour: 9, quarter: 0 };

      act(() => {
        result.current.handleSlotClick(slot, createMouseEvent(false));
      });

      expect(result.current.selectionAnchor).toEqual(slot);
      expect(result.current.selection).toEqual({ start: slot, end: slot });
    });

    it('selects range from anchor on shift-click', () => {
      const onSelectionComplete = vi.fn();
      const { result } = renderHook(() =>
        useTimeRangeSelection({ onSelectionComplete })
      );

      const anchorSlot: TimeSlot = { hour: 9, quarter: 0 };
      const targetSlot: TimeSlot = { hour: 12, quarter: 3 };

      act(() => {
        result.current.handleSlotClick(anchorSlot, createMouseEvent(false));
      });

      act(() => {
        result.current.handleSlotClick(targetSlot, createMouseEvent(true));
      });

      expect(result.current.selection).toEqual({
        start: anchorSlot,
        end: targetSlot
      });
      expect(onSelectionComplete).toHaveBeenCalledWith({
        start: anchorSlot,
        end: targetSlot
      });
    });

    it('normalizes shift-click selection when clicking before anchor', () => {
      const { result } = renderHook(() => useTimeRangeSelection());

      const anchorSlot: TimeSlot = { hour: 14, quarter: 0 };
      const targetSlot: TimeSlot = { hour: 10, quarter: 0 };

      act(() => {
        result.current.handleSlotClick(anchorSlot, createMouseEvent(false));
      });

      act(() => {
        result.current.handleSlotClick(targetSlot, createMouseEvent(true));
      });

      expect(result.current.selection).toEqual({
        start: targetSlot,
        end: anchorSlot
      });
    });
  });

  describe('clearSelection', () => {
    it('clears all selection state', () => {
      const { result } = renderHook(() => useTimeRangeSelection());

      const slot: TimeSlot = { hour: 9, quarter: 0 };

      act(() => {
        result.current.handleSlotClick(slot, createMouseEvent(false));
      });

      expect(result.current.selection).not.toBeNull();
      expect(result.current.selectionAnchor).not.toBeNull();

      act(() => {
        result.current.clearSelection();
      });

      expect(result.current.selection).toBeNull();
      expect(result.current.selectionAnchor).toBeNull();
      expect(result.current.isSelecting).toBe(false);
    });

    it('clears selection on Escape key', () => {
      const { result } = renderHook(() => useTimeRangeSelection());

      const slot: TimeSlot = { hour: 9, quarter: 0 };

      act(() => {
        result.current.handleSlotClick(slot, createMouseEvent(false));
      });

      expect(result.current.selection).not.toBeNull();

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });

      expect(result.current.selection).toBeNull();
    });
  });

  describe('enabled option', () => {
    it('does not respond to interactions when disabled', () => {
      const { result } = renderHook(() =>
        useTimeRangeSelection({ enabled: false })
      );

      const slot: TimeSlot = { hour: 9, quarter: 0 };

      act(() => {
        result.current.handleSlotMouseDown(slot, createMouseEvent());
      });

      expect(result.current.selection).toBeNull();
      expect(result.current.isSelecting).toBe(false);
    });
  });
});

describe('isSlotInSelection', () => {
  it('returns false when selection is null', () => {
    const slot: TimeSlot = { hour: 10, quarter: 0 };
    expect(isSlotInSelection(slot, null)).toBe(false);
  });

  it('returns true for slot at selection start', () => {
    const selection: TimeRangeSelection = {
      start: { hour: 9, quarter: 0 },
      end: { hour: 11, quarter: 0 }
    };
    expect(isSlotInSelection({ hour: 9, quarter: 0 }, selection)).toBe(true);
  });

  it('returns true for slot at selection end', () => {
    const selection: TimeRangeSelection = {
      start: { hour: 9, quarter: 0 },
      end: { hour: 11, quarter: 0 }
    };
    expect(isSlotInSelection({ hour: 11, quarter: 0 }, selection)).toBe(true);
  });

  it('returns true for slot in middle of selection', () => {
    const selection: TimeRangeSelection = {
      start: { hour: 9, quarter: 0 },
      end: { hour: 11, quarter: 0 }
    };
    expect(isSlotInSelection({ hour: 10, quarter: 2 }, selection)).toBe(true);
  });

  it('returns false for slot before selection', () => {
    const selection: TimeRangeSelection = {
      start: { hour: 9, quarter: 0 },
      end: { hour: 11, quarter: 0 }
    };
    expect(isSlotInSelection({ hour: 8, quarter: 3 }, selection)).toBe(false);
  });

  it('returns false for slot after selection', () => {
    const selection: TimeRangeSelection = {
      start: { hour: 9, quarter: 0 },
      end: { hour: 11, quarter: 0 }
    };
    expect(isSlotInSelection({ hour: 11, quarter: 1 }, selection)).toBe(false);
  });
});

describe('selectionToTimeRange', () => {
  it('converts selection to start and end Date objects', () => {
    const selection: TimeRangeSelection = {
      start: { hour: 9, quarter: 2 },
      end: { hour: 11, quarter: 1 }
    };
    const baseDate = new Date(2024, 5, 15);

    const { startTime, endTime } = selectionToTimeRange(selection, baseDate);

    expect(startTime.getHours()).toBe(9);
    expect(startTime.getMinutes()).toBe(30);
    expect(endTime.getHours()).toBe(11);
    expect(endTime.getMinutes()).toBe(30);
  });

  it('adds 15 minutes to end time to include the selected quarter', () => {
    const selection: TimeRangeSelection = {
      start: { hour: 10, quarter: 0 },
      end: { hour: 10, quarter: 0 }
    };
    const baseDate = new Date(2024, 5, 15);

    const { startTime, endTime } = selectionToTimeRange(selection, baseDate);

    expect(startTime.getHours()).toBe(10);
    expect(startTime.getMinutes()).toBe(0);
    expect(endTime.getHours()).toBe(10);
    expect(endTime.getMinutes()).toBe(15);
  });
});
