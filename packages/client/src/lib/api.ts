import type { HealthData } from '@rapid/shared';
import invariant from 'invariant';

const BASE_URL = import.meta.env.VITE_API_URL;
invariant(BASE_URL, 'VITE_API_URL environment variable is not set');

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
