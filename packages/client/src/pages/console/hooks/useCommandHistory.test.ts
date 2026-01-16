import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useCommandHistory } from './useCommandHistory';

describe('useCommandHistory', () => {
  it('starts with empty history', () => {
    const { result } = renderHook(() => useCommandHistory());
    expect(result.current.getHistory()).toEqual([]);
  });

  it('pushes commands to history', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.push('status');
    });

    expect(result.current.getHistory()).toEqual(['status']);
  });

  it('trims whitespace from commands', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.push('  status  ');
    });

    expect(result.current.getHistory()).toEqual(['status']);
  });

  it('ignores empty commands', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.push('');
      result.current.push('   ');
    });

    expect(result.current.getHistory()).toEqual([]);
  });

  it('does not add duplicate consecutive commands', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.push('status');
      result.current.push('status');
      result.current.push('status');
    });

    expect(result.current.getHistory()).toEqual(['status']);
  });

  it('allows duplicate non-consecutive commands', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.push('status');
      result.current.push('help');
      result.current.push('status');
    });

    expect(result.current.getHistory()).toEqual(['status', 'help', 'status']);
  });

  it('navigates up through history', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.push('first');
      result.current.push('second');
      result.current.push('third');
    });

    let command: string | null = null;

    act(() => {
      command = result.current.navigateUp('current');
    });
    expect(command).toBe('third');

    act(() => {
      command = result.current.navigateUp('current');
    });
    expect(command).toBe('second');

    act(() => {
      command = result.current.navigateUp('current');
    });
    expect(command).toBe('first');
  });

  it('returns null when navigating up at the oldest entry', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.push('only');
    });

    let command: string | null = null;

    act(() => {
      command = result.current.navigateUp('current');
    });
    expect(command).toBe('only');

    act(() => {
      command = result.current.navigateUp('current');
    });
    expect(command).toBeNull();
  });

  it('returns null when navigating up with empty history', () => {
    const { result } = renderHook(() => useCommandHistory());

    let command: string | null = null;

    act(() => {
      command = result.current.navigateUp('current');
    });
    expect(command).toBeNull();
  });

  it('navigates down through history', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.push('first');
      result.current.push('second');
      result.current.push('third');
    });

    let command: string | null = null;

    // Navigate up to 'third'
    act(() => {
      command = result.current.navigateUp('current');
    });
    expect(command).toBe('third');

    // Navigate up to 'second'
    act(() => {
      command = result.current.navigateUp('current');
    });
    expect(command).toBe('second');

    // Navigate up to 'first'
    act(() => {
      command = result.current.navigateUp('current');
    });
    expect(command).toBe('first');

    // Navigate back down to 'second'
    act(() => {
      command = result.current.navigateDown();
    });
    expect(command).toBe('second');

    // Navigate down to 'third'
    act(() => {
      command = result.current.navigateDown();
    });
    expect(command).toBe('third');
  });

  it('returns saved input when navigating past end of history', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.push('old');
    });

    let command: string | null = null;

    act(() => {
      command = result.current.navigateUp('typed');
    });
    expect(command).toBe('old');

    act(() => {
      command = result.current.navigateDown();
    });
    expect(command).toBe('typed');
  });

  it('returns null when navigating down without navigating up first', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.push('old');
    });

    let command: string | null = null;

    act(() => {
      command = result.current.navigateDown();
    });
    expect(command).toBeNull();
  });

  it('resets position when pushing a command', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.push('first');
      result.current.push('second');
    });

    let command: string | null = null;

    // Navigate up to 'second'
    act(() => {
      command = result.current.navigateUp('current');
    });
    expect(command).toBe('second');

    // Navigate up to 'first'
    act(() => {
      command = result.current.navigateUp('current');
    });
    expect(command).toBe('first');

    act(() => {
      result.current.push('third');
    });

    // After push, navigating up should go to the newest entry
    act(() => {
      command = result.current.navigateUp('current');
    });
    expect(command).toBe('third');
  });

  it('resetPosition clears navigation state', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.push('first');
      result.current.push('second');
    });

    let command: string | null = null;

    act(() => {
      result.current.navigateUp('current');
    });

    act(() => {
      result.current.resetPosition();
    });

    // navigateDown should return null after reset
    act(() => {
      command = result.current.navigateDown();
    });
    expect(command).toBeNull();

    // navigateUp should start from the end
    act(() => {
      command = result.current.navigateUp('new');
    });
    expect(command).toBe('second');
  });
});
