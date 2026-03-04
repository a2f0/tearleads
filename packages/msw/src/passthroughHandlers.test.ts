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
  let v1Target: RecordingServer;
  let v2Target: RecordingServer;

  beforeAll(async () => {
    attacker = await startRecordingServer();
    v1Target = await startRecordingServer();
    v2Target = await startRecordingServer();
    mswServer.listen({ onUnhandledRequest: 'error' });
  });

  beforeEach(() => {
    attacker.hits.length = 0;
    v1Target.hits.length = 0;
    v2Target.hits.length = 0;
    mswServer.resetHandlers(
      ...createExpressPassthroughHandlers('http://example.test', v1Target.port)
    );
  });

  afterAll(async () => {
    mswServer.close();
    await stopServer(attacker.server);
    await stopServer(v1Target.server);
    await stopServer(v2Target.server);
  });

  it('pins passthrough requests to the target localhost host', async () => {
    const pathWithInjectedHost = `//127.0.0.1:${String(attacker.port)}/probe?x=1`;

    const response = await fetch(`http://example.test${pathWithInjectedHost}`);

    expect(response.ok).toBe(true);
    expect(attacker.hits).toHaveLength(0);
    expect(v1Target.hits).toEqual([
      `/127.0.0.1:${String(attacker.port)}/probe?x=1`
    ]);
  });

  it('routes matched paths to override target and skips default prefix', async () => {
    mswServer.resetHandlers(
      ...createExpressPassthroughHandlers(
        'http://example.test',
        v1Target.port,
        '/v1',
        [
          {
            pathnamePattern: /^\/connect\/tearleads\.v2\.AdminService\//,
            targetPort: v2Target.port,
            pathPrefix: ''
          }
        ]
      )
    );

    const v1Response = await fetch(
      'http://example.test/connect/tearleads.v1.AuthService/Login'
    );
    const v2Response = await fetch(
      'http://example.test/connect/tearleads.v2.AdminService/GetTables'
    );

    expect(v1Response.ok).toBe(true);
    expect(v2Response.ok).toBe(true);
    expect(v1Target.hits).toEqual([
      '/v1/connect/tearleads.v1.AuthService/Login'
    ]);
    expect(v2Target.hits).toEqual([
      '/connect/tearleads.v2.AdminService/GetTables'
    ]);
  });

  it('strips /v1 for override routes that skip prefixing', async () => {
    mswServer.resetHandlers(
      ...createExpressPassthroughHandlers(
        'http://example.test',
        v1Target.port,
        '/v1',
        [
          {
            pathnamePattern:
              /^\/(?:v1\/)?connect\/tearleads\.v2\.AdminService\//,
            targetPort: v2Target.port,
            pathPrefix: ''
          }
        ]
      )
    );

    const response = await fetch(
      'http://example.test/v1/connect/tearleads.v2.AdminService/GetRedisDbSize'
    );

    expect(response.ok).toBe(true);
    expect(v2Target.hits).toEqual([
      '/connect/tearleads.v2.AdminService/GetRedisDbSize'
    ]);
  });
});
