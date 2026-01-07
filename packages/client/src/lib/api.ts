import type { PingData } from '@rapid/shared';
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

    success = true;
    return response.json();
  } finally {
    const durationMs = performance.now() - startTime;
    logApiEvent(eventName, durationMs, success);
  }
}

export const api = {
  ping: {
    get: () => request<PingData>('/ping')
  }
};
