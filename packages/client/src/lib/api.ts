import type { HealthData } from '@rapid/shared';

const BASE_URL = '/api';

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${endpoint}`, options);

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}

export const api = {
  health: {
    get: () => request<HealthData>('/health')
  }
};
