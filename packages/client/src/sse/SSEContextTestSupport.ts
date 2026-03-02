import { vi } from 'vitest';

export const mockTryRefreshToken = vi.fn().mockResolvedValue(false);
export const mockIsJwtExpired = vi.fn().mockReturnValue(false);

export interface OpenNotificationStreamOptions {
  apiBaseUrl: string;
  channels: string[];
  token?: string | null;
  signal?: AbortSignal;
}

interface MockReader {
  chunks: string[];
  chunkIndex: number;
  aborted: boolean;
  read: () => Promise<{ done: boolean; value?: Uint8Array }>;
}

interface MockSSEConnection {
  reader: MockReader;
  abortController: AbortController;
  emit: (event: string, data?: string) => void;
  close: () => void;
}

interface MockSSEEvent {
  event: string;
  data: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSSEEvents(
  chunk: string,
  buffer: string
): [MockSSEEvent[], string] {
  const combined = buffer + chunk;
  const events: MockSSEEvent[] = [];
  const blocks = combined.split('\n\n');

  const remaining = blocks.pop() ?? '';

  for (const block of blocks) {
    if (!block.trim()) {
      continue;
    }

    let eventType = 'message';
    const dataParts: string[] = [];

    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        let value = line.slice(5);
        if (value.startsWith(' ')) {
          value = value.slice(1);
        }
        dataParts.push(value);
      }
    }

    const data = dataParts.join('\n');

    if (data || eventType !== 'message') {
      events.push({ event: eventType, data });
    }
  }

  return [events, remaining];
}

function toNotificationPayload(event: string, data: string): string {
  if (event === 'connected') {
    return JSON.stringify({ event: 'connected' });
  }

  if (event !== 'message') {
    return JSON.stringify({ event, data });
  }

  try {
    const parsed = JSON.parse(data);
    if (isRecord(parsed)) {
      return JSON.stringify({ event, ...parsed });
    }
    return JSON.stringify({ event, data: parsed });
  } catch {
    return data;
  }
}

export const mockSSE = {
  connections: [] as MockSSEConnection[],
  fetchMock: null as ReturnType<typeof vi.fn> | null,

  reset() {
    mockSSE.connections = [];
  },

  createConnection(): MockSSEConnection {
    const encoder = new TextEncoder();
    const abortController = new AbortController();

    const reader: MockReader = {
      chunks: [],
      chunkIndex: 0,
      aborted: false,
      read: async function () {
        if (this.aborted) {
          return { done: true };
        }

        while (this.chunkIndex >= this.chunks.length && !this.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }

        if (this.aborted) {
          return { done: true };
        }

        const chunk = this.chunks[this.chunkIndex];
        this.chunkIndex++;
        return { done: false, value: encoder.encode(chunk) };
      }
    };

    const connection: MockSSEConnection = {
      reader,
      abortController,
      emit: (event: string, data = '') => {
        let chunk = `event: ${event}\n`;
        if (data) {
          chunk += `data: ${data}\n`;
        }
        chunk += '\n';
        reader.chunks.push(chunk);
      },
      close: () => {
        reader.aborted = true;
      }
    };

    mockSSE.connections.push(connection);
    return connection;
  },

  getInstance(index: number): MockSSEConnection {
    const connection = mockSSE.connections[index];
    if (!connection) {
      throw new Error(`MockSSEConnection instance ${index} not found`);
    }
    return connection;
  },

  getLastInstance(): MockSSEConnection {
    const connection = mockSSE.connections[mockSSE.connections.length - 1];
    if (!connection) {
      throw new Error('No MockSSEConnection instances');
    }
    return connection;
  },

  openNotificationEventStream(
    options: OpenNotificationStreamOptions
  ): AsyncGenerator<string> {
    const fetchMock = mockSSE.fetchMock;
    if (!fetchMock) {
      throw new Error('Mock SSE fetch is not configured');
    }

    const channels = options.channels.join(',');
    const url = `${options.apiBaseUrl}/sse?channels=${encodeURIComponent(channels)}`;

    const headers: Record<string, string> = {};
    if (options.token && options.token.length > 0) {
      headers['Authorization'] = options.token.startsWith('Bearer ')
        ? options.token
        : `Bearer ${options.token}`;
    }

    return (async function* () {
      const response = await fetchMock(url, {
        headers,
        signal: options.signal
      });

      if (!response.ok) {
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        const [events, remaining] = parseSSEEvents(chunk, buffer);
        buffer = remaining;

        for (const { event, data } of events) {
          yield toNotificationPayload(event, data);
        }
      }
    })();
  }
};

export function createMockFetch(): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
    const connection = mockSSE.createConnection();

    if (options?.signal) {
      options.signal.addEventListener('abort', () => {
        connection.close();
      });
    }

    return Promise.resolve({
      ok: true,
      body: {
        getReader: () => connection.reader
      }
    });
  });
}
