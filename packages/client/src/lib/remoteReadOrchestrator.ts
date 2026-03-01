interface RemoteReadExecutionContext {
  scope: string;
  signal: AbortSignal;
}

interface RemoteReadOptions {
  scope?: string;
  debounceMs?: number;
  coalesceInFlight?: boolean;
}

type RemoteReadOperation<Result> = (
  context: RemoteReadExecutionContext
) => Promise<Result>;

interface Deferred<Result> {
  promise: Promise<Result>;
  resolve: (value: Result | PromiseLike<Result>) => void;
  reject: (reason?: unknown) => void;
}

interface ScopeState<Result> {
  tail: Promise<void>;
  inFlight: Promise<Result> | null;
  joinable: Promise<Result> | null;
  inFlightController: AbortController | null;
  scheduledDebounceMs: number | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  debouncedDeferred: Deferred<Result> | null;
  debouncedOperation: RemoteReadOperation<Result> | null;
}

const DEFAULT_SCOPE = 'remote-read-default';

function createDeferred<Result>(): Deferred<Result> {
  let resolveValue: ((value: Result | PromiseLike<Result>) => void) | null =
    null;
  let rejectValue: ((reason?: unknown) => void) | null = null;
  const promise = new Promise<Result>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });

  return {
    promise,
    resolve: (value) => {
      if (resolveValue) {
        resolveValue(value);
      }
    },
    reject: (reason) => {
      if (rejectValue) {
        rejectValue(reason);
      }
    }
  };
}

class RemoteReadOrchestrator<Result = unknown> {
  private readonly states = new Map<string, ScopeState<Result>>();

  schedule(
    operation: RemoteReadOperation<Result>,
    options: RemoteReadOptions = {}
  ): Promise<Result> {
    const scope = options.scope ?? DEFAULT_SCOPE;
    const debounceMs = options.debounceMs ?? 0;
    const coalesceInFlight = options.coalesceInFlight ?? true;
    const state = this.getScopeState(scope);

    if (debounceMs > 0) {
      return this.scheduleDebounced(
        state,
        scope,
        operation,
        debounceMs,
        coalesceInFlight
      );
    }

    return this.scheduleImmediate(state, scope, operation, coalesceInFlight);
  }

  async drain(scope?: string): Promise<void> {
    if (scope) {
      await this.drainScope(scope);
      return;
    }

    const scopeKeys = [...this.states.keys()];
    await Promise.all(scopeKeys.map((scopeKey) => this.drainScope(scopeKey)));
  }

  cancelInFlight(scope?: string): void {
    if (scope) {
      this.getScopeState(scope).inFlightController?.abort();
      return;
    }

    for (const state of this.states.values()) {
      state.inFlightController?.abort();
    }
  }

  private async drainScope(scope: string): Promise<void> {
    const state = this.states.get(scope);
    if (!state) {
      return;
    }

    while (true) {
      const debouncedDeferred = state.debouncedDeferred;
      if (debouncedDeferred) {
        await debouncedDeferred.promise.catch(() => undefined);
      } else {
        const tail = state.tail;
        await tail;
      }

      if (
        state.debounceTimer === null &&
        state.inFlight === null &&
        state.joinable === null
      ) {
        this.cleanupStateIfIdle(scope, state);
        return;
      }
    }
  }

  private scheduleImmediate(
    state: ScopeState<Result>,
    scope: string,
    operation: RemoteReadOperation<Result>,
    coalesceInFlight: boolean
  ): Promise<Result> {
    if (coalesceInFlight && state.inFlight) {
      return state.inFlight;
    }
    if (coalesceInFlight && state.joinable) {
      return state.joinable;
    }

    const previousTail = state.tail;
    let runPromise: Promise<Result> | null = null;
    runPromise = previousTail.then(async () => {
      if (runPromise === null) {
        throw new Error('remote read orchestration invariant violated');
      }

      const controller = new AbortController();
      state.inFlightController = controller;
      try {
        state.inFlight = runPromise;
        return await operation({ scope, signal: controller.signal });
      } finally {
        if (state.inFlight === runPromise) {
          state.inFlight = null;
        }
        if (state.joinable === runPromise) {
          state.joinable = null;
        }
        if (state.inFlightController === controller) {
          state.inFlightController = null;
        }
      }
    });
    if (coalesceInFlight) {
      state.joinable = runPromise;
    }

    state.tail = runPromise.then(
      () => undefined,
      () => undefined
    );

    void state.tail.finally(() => {
      this.cleanupStateIfIdle(scope, state);
    });

    return runPromise;
  }

  private scheduleDebounced(
    state: ScopeState<Result>,
    scope: string,
    operation: RemoteReadOperation<Result>,
    debounceMs: number,
    coalesceInFlight: boolean
  ): Promise<Result> {
    if (coalesceInFlight && state.inFlight) {
      return state.inFlight;
    }
    if (coalesceInFlight && state.joinable) {
      return state.joinable;
    }

    if (state.debounceTimer && state.scheduledDebounceMs === debounceMs) {
      if (!state.debouncedDeferred) {
        throw new Error('remote read debounce state invariant violated');
      }
      state.debouncedOperation = operation;
      return state.debouncedDeferred.promise;
    }

    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
      state.scheduledDebounceMs = null;
      state.debouncedDeferred = null;
      state.debouncedOperation = null;
    }

    const deferred = createDeferred<Result>();
    state.debouncedDeferred = deferred;
    state.debouncedOperation = operation;
    state.scheduledDebounceMs = debounceMs;
    state.debounceTimer = setTimeout(() => {
      state.debounceTimer = null;
      state.scheduledDebounceMs = null;
      const debouncedDeferred = state.debouncedDeferred;
      const debouncedOperation = state.debouncedOperation;
      state.debouncedDeferred = null;
      state.debouncedOperation = null;

      if (!debouncedDeferred || !debouncedOperation) {
        return;
      }

      this.scheduleImmediate(
        state,
        scope,
        debouncedOperation,
        coalesceInFlight
      ).then(
        (value) => {
          debouncedDeferred.resolve(value);
        },
        (error) => {
          debouncedDeferred.reject(error);
        }
      );
    }, debounceMs);

    return deferred.promise;
  }

  private getScopeState(scope: string): ScopeState<Result> {
    const existing = this.states.get(scope);
    if (existing) {
      return existing;
    }

    const created: ScopeState<Result> = {
      tail: Promise.resolve(),
      inFlight: null,
      joinable: null,
      inFlightController: null,
      scheduledDebounceMs: null,
      debounceTimer: null,
      debouncedDeferred: null,
      debouncedOperation: null
    };
    this.states.set(scope, created);
    return created;
  }

  private cleanupStateIfIdle(scope: string, state: ScopeState<Result>): void {
    if (
      state.debounceTimer === null &&
      state.inFlight === null &&
      state.joinable === null &&
      state.inFlightController === null &&
      state.debouncedDeferred === null &&
      state.debouncedOperation === null
    ) {
      this.states.delete(scope);
    }
  }
}

interface RemoteReadOrchestratorInstance<Result = unknown> {
  schedule: (
    operation: RemoteReadOperation<Result>,
    options?: RemoteReadOptions
  ) => Promise<Result>;
  drain: (scope?: string) => Promise<void>;
  cancelInFlight: (scope?: string) => void;
}

export function createRemoteReadOrchestrator<
  Result = unknown
>(): RemoteReadOrchestratorInstance<Result> {
  return new RemoteReadOrchestrator<Result>();
}
