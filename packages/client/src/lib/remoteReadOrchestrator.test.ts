import { createRemoteReadOrchestrator } from './remoteReadOrchestrator';

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('createRemoteReadOrchestrator', () => {
  it('serializes reads within one scope when coalescing is disabled', async () => {
    const orchestrator = createRemoteReadOrchestrator<string>();
    const firstGate = deferred<void>();
    const order: string[] = [];

    const first = orchestrator.schedule(
      async () => {
        order.push('first-start');
        await firstGate.promise;
        order.push('first-end');
        return 'first';
      },
      { scope: 'vfs', coalesceInFlight: false }
    );

    const second = orchestrator.schedule(
      async () => {
        order.push('second-start');
        order.push('second-end');
        return 'second';
      },
      { scope: 'vfs', coalesceInFlight: false }
    );

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

  it('coalesces concurrent in-flight reads by default', async () => {
    const orchestrator = createRemoteReadOrchestrator<string>();
    const gate = deferred<void>();
    let calls = 0;

    const first = orchestrator.schedule(async () => {
      calls += 1;
      await gate.promise;
      return 'ok';
    });

    const second = orchestrator.schedule(async () => {
      calls += 1;
      return 'second';
    });

    gate.resolve(undefined);

    await expect(first).resolves.toBe('ok');
    await expect(second).resolves.toBe('ok');
    expect(calls).toBe(1);
  });

  it('allows parallel reads across different scopes', async () => {
    const orchestrator = createRemoteReadOrchestrator<string>();
    const gateA = deferred<void>();
    const gateB = deferred<void>();
    const order: string[] = [];

    const readA = orchestrator.schedule(
      async () => {
        order.push('a-start');
        await gateA.promise;
        order.push('a-end');
        return 'a';
      },
      { scope: 'vfs-a', coalesceInFlight: false }
    );

    const readB = orchestrator.schedule(
      async () => {
        order.push('b-start');
        await gateB.promise;
        order.push('b-end');
        return 'b';
      },
      { scope: 'vfs-b', coalesceInFlight: false }
    );

    await Promise.resolve();
    expect(order).toEqual(['a-start', 'b-start']);

    gateA.resolve(undefined);
    gateB.resolve(undefined);

    await expect(readA).resolves.toBe('a');
    await expect(readB).resolves.toBe('b');
  });

  it('coalesces bursty reads during debounce window', async () => {
    const orchestrator = createRemoteReadOrchestrator<string>();
    let calls = 0;

    const first = orchestrator.schedule(
      async () => {
        calls += 1;
        return 'first';
      },
      { scope: 'vfs', debounceMs: 5 }
    );

    const second = orchestrator.schedule(
      async () => {
        calls += 1;
        return 'second';
      },
      { scope: 'vfs', debounceMs: 5 }
    );

    await sleep(15);

    await expect(first).resolves.toBe('second');
    await expect(second).resolves.toBe('second');
    expect(calls).toBe(1);
  });

  it('replaces pending debounce when debounceMs changes', async () => {
    const orchestrator = createRemoteReadOrchestrator<string>();
    let calls = 0;

    const first = orchestrator.schedule(
      async () => {
        calls += 1;
        return 'first';
      },
      { scope: 'vfs', debounceMs: 30 }
    );

    const second = orchestrator.schedule(
      async () => {
        calls += 1;
        return 'second';
      },
      { scope: 'vfs', debounceMs: 5 }
    );

    await sleep(20);
    await expect(second).resolves.toBe('second');
    expect(calls).toBe(1);

    const firstState = await Promise.race([
      first.then(() => 'resolved'),
      sleep(5).then(() => 'pending')
    ]);
    expect(firstState).toBe('pending');
  });

  it('drain waits for active and scheduled debounce work', async () => {
    const orchestrator = createRemoteReadOrchestrator<void>();
    let completed = false;

    void orchestrator.schedule(
      async () => {
        completed = true;
      },
      { scope: 'vfs', debounceMs: 5 }
    );

    const drainPromise = orchestrator.drain('vfs');
    await Promise.resolve();
    expect(completed).toBe(false);

    await sleep(15);
    await drainPromise;

    expect(completed).toBe(true);
  });

  it('propagates errors from debounced operations', async () => {
    const orchestrator = createRemoteReadOrchestrator<void>();
    const readPromise = orchestrator.schedule(
      async () => {
        throw new Error('debounced failure');
      },
      { scope: 'vfs', debounceMs: 5 }
    );

    await expect(readPromise).rejects.toThrow('debounced failure');
  });

  it('can abort an in-flight read', async () => {
    const orchestrator = createRemoteReadOrchestrator<string>();
    const aborted = deferred<void>();

    const readPromise = orchestrator.schedule(async ({ signal }) => {
      signal.addEventListener('abort', () => {
        aborted.resolve(undefined);
      });
      await aborted.promise;
      throw new Error('aborted');
    });

    await Promise.resolve();
    orchestrator.cancelInFlight();
    await expect(readPromise).rejects.toThrow('aborted');
  });

  it('can abort only a specific scope in-flight read', async () => {
    const orchestrator = createRemoteReadOrchestrator<string>();
    const abortedA = deferred<void>();
    const startedB = deferred<void>();

    const readA = orchestrator.schedule(
      async ({ signal }) => {
        signal.addEventListener('abort', () => {
          abortedA.resolve(undefined);
        });
        await abortedA.promise;
        throw new Error('aborted-a');
      },
      { scope: 'a', coalesceInFlight: false }
    );

    const readB = orchestrator.schedule(
      async () => {
        startedB.resolve(undefined);
        await sleep(15);
        return 'ok-b';
      },
      { scope: 'b', coalesceInFlight: false }
    );

    await Promise.resolve();
    orchestrator.cancelInFlight('a');
    await startedB.promise;

    await expect(readA).rejects.toThrow('aborted-a');
    await expect(readB).resolves.toBe('ok-b');
  });

  it('drain on an unknown scope resolves immediately', async () => {
    const orchestrator = createRemoteReadOrchestrator<void>();
    await expect(orchestrator.drain('missing-scope')).resolves.toBeUndefined();
  });
});
