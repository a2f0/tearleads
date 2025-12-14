import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

// Mock import.meta.env
vi.stubGlobal('import.meta', {
  env: {
    MODE: 'test'
  }
});
