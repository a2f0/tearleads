import type {
  PingData,
  RedisKeysResponse,
  RedisKeyValueResponse
} from '@rapid/shared';
import { logApiEvent } from '@/db/analytics';

export const API_BASE_URL: string | undefined = import.meta.env.VITE_API_URL;

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  if (!API_BASE_URL) {
    throw new Error('VITE_API_URL environment variable is not set');
  }

  const startTime = performance.now();
  const method = options?.method ?? 'GET';
  const eventName = `api_${method.toLowerCase()}_${endpoint.replace(/^\//, '').replace(/\//g, '_')}`;
  let success = false;

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, options);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    success = true;
    return data;
  } finally {
    const durationMs = performance.now() - startTime;
    void logApiEvent(eventName, durationMs, success);
  }
}

export const api = {
  ping: {
    get: () => request<PingData>('/ping')
  },
  admin: {
    redis: {
      getKeys: (cursor?: string, limit?: number) => {
        const params = new URLSearchParams();
        if (cursor) params.set('cursor', cursor);
        if (limit) params.set('limit', String(limit));
        const query = params.toString();
        return request<RedisKeysResponse>(
          `/admin/redis/keys${query ? `?${query}` : ''}`
        );
      },
      getValue: (key: string) =>
        request<RedisKeyValueResponse>(
          `/admin/redis/keys/${encodeURIComponent(key)}`
        ),
      deleteKey: (key: string) =>
        request<{ deleted: boolean }>(
          `/admin/redis/keys/${encodeURIComponent(key)}`,
          { method: 'DELETE' }
        ),
      getDbSize: () => request<{ count: number }>('/admin/redis/dbsize')
    }
  }
};
