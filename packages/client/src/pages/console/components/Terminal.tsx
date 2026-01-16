/**
 * Main terminal container component.
 * Composes TerminalOutput and TerminalInput with command execution logic.
 */

import type { KeyboardEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useDatabaseContext } from '@/db/hooks';
import { cn } from '@/lib/utils';
import { useCommandHistory } from '../hooks/useCommandHistory';
import { useTerminal } from '../hooks/useTerminal';
import { continueCommand, executeCommand } from '../lib/command-executor';
import { parseCommand } from '../lib/command-parser';
import { TerminalInput } from './TerminalInput';
import { TerminalOutput } from './TerminalOutput';

interface TerminalProps {
  className?: string;
}

export function Terminal({ className }: TerminalProps) {
  const db = useDatabaseContext();
  const terminal = useTerminal();
  const history = useCommandHistory();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileResolverRef = useRef<((file: File | null) => void) | null>(null);

  // File picker implementation
  const pickFile = useCallback((accept: string): Promise<File | null> => {
    return new Promise((resolve) => {
      fileResolverRef.current = resolve;
      if (fileInputRef.current) {
        fileInputRef.current.accept = accept;
        fileInputRef.current.click();
      }
    });
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      fileResolverRef.current?.(file);
      fileResolverRef.current = null;
      // Reset input so the same file can be selected again
      e.target.value = '';
    },
    []
  );

  // Terminal control interface for command executor
  const terminalControl = useMemo(
    () => ({
      appendLine: terminal.appendLine,
      clearLines: terminal.clearLines,
      setPasswordMode: terminal.setPasswordMode,
      setConfirmMode: terminal.setConfirmMode,
      setCommandMode: terminal.setCommandMode,
      setProcessing: terminal.setProcessing,
      setPendingCommand: terminal.setPendingCommand
    }),
    [
      terminal.appendLine,
      terminal.clearLines,
      terminal.setPasswordMode,
      terminal.setConfirmMode,
      terminal.setCommandMode,
      terminal.setProcessing,
      terminal.setPendingCommand
    ]
  );

  const filePicker = useMemo(() => ({ pickFile }), [pickFile]);

  // Handle command submission
  const handleSubmit = useCallback(async () => {
    const input = terminal.input.trim();

    // Handle pending command continuation
    if (terminal.pendingCommand) {
      // Don't echo password inputs
      if (terminal.mode !== 'password') {
        terminal.appendLine(`${terminal.prompt}${input}`, 'command');
      } else {
        terminal.appendLine(`${terminal.prompt}••••••••`, 'command');
      }

      await continueCommand(
        terminal.pendingCommand,
        input,
        db,
        terminalControl,
        filePicker
      );
      return;
    }

    // Normal command mode
    if (!input) {
      return;
    }

    // Echo command
    terminal.appendLine(`${terminal.prompt}${input}`, 'command');
    terminal.setInput('');

    // Add to history
    history.push(input);

    // Parse and execute
    const parsed = parseCommand(input);
    await executeCommand(parsed, db, terminalControl, filePicker);
  }, [terminal, db, terminalControl, filePicker, history]);

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      // Ctrl+C - cancel current operation
      if (e.ctrlKey && e.key === 'c') {
        e.preventDefault();
        if (terminal.pendingCommand) {
          terminal.appendLine('^C', 'output');
          terminal.setPendingCommand(null);
          terminal.setCommandMode();
        } else {
          terminal.appendLine('^C', 'output');
          terminal.setInput('');
        }
        return;
      }

      // Ctrl+L - clear terminal
      if (e.ctrlKey && e.key === 'l') {
        e.preventDefault();
        terminal.clearLines();
        return;
      }

      // Up arrow - navigate history (only in command mode)
      if (e.key === 'ArrowUp' && terminal.mode === 'command') {
        e.preventDefault();
        const prev = history.navigateUp(terminal.input);
        if (prev !== null) {
          terminal.setInput(prev);
        }
        return;
      }

      // Down arrow - navigate history (only in command mode)
      if (e.key === 'ArrowDown' && terminal.mode === 'command') {
        e.preventDefault();
        const next = history.navigateDown();
        if (next !== null) {
          terminal.setInput(next);
        }
        return;
      }
    },
    [terminal, history]
  );

  // Reset history position when input changes manually
  const handleInputChange = useCallback(
    (value: string) => {
      history.resetPosition();
      terminal.setInput(value);
    },
    [terminal, history]
  );

  // Show welcome message on mount
  useEffect(() => {
    terminal.appendLine('Rapid Terminal v1.0', 'output');
    terminal.appendLine('Type "help" for available commands.', 'output');
    terminal.appendLine('', 'output');
  }, [terminal.appendLine]);

  return (
    <div
      className={cn(
        'flex h-[400px] min-h-[300px] flex-col rounded-lg border border-zinc-800 bg-zinc-950',
        className
      )}
      data-testid="terminal"
    >
      <TerminalOutput
        lines={terminal.lines}
        className="flex-1 overflow-y-auto p-4"
      />
      <div className="border-zinc-800 border-t p-4">
        <TerminalInput
          value={terminal.input}
          prompt={terminal.prompt}
          mode={terminal.mode}
          disabled={terminal.isProcessing}
          onChange={handleInputChange}
          onSubmit={handleSubmit}
          onKeyDown={handleKeyDown}
        />
      </div>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileChange}
        data-testid="terminal-file-input"
      />
    </div>
  );
}
