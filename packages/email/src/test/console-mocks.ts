import { vi } from 'vitest';

export const mockConsoleError = () =>
  vi.spyOn(console, 'error').mockImplementation(() => {});

export const mockConsoleWarn = () =>
  vi.spyOn(console, 'warn').mockImplementation(() => {});
