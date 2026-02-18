import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import failOnConsole from 'vitest-fail-on-console';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        sync: 'Sync',
        login: 'Sign In',
        signIn: 'Sign in',
        createOne: 'Create one',
        createAccount: 'Create Account',
        loggedInAs: 'Logged in as',
        tokenExpires: 'Token expires',
        expiresIn: 'in {{time}}',
        expired: 'Expired',
        emailAddress: 'Email address',
        logout: 'Logout',
        file: 'File',
        view: 'View',
        close: 'Close'
      };
      let translated = translations[key] ?? key;
      if (options?.time !== undefined) {
        translated = translated.replace('{{time}}', String(options.time));
      }
      return translated;
    }
  })
}));

failOnConsole();

afterEach(() => {
  cleanup();
});
