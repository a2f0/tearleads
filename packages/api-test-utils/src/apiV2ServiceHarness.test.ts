import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ApiV2ServiceHarnessDependencies,
  startApiV2ServiceHarness
} from './apiV2ServiceHarness.js';

class FakeServer extends EventEmitter {
  constructor(private readonly port: number) {
    super();
  }

  listen(_port: number, _host: string, callback: () => void): void {
    callback();
  }

  address(): { address: string; family: string; port: number } {
    return { address: '127.0.0.1', family: 'IPv4', port: this.port };
  }

  close(callback: (error?: Error) => void): void {
    callback();
  }
}

class FakeSocket extends EventEmitter {
  private destroyed = false;

  destroy(): void {
    this.destroyed = true;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }
}

class FakeStderr extends EventEmitter {
  private readonly encodings: string[] = [];

  setEncoding(encoding: string): void {
    this.encodings.push(encoding);
  }

  getEncodingCalls(): string[] {
    return this.encodings;
  }
}

class FakeProcess extends EventEmitter {
  public exitCode: number | null = null;
  public readonly stderr = new FakeStderr();
  public readonly killedSignals: string[] = [];

  constructor(
    private readonly onKill: (signal: string, process: FakeProcess) => void
  ) {
    super();
  }

  kill(signal: string): void {
    this.killedSignals.push(signal);
    this.onKill(signal, this);
  }
}

type HarnessMocks = {
  spawn: ReturnType<typeof vi.fn>;
  createServer: ReturnType<typeof vi.fn>;
  connectSocket: ReturnType<typeof vi.fn>;
  delay: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  stat: ReturnType<typeof vi.fn>;
  unlink: ReturnType<typeof vi.fn>;
  now: ReturnType<typeof vi.fn>;
};

function createFileHandle() {
  return {
    writeFile: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined)
  };
}

function createHarnessDeps(): {
  dependencies: Partial<ApiV2ServiceHarnessDependencies>;
  mocks: HarnessMocks;
} {
  const now = Date.now();
  const mocks: HarnessMocks = {
    spawn: vi.fn(),
    createServer: vi.fn(),
    connectSocket: vi.fn(),
    delay: vi.fn(
      async () =>
        new Promise((resolvePromise) => {
          setImmediate(() => resolvePromise(undefined));
        })
    ),
    open: vi.fn(async () => createFileHandle()),
    stat: vi.fn(async () => ({ mtimeMs: now })),
    unlink: vi.fn(async () => undefined),
    now: vi.fn(() => now)
  };

  return {
    dependencies: {
      spawn: mocks.spawn,
      createServer: mocks.createServer,
      connectSocket: mocks.connectSocket,
      delay: mocks.delay,
      open: mocks.open,
      stat: mocks.stat,
      unlink: mocks.unlink,
      now: mocks.now
    },
    mocks
  };
}

describe('startApiV2ServiceHarness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts, retries readiness, and stops on SIGTERM', async () => {
    const { dependencies, mocks } = createHarnessDeps();
    const process = new FakeProcess((signal, currentProcess) => {
      if (signal === 'SIGTERM') {
        queueMicrotask(() => {
          currentProcess.exitCode = 0;
          currentProcess.emit('exit', 0);
        });
      }
    });
    let connectAttempts = 0;

    mocks.delay.mockImplementation(async (timeoutMs: number) => {
      if (timeoutMs === 250) {
        return undefined;
      }
      return new Promise((resolvePromise) => {
        setImmediate(() => resolvePromise(undefined));
      });
    });
    mocks.createServer.mockReturnValue(new FakeServer(32001));
    mocks.spawn.mockReturnValue(process);
    mocks.connectSocket.mockImplementation(() => {
      const socket = new FakeSocket();
      queueMicrotask(() => {
        if (connectAttempts === 0) {
          connectAttempts += 1;
          socket.emit('error', new Error('connection refused'));
          return;
        }
        socket.emit('connect');
      });
      return socket;
    });

    const harness = await startApiV2ServiceHarness(dependencies);

    expect(harness.port).toBe(32001);
    expect(process.stderr.getEncodingCalls()).toEqual(['utf8']);
    expect(mocks.delay).toHaveBeenCalledWith(250);

    await harness.stop();
    expect(process.killedSignals).toEqual(['SIGTERM']);
  });

  it('falls back to SIGKILL when SIGTERM does not exit', async () => {
    const { dependencies, mocks } = createHarnessDeps();
    const process = new FakeProcess((signal, currentProcess) => {
      if (signal === 'SIGKILL') {
        queueMicrotask(() => {
          currentProcess.exitCode = 137;
          currentProcess.emit('exit', 137);
        });
      }
    });

    mocks.createServer.mockReturnValue(new FakeServer(32002));
    mocks.spawn.mockReturnValue(process);
    mocks.connectSocket.mockImplementation(() => {
      const socket = new FakeSocket();
      queueMicrotask(() => {
        socket.emit('connect');
      });
      return socket;
    });

    const harness = await startApiV2ServiceHarness(dependencies);
    await harness.stop();

    expect(process.killedSignals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(mocks.delay).toHaveBeenCalledWith(5_000);
  });

  it('reports truncated stderr when harness exits before readiness', async () => {
    const { dependencies, mocks } = createHarnessDeps();
    const process = new FakeProcess(() => {});
    const noisyLog = `start-marker-${'x'.repeat(5_000)}-tail-marker`;

    mocks.createServer.mockReturnValue(new FakeServer(32003));
    mocks.spawn.mockReturnValue(process);
    mocks.connectSocket.mockImplementation(() => {
      const socket = new FakeSocket();
      queueMicrotask(() => {
        process.stderr.emit('data', noisyLog);
        socket.emit('error', new Error('connection refused'));
      });
      return socket;
    });
    mocks.delay.mockImplementation(async (timeoutMs: number) => {
      if (timeoutMs === 250) {
        process.exitCode = 42;
      }
      return undefined;
    });

    let thrownError: Error | null = null;
    try {
      await startApiV2ServiceHarness(dependencies);
    } catch (error) {
      if (error instanceof Error) {
        thrownError = error;
      }
    }

    expect(thrownError).not.toBeNull();
    if (thrownError === null) {
      throw new Error('expected harness startup to fail');
    }
    expect(thrownError.message).toContain(
      'api-v2 harness exited before readiness (code 42)'
    );
    expect(thrownError.message).toContain('tail-marker');
    expect(thrownError.message).not.toContain('start-marker');
  });

  it('retries transient rust bootstrap failures before succeeding', async () => {
    const { dependencies, mocks } = createHarnessDeps();
    const failingProcess = new FakeProcess(() => {});
    const passingProcess = new FakeProcess((signal, currentProcess) => {
      if (signal === 'SIGTERM') {
        queueMicrotask(() => {
          currentProcess.exitCode = 0;
          currentProcess.emit('exit', 0);
        });
      }
    });

    mocks.createServer
      .mockReturnValueOnce(new FakeServer(32005))
      .mockReturnValueOnce(new FakeServer(32006));
    mocks.spawn
      .mockReturnValueOnce(failingProcess)
      .mockReturnValueOnce(passingProcess);
    mocks.connectSocket.mockImplementation(() => {
      const socket = new FakeSocket();
      queueMicrotask(() => {
        if (failingProcess.exitCode === null) {
          failingProcess.stderr.emit(
            'data',
            "error: the 'cargo' binary, normally provided by the 'cargo' component, is not applicable to the toolchain"
          );
          socket.emit('error', new Error('connection refused'));
          return;
        }
        socket.emit('connect');
      });
      return socket;
    });
    mocks.delay.mockImplementation(async (timeoutMs: number) => {
      if (timeoutMs === 250 && failingProcess.exitCode === null) {
        failingProcess.exitCode = 1;
      }
      return new Promise((resolvePromise) => {
        setImmediate(() => resolvePromise(undefined));
      });
    });

    const harness = await startApiV2ServiceHarness(dependencies);

    expect(harness.port).toBe(32006);
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    expect(mocks.delay).toHaveBeenCalledWith(1_000);
    await harness.stop();
  });

  it('removes stale startup lock and continues', async () => {
    const { dependencies, mocks } = createHarnessDeps();
    const process = new FakeProcess((signal, currentProcess) => {
      if (signal === 'SIGTERM') {
        queueMicrotask(() => {
          currentProcess.exitCode = 0;
          currentProcess.emit('exit', 0);
        });
      }
    });
    const lockExistsError = new Error('already exists');
    Object.defineProperty(lockExistsError, 'code', { value: 'EEXIST' });
    const staleMtimeMs = Date.now() - 400_000;

    mocks.open
      .mockRejectedValueOnce(lockExistsError)
      .mockResolvedValueOnce(createFileHandle());
    mocks.stat.mockResolvedValueOnce({ mtimeMs: staleMtimeMs });
    mocks.createServer.mockReturnValue(new FakeServer(32004));
    mocks.spawn.mockReturnValue(process);
    mocks.connectSocket.mockImplementation(() => {
      const socket = new FakeSocket();
      queueMicrotask(() => {
        socket.emit('connect');
      });
      return socket;
    });

    const harness = await startApiV2ServiceHarness(dependencies);
    await harness.stop();
    expect(mocks.unlink).toHaveBeenCalled();
  });
});
