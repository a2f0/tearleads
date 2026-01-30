import { vi } from 'vitest';

/**
 * Mock console.error to prevent test failures from expected error logging.
 * Returns a spy that can be used to assert error calls.
 */
export function mockConsoleError() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

/**
 * Mock console.warn to prevent test failures from expected warning logging.
 * Returns a spy that can be used to assert warning calls.
 */
export function mockConsoleWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}
