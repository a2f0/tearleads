import type {
  PingData,
  RedisKeysResponse,
  RedisKeyValueResponse
} from '@rapid/shared';
import {
  DEFAULT_OPENROUTER_MODEL_ID,
  isOpenRouterModelId,
  isRecord
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

const isChatContentPart = (value: unknown): boolean => {
  if (!isRecord(value)) {
    return false;
  }
  const type = value['type'];
  if (type === 'text') {
    const text = value['text'];
    return typeof text === 'string' && text.trim().length > 0;
  }
  if (type === 'image_url') {
    const imageUrl = value['image_url'];
    if (!isRecord(imageUrl)) {
      return false;
    }
    const url = imageUrl['url'];
    return typeof url === 'string' && url.trim().length > 0;
  }
  return false;
};

const hasValidContent = (value: unknown): boolean => {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  if (Array.isArray(value) && value.length > 0) {
    return value.every((entry) => isChatContentPart(entry));
  }
  return false;
};

export const handlers = [
  http.get(/\/ping$/, () => ok<PingData>({ version: 'test', dbVersion: '0' })),
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
    if (!Array.isArray(messages) || messages.length === 0) {
      return HttpResponse.json(
        { error: 'messages must be a non-empty array of { role, content }' },
        { status: 400 }
      );
    }

    const hasValidMessages = messages.every((message) => {
      if (!isRecord(message)) {
        return false;
      }
      const role = message['role'];
      if (
        role !== 'system' &&
        role !== 'user' &&
        role !== 'assistant' &&
        role !== 'tool'
      ) {
        return false;
      }
      return hasValidContent(message['content']);
    });

    if (!hasValidMessages) {
      return HttpResponse.json(
        { error: 'messages must be a non-empty array of { role, content }' },
        { status: 400 }
      );
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
