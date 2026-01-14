import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installConsoleErrorCapture } from './console-error-capture';
import { logStore } from '@/stores/logStore';

describe('installConsoleErrorCapture', () => {
  beforeEach(() => {
    logStore.clearLogs();
  });

  it('logs console errors to the log store', () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const uninstall = installConsoleErrorCapture();

    console.error('Failed to connect', { status: 500 });

    const [entry] = logStore.getRecentLogs(1);
    expect(entry?.message).toBe('Failed to connect');
    expect(entry?.details).toContain('{"status":500}');

    uninstall();
    consoleSpy.mockRestore();
  });

  it('uses error stacks when available', () => {
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const uninstall = installConsoleErrorCapture();
    const error = new Error('Exploded');

    console.error(error);

    const [entry] = logStore.getRecentLogs(1);
    expect(entry?.message).toContain('Exploded');
    expect(entry?.details).toContain('Exploded');

    uninstall();
    consoleSpy.mockRestore();
  });
});
