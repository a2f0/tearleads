/**
 * Hook for managing terminal state.
 * Handles input modes, output lines, and command execution flow.
 */

import { useCallback, useRef, useState } from 'react';
import type {
  InputMode,
  OutputLine,
  OutputLineType,
  PendingCommand
} from '../lib/types';
import { DEFAULT_PROMPT } from '../lib/types';

interface UseTerminalReturn {
  /** Current terminal output lines */
  lines: OutputLine[];
  /** Current input mode (command, password, confirm) */
  mode: InputMode;
  /** Current prompt string */
  prompt: string;
  /** Current input value */
  input: string;
  /** Whether terminal is processing a command */
  isProcessing: boolean;
  /** Pending multi-step command */
  pendingCommand: PendingCommand | null;

  /** Set input value */
  setInput: (value: string) => void;
  /** Add a line to output */
  appendLine: (content: string, type: OutputLineType) => void;
  /** Clear all output lines */
  clearLines: () => void;
  /** Set terminal to password input mode */
  setPasswordMode: (prompt: string) => void;
  /** Set terminal to confirm input mode */
  setConfirmMode: (prompt: string) => void;
  /** Reset to command mode */
  setCommandMode: () => void;
  /** Set processing state */
  setProcessing: (value: boolean) => void;
  /** Set pending command */
  setPendingCommand: (command: PendingCommand | null) => void;
  /** Generate a unique line ID */
  generateLineId: () => string;
}

/**
 * Hook for managing terminal state and input modes.
 */
export function useTerminal(): UseTerminalReturn {
  const [lines, setLines] = useState<OutputLine[]>([]);
  const [mode, setMode] = useState<InputMode>('command');
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<PendingCommand | null>(
    null
  );

  const lineIdCounter = useRef(0);

  const generateLineId = useCallback((): string => {
    if (globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID();
    }
    lineIdCounter.current += 1;
    return String(lineIdCounter.current);
  }, []);

  const appendLine = useCallback(
    (content: string, type: OutputLineType) => {
      const id = generateLineId();
      setLines((prev) => [...prev, { id, content, type }]);
    },
    [generateLineId]
  );

  const clearLines = useCallback(() => {
    setLines([]);
  }, []);

  const setPasswordMode = useCallback((newPrompt: string) => {
    setMode('password');
    setPrompt(newPrompt);
    setInput('');
  }, []);

  const setConfirmMode = useCallback((newPrompt: string) => {
    setMode('confirm');
    setPrompt(newPrompt);
    setInput('');
  }, []);

  const setCommandMode = useCallback(() => {
    setMode('command');
    setPrompt(DEFAULT_PROMPT);
    setInput('');
  }, []);

  const setProcessing = useCallback((value: boolean) => {
    setIsProcessing(value);
  }, []);

  return {
    lines,
    mode,
    prompt,
    input,
    isProcessing,
    pendingCommand,
    setInput,
    appendLine,
    clearLines,
    setPasswordMode,
    setConfirmMode,
    setCommandMode,
    setProcessing,
    setPendingCommand,
    generateLineId
  };
}
