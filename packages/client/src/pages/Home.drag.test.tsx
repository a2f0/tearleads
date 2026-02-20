/**
 * Home page drag and drop and position persistence tests.
 */

import { ThemeProvider } from '@tearleads/ui';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowManagerProvider } from '@/contexts/WindowManagerContext';
import { setupScreensaverMock } from '@/test/screensaverMock';
import { Home } from './Home';
import { MOCK_SAVED_POSITIONS, STORAGE_KEY } from './Home.testUtils';

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

describe('Home drag and drop', () => {
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

  it('handles pointer down on icon', () => {
    renderHome();

    const filesButton = screen.getByRole('button', { name: 'Files' });

    fireEvent.pointerDown(filesButton, {
      button: 0,
      clientX: 100,
      clientY: 100,
      pointerId: 1
    });

    expect(filesButton).toBeInTheDocument();
  });

  it('handles pointer move during drag', () => {
    const { container } = renderHome();

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

    expect(filesButton).toBeInTheDocument();
  });

  it('ignores right-click for drag', () => {
    renderHome();

    const filesButton = screen.getByRole('button', { name: 'Files' });

    fireEvent.pointerDown(filesButton, {
      button: 2,
      clientX: 100,
      clientY: 100,
      pointerId: 1
    });

    expect(filesButton).toBeInTheDocument();
  });

  it('saves icon positions to localStorage after drag', () => {
    const { container } = renderHome();

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
    expect(saved).not.toBeNull();
    if (saved) {
      expect(JSON.parse(saved)).toHaveProperty('/files');
    }
  });

  it('loads saved positions from localStorage on mount', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_SAVED_POSITIONS));

    renderHome();

    const filesButton = screen.getByRole('button', { name: 'Files' });
    expect(filesButton).toHaveStyle({ left: '300px', top: '300px' });
  });

  it('uses grid positions when localStorage has invalid JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'invalid-json');

    renderHome();

    expect(screen.getByRole('button', { name: 'Files' })).toBeInTheDocument();
  });

  it('uses grid positions when localStorage is missing items', () => {
    const partialPositions = {
      '/files': { x: 300, y: 300 }
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(partialPositions));

    renderHome();

    const filesButton = screen.getByRole('button', { name: 'Files' });
    expect(filesButton).not.toHaveStyle({ left: '300px', top: '300px' });
  });

  it('constrains positions on window resize', () => {
    const mockContainer = {
      offsetWidth: 400,
      offsetHeight: 300
    };

    const outOfBoundsPositions = {
      ...MOCK_SAVED_POSITIONS,
      '/files': { x: 1000, y: 800 }
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(outOfBoundsPositions));

    const { container } = renderHome();
    const canvas = container.querySelector('[role="application"]');

    if (canvas) {
      Object.defineProperty(canvas, 'offsetWidth', {
        value: mockContainer.offsetWidth,
        configurable: true
      });
      Object.defineProperty(canvas, 'offsetHeight', {
        value: mockContainer.offsetHeight,
        configurable: true
      });
    }

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    const filesButton = screen.getByRole('button', { name: 'Files' });
    expect(filesButton).toBeInTheDocument();
    const left = parseFloat(filesButton.style.left);
    const top = parseFloat(filesButton.style.top);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left).toBeLessThanOrEqual(336); // max x = 400 - 64
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThanOrEqual(212); // max y = 300 - 88
  });

  it('uses saved positions as-is when container has no dimensions', () => {
    const savedPositions = {
      ...MOCK_SAVED_POSITIONS,
      '/files': { x: 1000, y: 1000 }
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedPositions));

    const { container } = renderHome();
    const canvas = container.querySelector('[role="application"]');

    expect(canvas).toBeInTheDocument();
    const filesButton = screen.getByRole('button', { name: 'Files' });
    expect(filesButton).toHaveStyle({ left: '1000px', top: '1000px' });
  });

  it('updates mobile state on resize', () => {
    renderHome();

    Object.defineProperty(window, 'innerWidth', {
      value: 500,
      configurable: true
    });

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(screen.getByRole('button', { name: 'Files' })).toBeInTheDocument();

    Object.defineProperty(window, 'innerWidth', {
      value: 1024,
      configurable: true
    });
  });
});
