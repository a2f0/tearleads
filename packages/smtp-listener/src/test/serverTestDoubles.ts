import { EventEmitter } from 'node:events';
import { vi } from 'vitest';

type OnDataHandler = (
  stream: {
    on: (event: string, handler: (...args: unknown[]) => void) => void;
  },
  session: { envelope: { mailFrom: unknown; rcptTo: unknown[] } },
  callback: (err?: Error) => void
) => void;

interface SmtpTestDoubles {
  mockServerListen: ReturnType<typeof vi.fn>;
  mockServerClose: ReturnType<typeof vi.fn>;
  mockServerOn: ReturnType<typeof vi.fn>;
  capturedOnDataRef: { current: OnDataHandler | null };
  mockServerAddress: ReturnType<
    typeof vi.fn<() => { port: number } | string | null>
  >;
}

const doubles: SmtpTestDoubles = vi.hoisted(() => ({
  mockServerListen: vi.fn(),
  mockServerClose: vi.fn(),
  mockServerOn: vi.fn(),
  capturedOnDataRef: { current: null as OnDataHandler | null },
  mockServerAddress: vi.fn<() => { port: number } | string | null>(() => ({
    port: 2525
  }))
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

export const getSmtpTestDoubles = (): SmtpTestDoubles => doubles;

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
};

export const createMockStream = (): EventEmitter => new EventEmitter();
