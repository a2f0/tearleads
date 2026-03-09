import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import failOnConsole from 'vitest-fail-on-console';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        viewDetails: 'View Details'
      };
      return translations[key] ?? key;
    }
  })
}));

failOnConsole();

afterEach(() => {
  cleanup();
});
