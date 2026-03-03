import { createServer, type Server } from 'node:http';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createExpressPassthroughHandlers } from './passthroughHandlers.js';

interface RecordingServer {
  hits: string[];
  port: number;
  server: Server;
}

async function startRecordingServer(): Promise<RecordingServer> {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(req.url ?? '/');
    res.statusCode = 200;
    res.end('ok');
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Failed to determine recording server port');
  }

  return {
    hits,
    port: address.port,
    server
  };
}

async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

describe('createExpressPassthroughHandlers', () => {
  const mswServer = setupServer();
  let attacker: RecordingServer;
  let target: RecordingServer;

  beforeAll(async () => {
    attacker = await startRecordingServer();
    target = await startRecordingServer();
    mswServer.listen({ onUnhandledRequest: 'error' });
  });

  beforeEach(() => {
    attacker.hits.length = 0;
    target.hits.length = 0;
    mswServer.resetHandlers(
      ...createExpressPassthroughHandlers('http://example.test', target.port)
    );
  });

  afterAll(async () => {
    mswServer.close();
    await stopServer(attacker.server);
    await stopServer(target.server);
  });

  it('pins passthrough requests to the target localhost host', async () => {
    const pathWithInjectedHost = `//127.0.0.1:${String(attacker.port)}/probe?x=1`;

    const response = await fetch(`http://example.test${pathWithInjectedHost}`);

    expect(response.ok).toBe(true);
    expect(attacker.hits).toHaveLength(0);
    expect(target.hits).toEqual([
      `/127.0.0.1:${String(attacker.port)}/probe?x=1`
    ]);
  });
});
