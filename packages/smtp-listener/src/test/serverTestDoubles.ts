import { EventEmitter } from 'node:events';
import { vi } from 'vitest';

type OnDataHandler = (
  stream: {
    on: (event: string, handler: (...args: unknown[]) => void) => void;
  },
  session: { envelope: { mailFrom: unknown; rcptTo: unknown[] } },
  callback: (err?: Error) => void
) => void;

const doubles = vi.hoisted(() => ({
  mockStorageStore: vi.fn(),
  mockStorageClose: vi.fn(),
  mockServerListen: vi.fn(),
  mockServerClose: vi.fn(),
  mockServerOn: vi.fn(),
  capturedOnDataRef: { current: null as OnDataHandler | null },
  mockServerAddress: vi.fn<() => { port: number } | string | null>(() => ({
    port: 2525
  }))
}));

vi.mock('../lib/storage.js', () => ({
  createStorage: vi.fn(() =>
    Promise.resolve({
      store: doubles.mockStorageStore,
      close: doubles.mockStorageClose
    })
  )
}));

vi.mock('smtp-server', () => ({
  SMTPServer: class {
    server = { address: doubles.mockServerAddress };
    listen = doubles.mockServerListen;
    close = doubles.mockServerClose;
    on = doubles.mockServerOn;

    constructor(options: { onData: OnDataHandler }) {
      doubles.capturedOnDataRef.current = options.onData;
    }
  }
}));

export const getSmtpTestDoubles = () => doubles;

export const resetSmtpTestDoubles = (): void => {
  vi.clearAllMocks();
  doubles.mockServerAddress.mockReturnValue({ port: 2525 });
  doubles.mockServerListen.mockImplementation(
    (_port: number, _host: string | undefined, callback: () => void) => {
      callback();
    }
  );
  doubles.mockServerClose.mockImplementation((callback: () => void) => {
    callback();
  });
  doubles.mockStorageStore.mockResolvedValue(undefined);
  doubles.mockStorageClose.mockResolvedValue(undefined);
};

export const createMockStream = (): EventEmitter => new EventEmitter();
