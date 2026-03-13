import type { Server } from 'node:http';
import { Code, createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-node';
import { AdminService } from '@tearleads/shared/gen/tearleads/v2/admin_pb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../index.js';

function getBaseUrl(server: Server): string {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Server did not provide an address');
  }

  return `http://127.0.0.1:${address.port}`;
}

function createAdminClient(server: Server, requestPathPrefix = '/v1/connect') {
  const transport = createConnectTransport({
    httpVersion: '1.1',
    baseUrl: `${getBaseUrl(server)}${requestPathPrefix}`
  });
  return createClient(AdminService, transport);
}

function startServer(): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

describe('Connect AdminService route registration', () => {
  let server: Server;

  beforeEach(async () => {
    server = await startServer();
  });

  afterEach(async () => {
    await closeServer(server);
  });

  it('returns unauthenticated for GetContext without bearer token', async () => {
    const client = createAdminClient(server);

    await expect(client.getContext({})).rejects.toMatchObject({
      code: Code.Unauthenticated
    });
  });

  it('returns unauthenticated for GetTables without bearer token', async () => {
    const client = createAdminClient(server);

    await expect(client.getTables({})).rejects.toMatchObject({
      code: Code.Unauthenticated
    });
  });

  it('serves the canonical /connect prefix', async () => {
    const client = createAdminClient(server, '/connect');

    await expect(client.getContext({})).rejects.toMatchObject({
      code: Code.Unauthenticated
    });
  });
});
