import type {
  PingData,
  PostgresAdminInfoResponse,
  PostgresTablesResponse,
  RedisKeysResponse,
  RedisKeyValueResponse
} from '@rapid/shared';
import {
  DEFAULT_OPENROUTER_MODEL_ID,
  isOpenRouterModelId,
  isRecord,
  validateChatMessages
} from '@rapid/shared';
import { HttpResponse, http } from 'msw';

const ok = <T extends object>(body: T) => HttpResponse.json(body);

const defaultKeys: RedisKeysResponse['keys'] = Array.from(
  { length: 25 },
  (_, index) => ({
    key: `key:${index + 1}`,
    type: 'string',
    ttl: -1
  })
);

const defaultKeyValue = (key: string): RedisKeyValueResponse => ({
  key,
  type: 'string',
  ttl: -1,
  value: ''
});

const defaultPostgresInfo: PostgresAdminInfoResponse = {
  status: 'ok',
  info: {
    host: 'localhost',
    port: 5432,
    database: 'rapid',
    user: 'rapid'
  },
  serverVersion: 'PostgreSQL 15.1'
};

const defaultPostgresTables: PostgresTablesResponse = {
  tables: [
    {
      schema: 'public',
      name: 'users',
      rowCount: 12,
      totalBytes: 2048,
      tableBytes: 1024,
      indexBytes: 1024
    }
  ]
};

export const handlers = [
  http.get(/\/ping$/, () => ok<PingData>({ version: 'test', dbVersion: '0' })),
  http.get(/\/admin\/postgres\/info$/, () =>
    ok<PostgresAdminInfoResponse>(defaultPostgresInfo)
  ),
  http.get(/\/admin\/postgres\/tables$/, () =>
    ok<PostgresTablesResponse>(defaultPostgresTables)
  ),
  http.get(/\/admin\/redis\/dbsize$/, () => ok({ count: defaultKeys.length })),
  http.get(/\/admin\/redis\/keys$/, ({ request }) => {
    const url = new URL(request.url);
    const cursor = url.searchParams.get('cursor') ?? '0';
    const limit = Number(url.searchParams.get('limit') ?? '10');
    const start = Number(cursor) || 0;
    const end = start + limit;
    const pageKeys = defaultKeys.slice(start, end);
    const nextCursor = end < defaultKeys.length ? String(end) : '0';

    return ok<RedisKeysResponse>({
      keys: pageKeys,
      cursor: nextCursor,
      hasMore: nextCursor !== '0'
    });
  }),
  http.get(/\/admin\/redis\/keys\/.+$/, ({ request }) => {
    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    return ok(defaultKeyValue(key));
  }),
  http.delete(/\/admin\/redis\/keys\/.+$/, () => ok({ deleted: true })),
  http.post(/\/chat\/completions$/, async ({ request }) => {
    const body = await request.json().catch(() => null);
    const messages = isRecord(body) ? body['messages'] : null;
    const model = isRecord(body) ? body['model'] : undefined;
    const messageResult = validateChatMessages(messages);
    if (!messageResult.ok) {
      return HttpResponse.json({ error: messageResult.error }, { status: 400 });
    }

    if (model !== undefined) {
      if (typeof model !== 'string' || !isOpenRouterModelId(model)) {
        return HttpResponse.json(
          { error: 'model must be a supported OpenRouter chat model' },
          { status: 400 }
        );
      }
    }

    return ok({
      id: 'chatcmpl-test',
      model: DEFAULT_OPENROUTER_MODEL_ID,
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Mock reply'
          }
        }
      ]
    });
  })
];
