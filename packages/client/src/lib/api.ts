import type { HealthData } from '@rapid/shared';

const BASE_URL = import.meta.env.VITE_API_URL;

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  if (!BASE_URL) {
    throw new Error('VITE_API_URL environment variable is not set');
  }
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
