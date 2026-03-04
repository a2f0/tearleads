import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  createServer: vi.fn(),
  connect: vi.fn(),
  delay: vi.fn()
}));

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('node:http', () => ({ createServer: mocks.createServer }));
vi.mock('node:net', () => ({ connect: mocks.connect }));
vi.mock('node:timers/promises', () => ({ setTimeout: mocks.delay }));

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

async function loadModule() {
  return import('./apiV2ServiceHarness.js');
}

describe('startApiV2ServiceHarness', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.spawn.mockReset();
    mocks.createServer.mockReset();
    mocks.connect.mockReset();
    mocks.delay.mockReset();
    mocks.delay.mockResolvedValue(undefined);
  });

  it('starts, retries readiness, and stops on SIGTERM', async () => {
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
    mocks.connect.mockImplementation(() => {
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

    const { startApiV2ServiceHarness } = await loadModule();
    const harness = await startApiV2ServiceHarness();

    expect(harness.port).toBe(32001);
    expect(process.stderr.getEncodingCalls()).toEqual(['utf8']);
    expect(mocks.delay).toHaveBeenCalledWith(250);

    await harness.stop();
    expect(process.killedSignals).toEqual(['SIGTERM']);
  });

  it('falls back to SIGKILL when SIGTERM does not exit', async () => {
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
    mocks.connect.mockImplementation(() => {
      const socket = new FakeSocket();
      queueMicrotask(() => {
        socket.emit('connect');
      });
      return socket;
    });

    const { startApiV2ServiceHarness } = await loadModule();
    const harness = await startApiV2ServiceHarness();
    await harness.stop();

    expect(process.killedSignals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(mocks.delay).toHaveBeenCalledWith(5_000);
  });

  it('reports truncated stderr when harness exits before readiness', async () => {
    const process = new FakeProcess(() => {});
    const noisyLog = `start-marker-${'x'.repeat(5_000)}-tail-marker`;

    mocks.createServer.mockReturnValue(new FakeServer(32003));
    mocks.spawn.mockReturnValue(process);
    mocks.connect.mockImplementation(() => {
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

    const { startApiV2ServiceHarness } = await loadModule();
    let thrownError: Error | null = null;
    try {
      await startApiV2ServiceHarness();
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
});
