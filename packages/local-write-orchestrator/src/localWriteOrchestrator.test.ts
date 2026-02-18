import {
  isDefaultSqliteConflict,
  LocalWriteOrchestrator
} from './localWriteOrchestrator';

function deferred<T>() {
  let resolveValue: ((value: T | PromiseLike<T>) => void) | null = null;
  let rejectValue: ((reason?: unknown) => void) | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });

  return {
    promise,
    resolve: (value: T) => {
      if (resolveValue) {
        resolveValue(value);
      }
    },
    reject: (reason?: unknown) => {
      if (rejectValue) {
        rejectValue(reason);
      }
    }
  };
}

describe('LocalWriteOrchestrator', () => {
  it('serializes writes within the same scope', async () => {
    const orchestrator = new LocalWriteOrchestrator();
    const firstGate = deferred<void>();
    const order: string[] = [];

    const first = orchestrator.enqueue(async () => {
      order.push('first-start');
      await firstGate.promise;
      order.push('first-end');
      return 'first';
    });

    const second = orchestrator.enqueue(async () => {
      order.push('second-start');
      order.push('second-end');
      return 'second';
    });

    await Promise.resolve();
    expect(order).toEqual(['first-start']);

    firstGate.resolve(undefined);

    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(order).toEqual([
      'first-start',
      'first-end',
      'second-start',
      'second-end'
    ]);
  });

  it('allows parallel writes across different scopes', async () => {
    const orchestrator = new LocalWriteOrchestrator();
    const gateA = deferred<void>();
    const gateB = deferred<void>();
    const order: string[] = [];

    const writeA = orchestrator.enqueue(
      async () => {
        order.push('a-start');
        await gateA.promise;
        order.push('a-end');
        return 'a';
      },
      { scope: 'contacts' }
    );

    const writeB = orchestrator.enqueue(
      async () => {
        order.push('b-start');
        await gateB.promise;
        order.push('b-end');
        return 'b';
      },
      { scope: 'email' }
    );

    await Promise.resolve();
    expect(order).toEqual(['a-start', 'b-start']);

    gateA.resolve(undefined);
    gateB.resolve(undefined);

    await expect(writeA).resolves.toBe('a');
    await expect(writeB).resolves.toBe('b');
  });

  it('retries SQLite conflicts and eventually succeeds', async () => {
    const orchestrator = new LocalWriteOrchestrator();
    let calls = 0;

    const result = await orchestrator.enqueue(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw new Error('SQLITE_BUSY: database is locked');
        }
        return 'ok';
      },
      { maxRetries: 5, retryDelayMs: 0 }
    );

    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('throws after retry limit is exhausted', async () => {
    const orchestrator = new LocalWriteOrchestrator();
    let calls = 0;

    await expect(
      orchestrator.enqueue(
        async () => {
          calls += 1;
          throw new Error('SQLITE_LOCKED: conflict');
        },
        { maxRetries: 1, retryDelayMs: 0 }
      )
    ).rejects.toThrow('SQLITE_LOCKED');

    expect(calls).toBe(2);
  });

  it('supports custom conflict detection', async () => {
    const orchestrator = new LocalWriteOrchestrator();
    let calls = 0;

    await expect(
      orchestrator.enqueue(
        async () => {
          calls += 1;
          throw new Error('custom-conflict');
        },
        {
          maxRetries: 2,
          retryDelayMs: 0,
          detectConflict: (context) =>
            context.error instanceof Error &&
            context.error.message === 'custom-conflict'
        }
      )
    ).rejects.toThrow('custom-conflict');

    expect(calls).toBe(3);
  });

  it('drain waits for queued work to finish', async () => {
    const orchestrator = new LocalWriteOrchestrator();
    const gate = deferred<void>();
    let finished = false;

    const pending = orchestrator.enqueue(async () => {
      await gate.promise;
      finished = true;
    });

    const drainPromise = orchestrator.drain();
    await Promise.resolve();
    expect(finished).toBe(false);

    gate.resolve(undefined);

    await pending;
    await drainPromise;
    expect(finished).toBe(true);
  });
});

describe('isDefaultSqliteConflict', () => {
  it('detects busy/locked/constraint errors', () => {
    expect(isDefaultSqliteConflict(new Error('SQLITE_BUSY'))).toBe(true);
    expect(isDefaultSqliteConflict(new Error('SQLITE_LOCKED'))).toBe(true);
    expect(isDefaultSqliteConflict(new Error('SQLITE_CONSTRAINT'))).toBe(true);
  });

  it('ignores non-conflict errors', () => {
    expect(isDefaultSqliteConflict(new Error('network timeout'))).toBe(false);
  });
});
