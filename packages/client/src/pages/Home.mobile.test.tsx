/**
 * Home page mobile behavior tests.
 */

import { ThemeProvider } from '@tearleads/ui';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowManagerProvider } from '@/contexts/WindowManagerContext';
import { setupScreensaverMock } from '@/test/screensaverMock';
import { Home } from './Home';
import { STORAGE_KEY } from './Home.testUtils';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

const mockGetSetting = vi.fn();

vi.mock('@tearleads/settings', () => ({
  useSettings: () => ({
    getSetting: mockGetSetting,
    setSetting: vi.fn()
  })
}));

setupScreensaverMock();

function renderHome() {
  return render(
    <ThemeProvider>
      <WindowManagerProvider>
        <MemoryRouter>
          <Home />
        </MemoryRouter>
      </WindowManagerProvider>
    </ThemeProvider>
  );
}

describe('Home mobile behavior', () => {
  const renderMobileHome = () => {
    Object.defineProperty(window, 'innerWidth', {
      value: 500,
      configurable: true
    });
    const result = renderHome();
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    return result;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetSetting.mockImplementation((key: string) => {
      switch (key) {
        case 'desktopPattern':
          return 'solid';
        case 'desktopIconDepth':
          return 'debossed';
        case 'desktopIconBackground':
          return 'colored';
        default:
          return 'enabled';
      }
    });
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      value: 1024,
      configurable: true
    });
  });

  it('navigates on single click in mobile mode', async () => {
    const user = userEvent.setup();
    renderMobileHome();

    const filesButton = screen.getByRole('button', { name: 'Files' });
    await user.click(filesButton);

    expect(mockNavigate).toHaveBeenCalledWith('/files');
  });

  it('does not start drag on pointer down in mobile mode', () => {
    const { container } = renderMobileHome();

    const filesButton = screen.getByRole('button', { name: 'Files' });
    const canvas = container.querySelector('[role="application"]');

    fireEvent.pointerDown(filesButton, {
      button: 0,
      clientX: 100,
      clientY: 100,
      pointerId: 1
    });

    if (canvas) {
      fireEvent.pointerMove(canvas, {
        clientX: 200,
        clientY: 200,
        pointerId: 1
      });

      fireEvent.pointerUp(canvas, { pointerId: 1 });
    }

    const saved = localStorage.getItem(STORAGE_KEY);
    expect(saved).toBeNull();
  });

  it('uses pointer cursor on mobile instead of grab cursor', () => {
    renderMobileHome();

    const filesButton = screen.getByRole('button', { name: 'Files' });
    expect(filesButton).toHaveStyle({ cursor: 'pointer' });
  });

  it('allows default touch behavior on mobile', () => {
    const { container } = renderMobileHome();

    const canvas = container.querySelector<HTMLElement>('[role="application"]');
    expect(canvas).toBeInTheDocument();
    expect(canvas?.style.touchAction).toBe('auto');
  });

  it('uses grid layout and scrollable container on mobile', () => {
    const { container } = renderMobileHome();

    const canvas = container.querySelector<HTMLElement>('[role="application"]');
    expect(canvas).toBeInTheDocument();
    expect(canvas).toHaveClass('overflow-y-auto');

    const grid = screen.getByTestId('home-grid');
    expect(grid).toHaveClass('grid');

    const filesButton = screen.getByRole('button', { name: 'Files' });
    expect(filesButton.className).not.toContain('absolute');
  });
});
