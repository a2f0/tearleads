/**
 * Shared types and utilities
 */

// Types
export interface PingData {
  version: string;
}

// Utilities
export function formatDate(date: Date): string {
  return date.toISOString();
}
