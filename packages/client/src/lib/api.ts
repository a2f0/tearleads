import type {
  AuthResponse,
  PingData,
  PostgresAdminInfoResponse,
  PostgresTablesResponse,
  RedisKeysResponse,
  RedisKeyValueResponse
} from '@rapid/shared';
import type { AnalyticsEventSlug } from '@/db/analytics';
import { logApiEvent } from '@/db/analytics';

export const API_BASE_URL: string | undefined = import.meta.env.VITE_API_URL;

// API event slugs - subset of AnalyticsEventSlug for API calls
type ApiEventSlug = Extract<AnalyticsEventSlug, `api_${string}`>;

interface RequestParams {
  fetchOptions?: RequestInit;
  eventName: ApiEventSlug;
}

async function request<T>(endpoint: string, params: RequestParams): Promise<T> {
  if (!API_BASE_URL) {
    throw new Error('VITE_API_URL environment variable is not set');
  }

  const { fetchOptions, eventName } = params;
  const startTime = performance.now();
  let success = false;

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, fetchOptions);

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
  auth: {
    login: (email: string, password: string) =>
      request<AuthResponse>('/auth/login', {
        fetchOptions: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        },
        eventName: 'api_post_auth_login'
      })
  },
  ping: {
    get: () => request<PingData>('/ping', { eventName: 'api_get_ping' })
  },
  admin: {
    postgres: {
      getInfo: () =>
        request<PostgresAdminInfoResponse>('/admin/postgres/info', {
          eventName: 'api_get_admin_postgres_info'
        }),
      getTables: () =>
        request<PostgresTablesResponse>('/admin/postgres/tables', {
          eventName: 'api_get_admin_postgres_tables'
        })
    },
    redis: {
      getKeys: (cursor?: string, limit?: number) => {
        const params = new URLSearchParams();
        if (cursor) params.set('cursor', cursor);
        if (limit) params.set('limit', String(limit));
        const query = params.toString();
        return request<RedisKeysResponse>(
          `/admin/redis/keys${query ? `?${query}` : ''}`,
          { eventName: 'api_get_admin_redis_keys' }
        );
      },
      getValue: (key: string) =>
        request<RedisKeyValueResponse>(
          `/admin/redis/keys/${encodeURIComponent(key)}`,
          { eventName: 'api_get_admin_redis_key' }
        ),
      deleteKey: (key: string) =>
        request<{ deleted: boolean }>(
          `/admin/redis/keys/${encodeURIComponent(key)}`,
          {
            fetchOptions: { method: 'DELETE' },
            eventName: 'api_delete_admin_redis_key'
          }
        ),
      getDbSize: () =>
        request<{ count: number }>('/admin/redis/dbsize', {
          eventName: 'api_get_admin_redis_dbsize'
        })
    }
  }
};
