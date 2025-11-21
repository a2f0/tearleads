/**
 * Shared types and utilities
 */

// Types
export interface HealthData {
  timestamp: string;
  uptime: number;
}

// Utilities
export function formatDate(date: Date): string {
  return date.toISOString();
}
