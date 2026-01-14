import type {
  PingData,
  RedisKeysResponse,
  RedisKeyValueResponse
} from '@rapid/shared';
import { HttpResponse, http } from 'msw';

const ok = <T extends object>(body: T) => HttpResponse.json(body);

const emptyKeysResponse: RedisKeysResponse = {
  keys: [],
  cursor: '0',
  hasMore: false
};

const defaultKeyValue = (key: string): RedisKeyValueResponse => ({
  key,
  type: 'string',
  ttl: -1,
  value: ''
});

export const handlers = [
  http.get(/\/ping$/, () => ok<PingData>({ version: 'test' })),
  http.get(/\/admin\/redis\/dbsize$/, () => ok({ count: 0 })),
  http.get(/\/admin\/redis\/keys$/, () => ok(emptyKeysResponse)),
  http.get(/\/admin\/redis\/keys\/.+$/, ({ request }) => {
    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    return ok(defaultKeyValue(key));
  }),
  http.delete(/\/admin\/redis\/keys\/.+$/, () => ok({ deleted: true }))
];
