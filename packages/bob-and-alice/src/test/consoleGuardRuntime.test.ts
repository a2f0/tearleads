import { describe, expect, it } from 'vitest';
import { createConsoleGuardRuntime } from './consoleGuardRuntime';

interface FakeConsole {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

function createFakeConsole(): {
  fakeConsole: FakeConsole;
  calls: Array<{ level: 'warn' | 'error'; args: unknown[] }>;
} {
  const calls: Array<{ level: 'warn' | 'error'; args: unknown[] }> = [];
  const fakeConsole: FakeConsole = {
    error: (...args: unknown[]) => {
      calls.push({ level: 'error', args });
    },
    warn: (...args: unknown[]) => {
      calls.push({ level: 'warn', args });
    }
  };

  return { fakeConsole, calls };
}

describe('consoleGuardRuntime', () => {
  it('fails when current test window logs a matching warning', async () => {
    const { fakeConsole, calls } = createFakeConsole();
    const runtime = createConsoleGuardRuntime(fakeConsole);
    runtime.startTestWindow();

    fakeConsole.warn(
      'Initial VFS orchestrator flush failed:',
      'instanceEpoch=2, currentInstanceEpoch=2'
    );

    await expect(runtime.assertCurrentWindowClean()).rejects.toThrow(
      /Console guardrail detected VFS bootstrap\/flush warnings/
    );
    expect(calls).toHaveLength(1);

    runtime.restore();
  });

  it('waits one async tick so late warnings are still detected', async () => {
    const { fakeConsole } = createFakeConsole();
    const runtime = createConsoleGuardRuntime(fakeConsole);
    runtime.startTestWindow();

    setTimeout(() => {
      fakeConsole.warn('Initial VFS orchestrator flush failed:', {
        name: 'VfsCrdtFeedReplayError',
        message: 'CRDT feed item 0 is not strictly newer than local cursor'
      });
    }, 0);

    await expect(runtime.assertCurrentWindowClean()).rejects.toThrow(
      /not strictly newer than local cursor/
    );

    runtime.restore();
  });

  it('supports a final grace period for delayed warnings', async () => {
    const { fakeConsole } = createFakeConsole();
    const runtime = createConsoleGuardRuntime(fakeConsole);
    runtime.startTestWindow();

    setTimeout(() => {
      fakeConsole.warn('Initial VFS orchestrator flush failed: delayed');
    }, 5);

    await expect(
      runtime.assertCurrentWindowClean({ gracePeriodMs: 10 })
    ).rejects.toThrow(/Console guardrail detected/);

    runtime.restore();
  });

  it('ignores unrelated warnings and advances the window', async () => {
    const { fakeConsole } = createFakeConsole();
    const runtime = createConsoleGuardRuntime(fakeConsole);
    runtime.startTestWindow();

    fakeConsole.warn('sync loop completed successfully');
    await expect(runtime.assertCurrentWindowClean()).resolves.toBeUndefined();

    runtime.startTestWindow();
    fakeConsole.warn('debug: fetched 5 items');
    await expect(runtime.assertCurrentWindowClean()).resolves.toBeUndefined();

    runtime.restore();
  });
});
