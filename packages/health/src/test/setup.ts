import '@testing-library/jest-dom/vitest';
import failOnConsole from 'vitest-fail-on-console';
import { vi } from 'vitest';

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => {}
  },
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      if (key === 'exerciseName') return 'Exercise Name';
      if (key === 'category') return 'Category (Optional)';
      if (key === 'addExercise') return 'Add Exercise';
      if (key === 'noExercisesFound') return 'No exercises found';
      if (key === 'variation') {
        const count = options?.count ?? 0;
        return `${count} variation${count === 1 ? '' : 's'}`;
      }
      return key;
    }
  })
}));

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  writable: true
});

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
});

failOnConsole();
