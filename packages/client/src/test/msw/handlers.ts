import type {
  AdminUsersResponse,
  AdminUserUpdateResponse,
  PingData,
  PostgresAdminInfoResponse,
  PostgresTablesResponse,
  RedisKeysResponse,
  RedisKeyValueResponse
} from '@tearleads/shared';
import {
  DEFAULT_OPENROUTER_MODEL_ID,
  isOpenRouterModelId,
  isRecord,
  validateChatMessages
} from '@tearleads/shared';
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
    database: 'tearleads',
    user: 'tearleads'
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

let adminUsers: AdminUsersResponse['users'] = [
  {
    id: 'user-1',
    email: 'admin@example.com',
    emailConfirmed: true,
    admin: true,
    disabled: false,
    disabledAt: null,
    disabledBy: null,
    markedForDeletionAt: null,
    markedForDeletionBy: null,
    organizationIds: ['org-1'],
    createdAt: '2024-01-01T12:00:00.000Z',
    lastActiveAt: '2024-01-10T18:30:00.000Z',
    accounting: {
      totalPromptTokens: 120,
      totalCompletionTokens: 80,
      totalTokens: 200,
      requestCount: 3,
      lastUsedAt: '2024-01-09T12:00:00.000Z'
    }
  },
  {
    id: 'user-2',
    email: 'user@example.com',
    emailConfirmed: false,
    admin: false,
    disabled: false,
    disabledAt: null,
    disabledBy: null,
    markedForDeletionAt: null,
    markedForDeletionBy: null,
    organizationIds: [],
    createdAt: '2024-02-14T08:15:00.000Z',
    lastActiveAt: null,
    accounting: {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      requestCount: 0,
      lastUsedAt: null
    }
  }
];

export const handlers = [
  http.get(/\/ping$/, () => ok<PingData>({ version: 'test', dbVersion: '0' })),
  http.get(/\/admin\/postgres\/info$/, () =>
    ok<PostgresAdminInfoResponse>(defaultPostgresInfo)
  ),
  http.get(/\/admin\/postgres\/tables$/, () =>
    ok<PostgresTablesResponse>(defaultPostgresTables)
  ),
  http.get(/\/admin\/redis\/dbsize$/, () => ok({ count: defaultKeys.length })),
  http.get(/\/admin\/users$/, () =>
    ok<AdminUsersResponse>({ users: adminUsers })
  ),
  http.patch(/\/admin\/users\/.+$/, async ({ request }) => {
    const url = new URL(request.url);
    const id = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    const body = await request.json().catch(() => null);
    const existingUser = adminUsers.find((user) => user.id === id);
    if (!existingUser) {
      return HttpResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const email =
      isRecord(body) && typeof body['email'] === 'string'
        ? body['email']
        : existingUser.email;
    const emailConfirmed =
      isRecord(body) && typeof body['emailConfirmed'] === 'boolean'
        ? body['emailConfirmed']
        : existingUser.emailConfirmed;
    const admin =
      isRecord(body) && typeof body['admin'] === 'boolean'
        ? body['admin']
        : existingUser.admin;
    const updatedUser = {
      ...existingUser,
      email,
      emailConfirmed,
      admin
    };
    adminUsers = adminUsers.map((user) =>
      user.id === id ? updatedUser : user
    );
    return ok<AdminUserUpdateResponse>({ user: updatedUser });
  }),
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
