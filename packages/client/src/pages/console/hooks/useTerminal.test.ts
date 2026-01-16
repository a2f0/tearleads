import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROMPT } from '../lib/types';
import { useTerminal } from './useTerminal';

describe('useTerminal', () => {
  it('initializes with default state', () => {
    const { result } = renderHook(() => useTerminal());

    expect(result.current.lines).toEqual([]);
    expect(result.current.mode).toBe('command');
    expect(result.current.prompt).toBe(DEFAULT_PROMPT);
    expect(result.current.input).toBe('');
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.pendingCommand).toBeNull();
  });

  it('sets input value', () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.setInput('status');
    });

    expect(result.current.input).toBe('status');
  });

  it('appends output lines', () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.appendLine('Hello', 'output');
    });

    expect(result.current.lines).toHaveLength(1);
    expect(result.current.lines[0]?.content).toBe('Hello');
    expect(result.current.lines[0]?.type).toBe('output');
    expect(result.current.lines[0]?.id).toBeDefined();
  });

  it('appends multiple lines with unique IDs', () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.appendLine('Line 1', 'output');
      result.current.appendLine('Line 2', 'error');
    });

    expect(result.current.lines).toHaveLength(2);
    expect(result.current.lines[0]?.id).not.toBe(result.current.lines[1]?.id);
  });

  it('clears all lines', () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.appendLine('Line 1', 'output');
      result.current.appendLine('Line 2', 'output');
    });

    expect(result.current.lines).toHaveLength(2);

    act(() => {
      result.current.clearLines();
    });

    expect(result.current.lines).toEqual([]);
  });

  it('switches to password mode', () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.setInput('some text');
    });

    act(() => {
      result.current.setPasswordMode('Password: ');
    });

    expect(result.current.mode).toBe('password');
    expect(result.current.prompt).toBe('Password: ');
    expect(result.current.input).toBe('');
  });

  it('switches to confirm mode', () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.setConfirmMode('Continue? (y/n): ');
    });

    expect(result.current.mode).toBe('confirm');
    expect(result.current.prompt).toBe('Continue? (y/n): ');
    expect(result.current.input).toBe('');
  });

  it('resets to command mode', () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.setPasswordMode('Password: ');
      result.current.setInput('secret');
    });

    act(() => {
      result.current.setCommandMode();
    });

    expect(result.current.mode).toBe('command');
    expect(result.current.prompt).toBe(DEFAULT_PROMPT);
    expect(result.current.input).toBe('');
  });

  it('sets processing state', () => {
    const { result } = renderHook(() => useTerminal());

    expect(result.current.isProcessing).toBe(false);

    act(() => {
      result.current.setProcessing(true);
    });

    expect(result.current.isProcessing).toBe(true);

    act(() => {
      result.current.setProcessing(false);
    });

    expect(result.current.isProcessing).toBe(false);
  });

  it('sets pending command', () => {
    const { result } = renderHook(() => useTerminal());

    const pendingCommand = {
      name: 'setup' as const,
      step: 'password',
      data: {}
    };

    act(() => {
      result.current.setPendingCommand(pendingCommand);
    });

    expect(result.current.pendingCommand).toEqual(pendingCommand);

    act(() => {
      result.current.setPendingCommand(null);
    });

    expect(result.current.pendingCommand).toBeNull();
  });

  it('generates unique line IDs', () => {
    const { result } = renderHook(() => useTerminal());

    const ids = new Set<string>();

    act(() => {
      for (let i = 0; i < 100; i++) {
        ids.add(result.current.generateLineId());
      }
    });

    expect(ids.size).toBe(100);
  });

  it('appends lines with different types', () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.appendLine('> status', 'command');
      result.current.appendLine('Database: locked', 'output');
      result.current.appendLine('Success!', 'success');
      result.current.appendLine('Error occurred', 'error');
    });

    expect(result.current.lines[0]?.type).toBe('command');
    expect(result.current.lines[1]?.type).toBe('output');
    expect(result.current.lines[2]?.type).toBe('success');
    expect(result.current.lines[3]?.type).toBe('error');
  });
});
