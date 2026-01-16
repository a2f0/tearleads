/**
 * Hook for managing command history with up/down arrow navigation.
 */

import { useCallback, useState } from 'react';

const MAX_HISTORY = 100;

interface UseCommandHistoryReturn {
  /** Add a command to history */
  push: (command: string) => void;
  /** Navigate up (older) in history, returns command or null if at start */
  navigateUp: (currentInput: string) => string | null;
  /** Navigate down (newer) in history, returns command or null if at end */
  navigateDown: () => string | null;
  /** Reset navigation position to end */
  resetPosition: () => void;
  /** Get all history items */
  getHistory: () => string[];
}

/**
 * Hook for managing command history with up/down arrow navigation.
 *
 * - Up arrow navigates to older commands
 * - Down arrow navigates to newer commands
 * - Pushing a command resets position to end
 * - History is capped at MAX_HISTORY entries
 *
 * @returns Object with history manipulation functions
 */
export function useCommandHistory(): UseCommandHistoryReturn {
  const [history, setHistory] = useState<string[]>([]);
  // -1 means we're at the "current" position (not navigating history)
  const [position, setPosition] = useState(-1);
  // Store the current input before starting history navigation
  const [savedInput, setSavedInput] = useState('');

  const push = useCallback((command: string) => {
    const trimmed = command.trim();
    if (!trimmed) {
      return;
    }

    setHistory((prev) => {
      // Don't add duplicates of the last command
      if (prev.length > 0 && prev[prev.length - 1] === trimmed) {
        return prev;
      }

      const newHistory = [...prev, trimmed];
      // Cap history size
      if (newHistory.length > MAX_HISTORY) {
        return newHistory.slice(-MAX_HISTORY);
      }
      return newHistory;
    });

    // Reset position after pushing
    setPosition(-1);
    setSavedInput('');
  }, []);

  const navigateUp = useCallback(
    (currentInput: string): string | null => {
      if (history.length === 0) {
        return null;
      }

      // If we're starting navigation, save the current input
      if (position === -1) {
        setSavedInput(currentInput);
        const newPosition = history.length - 1;
        setPosition(newPosition);
        return history[newPosition] ?? null;
      }

      // Already at the oldest entry
      if (position === 0) {
        return null;
      }

      const newPosition = position - 1;
      setPosition(newPosition);
      return history[newPosition] ?? null;
    },
    [history, position]
  );

  const navigateDown = useCallback((): string | null => {
    // Not navigating history
    if (position === -1) {
      return null;
    }

    // At the end of history, return to saved input
    if (position >= history.length - 1) {
      setPosition(-1);
      return savedInput;
    }

    const newPosition = position + 1;
    setPosition(newPosition);
    return history[newPosition] ?? null;
  }, [history, position, savedInput]);

  const resetPosition = useCallback(() => {
    setPosition(-1);
    setSavedInput('');
  }, []);

  const getHistory = useCallback(() => {
    return [...history];
  }, [history]);

  return {
    push,
    navigateUp,
    navigateDown,
    resetPosition,
    getHistory
  };
}
