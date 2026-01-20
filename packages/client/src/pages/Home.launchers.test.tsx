import { ThemeProvider } from '@rapid/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navItems } from '@/components/Sidebar';
import type { WindowType } from '@/contexts/WindowManagerContext';
import { i18n } from '@/i18n';
import { Home } from './Home';

const mockOpenWindow = vi.fn();
const mockNavigate = vi.fn();

vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowManager: () => ({
    openWindow: mockOpenWindow
  })
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom'
  );
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

vi.mock('@/db/SettingsProvider', () => ({
  useSettings: () => ({
    getSetting: (key: string) =>
      key === 'desktopPattern' ? 'solid' : 'embossed',
    setSetting: vi.fn()
  })
}));

const WINDOW_LAUNCHERS: Record<string, WindowType> = {
  '/notes': 'notes',
  '/console': 'console',
  '/settings': 'settings',
  '/files': 'files',
  '/documents': 'documents',
  '/debug': 'debug',
  '/email': 'email',
  '/contacts': 'contacts',
  '/photos': 'photos',
  '/videos': 'videos',
  '/keychain': 'keychain',
  '/sqlite': 'sqlite',
  '/opfs': 'opfs',
  '/chat': 'chat',
  '/analytics': 'analytics',
  '/audio': 'audio',
  '/models': 'models',
  '/admin/redis': 'admin',
  '/cache-storage': 'cache-storage',
  '/local-storage': 'local-storage'
};

const desktopLaunchers = navItems.filter(
  (item) => item.path !== '/' && item.path !== '/sqlite/tables'
);

describe('Home desktop launchers', () => {
  const renderHome = () =>
    render(
      <ThemeProvider>
        <MemoryRouter>
          <Home />
        </MemoryRouter>
      </ThemeProvider>
    );

  beforeEach(() => {
    mockOpenWindow.mockReset();
    mockNavigate.mockReset();
    localStorage.clear();
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  it('covers every desktop launcher path', () => {
    const launcherPaths = desktopLaunchers.map((item) => item.path).sort();
    const mappedPaths = Object.keys(WINDOW_LAUNCHERS).sort();

    expect(launcherPaths).toEqual(mappedPaths);
  });

  for (const item of desktopLaunchers) {
    const label = i18n.t(`menu:${item.labelKey}`);
    const windowType = WINDOW_LAUNCHERS[item.path];

    it(`opens ${label} in a window on double click`, async () => {
      const user = userEvent.setup();
      renderHome();

      const iconButton = screen.getByRole('button', { name: label });
      await user.dblClick(iconButton);

      expect(mockOpenWindow).toHaveBeenCalledWith(windowType);
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  }
});
