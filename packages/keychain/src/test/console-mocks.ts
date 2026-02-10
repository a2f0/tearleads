import { vi } from 'vitest';

export function mockConsoleError() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}
