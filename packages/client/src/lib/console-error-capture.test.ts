import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logStore } from '@/stores/logStore';
import { installConsoleErrorCapture } from './console-error-capture';

describe('installConsoleErrorCapture', () => {
  beforeEach(() => {
    logStore.clearLogs();
  });

  it('logs console errors to the log store', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const uninstall = installConsoleErrorCapture();

    console.error('Failed to connect', { status: 500 });

    const [entry] = logStore.getRecentLogs(1);
    expect(entry?.message).toBe('Failed to connect');
    expect(entry?.details).toContain('{"status":500}');

    uninstall();
    consoleSpy.mockRestore();
  });

  it('uses error stacks when available', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const uninstall = installConsoleErrorCapture();
    const error = new Error('Exploded');

    console.error(error);

    const [entry] = logStore.getRecentLogs(1);
    expect(entry?.message).toBe('Exploded');
    expect(entry?.details).toContain('Error: Exploded');

    uninstall();
    consoleSpy.mockRestore();
  });

  it('handles calls with no arguments', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const uninstall = installConsoleErrorCapture();

    console.error();

    const [entry] = logStore.getRecentLogs(1);
    expect(entry?.message).toBe('Console error');
    expect(entry?.details).toBeUndefined();

    uninstall();
    consoleSpy.mockRestore();
  });

  it('falls back when arguments cannot be stringified', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const uninstall = installConsoleErrorCapture();
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    console.error('Failed to log', circular);

    const [entry] = logStore.getRecentLogs(1);
    expect(entry?.message).toBe('Failed to log');
    expect(entry?.details).toContain('[object Object]');

    uninstall();
    consoleSpy.mockRestore();
  });

  it('returns a no-op when installed twice', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const uninstall = installConsoleErrorCapture();
    const noOp = installConsoleErrorCapture();

    console.error('Double install');

    const [entry] = logStore.getRecentLogs(1);
    expect(entry?.message).toBe('Double install');

    noOp();
    uninstall();
    consoleSpy.mockRestore();
  });
});
