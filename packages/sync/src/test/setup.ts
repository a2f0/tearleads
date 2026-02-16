import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import failOnConsole from 'vitest-fail-on-console';

// Initialize i18n for tests (side-effect import)
import '@client/i18n';

failOnConsole();

afterEach(() => {
  cleanup();
});
