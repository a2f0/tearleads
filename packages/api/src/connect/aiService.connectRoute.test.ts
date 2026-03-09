import type { Server } from 'node:http';
import { Code, createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-node';
import { AiService } from '@tearleads/shared/gen/tearleads/v2/ai_pb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../index.js';

function getBaseUrl(server: Server): string {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Server did not provide an address');
  }

  return `http://127.0.0.1:${address.port}`;
}

function createAiClient(server: Server) {
  const transport = createConnectTransport({
    httpVersion: '1.1',
    baseUrl: `${getBaseUrl(server)}/v1/connect`
  });
  return createClient(AiService, transport);
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

describe('Connect AiService v2 route registration', () => {
  let server: Server;

  beforeEach(async () => {
    server = await startServer();
  });

  afterEach(async () => {
    await closeServer(server);
  });

  it('returns unauthenticated for GetUsage without bearer token', async () => {
    const client = createAiClient(server);

    await expect(client.getUsage({})).rejects.toMatchObject({
      code: Code.Unauthenticated
    });
  });

  it('returns unauthenticated for GetUsageSummary without bearer token', async () => {
    const client = createAiClient(server);

    await expect(client.getUsageSummary({})).rejects.toMatchObject({
      code: Code.Unauthenticated
    });
  });

  it('returns unauthenticated for RecordUsage without bearer token', async () => {
    const client = createAiClient(server);

    await expect(
      client.recordUsage({
        modelId: 'openai/gpt-4o-mini',
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2
      })
    ).rejects.toMatchObject({
      code: Code.Unauthenticated
    });
  });
});
