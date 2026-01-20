import { ThemeProvider } from '@rapid/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navItems } from '@/components/Sidebar';
import { i18n } from '@/i18n';
import { Home, PATH_TO_WINDOW_TYPE } from './Home';

const mockOpenWindow = vi.fn();
const mockNavigate = vi.fn();

vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowManager: () => ({
    openWindow: mockOpenWindow
  })
}));

vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>(
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
    const mappedPaths = Object.keys(PATH_TO_WINDOW_TYPE).sort();

    expect(launcherPaths).toEqual(mappedPaths);
  });

  for (const item of desktopLaunchers) {
    const label = i18n.t(`menu:${item.labelKey}`);
    const windowType = PATH_TO_WINDOW_TYPE[item.path];

    it(`opens ${label} in a window on double click`, async () => {
      const user = userEvent.setup();
      renderHome();

      const iconButton = screen.getByRole('button', { name: label });
      await user.dblClick(iconButton);

      if (!windowType) {
        throw new Error(`Missing window type for ${item.path}`);
      }
      expect(mockOpenWindow).toHaveBeenCalledWith(windowType);
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  }
});
