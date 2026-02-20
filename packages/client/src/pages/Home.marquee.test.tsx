/**
 * Home page marquee selection tests.
 */

import { ThemeProvider } from '@tearleads/ui';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

function setupCanvasMocks(canvas: Element) {
  Object.defineProperty(canvas, 'offsetWidth', {
    value: 800,
    configurable: true
  });
  Object.defineProperty(canvas, 'offsetHeight', {
    value: 600,
    configurable: true
  });
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    x: 0,
    y: 0,
    toJSON: () => ({})
  });
}

describe('Home marquee selection', () => {
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

  it('draws a selection box when dragging on empty canvas', () => {
    const { container } = renderHome();
    const canvas = container.querySelector('[role="application"]');

    if (canvas) {
      setupCanvasMocks(canvas);

      fireEvent.pointerDown(canvas, {
        button: 0,
        clientX: 50,
        clientY: 50,
        pointerId: 1
      });

      fireEvent.pointerMove(canvas, {
        clientX: 200,
        clientY: 200,
        pointerId: 1
      });

      const selectionBox = container.querySelector('.border-primary');
      expect(selectionBox).toBeInTheDocument();
    }
  });

  it('selects icons that intersect with the selection box', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_SAVED_POSITIONS));
    const { container } = renderHome();
    const canvas = container.querySelector('[role="application"]');

    if (canvas) {
      setupCanvasMocks(canvas);

      fireEvent.pointerDown(canvas, {
        button: 0,
        clientX: 50,
        clientY: 50,
        pointerId: 1
      });

      fireEvent.pointerMove(canvas, {
        clientX: 500,
        clientY: 500,
        pointerId: 1
      });

      fireEvent.pointerUp(canvas, { pointerId: 1 });

      const selectionBox = container.querySelector('.border-primary');
      expect(selectionBox).not.toBeInTheDocument();

      const selectedIcons = container.querySelectorAll('.ring-primary');
      expect(selectedIcons.length).toBeGreaterThan(0);
    }
  });

  it('clears selection when clicking on empty canvas without dragging', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_SAVED_POSITIONS));
    const { container } = renderHome();
    const canvas = container.querySelector('[role="application"]');

    if (canvas) {
      setupCanvasMocks(canvas);

      fireEvent.pointerDown(canvas, {
        button: 0,
        clientX: 50,
        clientY: 50,
        pointerId: 1
      });

      fireEvent.pointerMove(canvas, {
        clientX: 500,
        clientY: 500,
        pointerId: 1
      });

      fireEvent.pointerUp(canvas, { pointerId: 1 });

      let selectedIcons = container.querySelectorAll('.ring-primary');
      expect(selectedIcons.length).toBeGreaterThan(0);

      fireEvent.pointerDown(canvas, {
        button: 0,
        clientX: 10,
        clientY: 10,
        pointerId: 1
      });

      fireEvent.pointerMove(canvas, {
        clientX: 12,
        clientY: 12,
        pointerId: 1
      });

      fireEvent.pointerUp(canvas, { pointerId: 1 });

      selectedIcons = container.querySelectorAll('.ring-primary');
      expect(selectedIcons.length).toBe(0);
    }
  });

  it('clears selection when starting to drag an icon', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_SAVED_POSITIONS));
    const { container } = renderHome();
    const canvas = container.querySelector('[role="application"]');

    if (canvas) {
      setupCanvasMocks(canvas);

      fireEvent.pointerDown(canvas, {
        button: 0,
        clientX: 50,
        clientY: 50,
        pointerId: 1
      });

      fireEvent.pointerMove(canvas, {
        clientX: 500,
        clientY: 500,
        pointerId: 1
      });

      fireEvent.pointerUp(canvas, { pointerId: 1 });

      let selectedIcons = container.querySelectorAll('.ring-primary');
      expect(selectedIcons.length).toBeGreaterThan(0);

      const filesButton = screen.getByRole('button', { name: 'Files' });
      fireEvent.pointerDown(filesButton, {
        button: 0,
        clientX: 300,
        clientY: 300,
        pointerId: 1
      });

      selectedIcons = container.querySelectorAll('.ring-primary');
      expect(selectedIcons.length).toBe(0);
    }
  });

  it('shows selection-specific context menu options when icons are selected', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_SAVED_POSITIONS));
    const { container } = renderHome();
    const canvas = container.querySelector('[role="application"]');

    if (canvas) {
      setupCanvasMocks(canvas);

      fireEvent.pointerDown(canvas, {
        button: 0,
        clientX: 50,
        clientY: 50,
        pointerId: 1
      });

      fireEvent.pointerMove(canvas, {
        clientX: 500,
        clientY: 500,
        pointerId: 1
      });

      fireEvent.pointerUp(canvas, { pointerId: 1 });

      await user.pointer({ keys: '[MouseRight]', target: canvas });

      expect(screen.getByText('Auto Arrange Selected')).toBeInTheDocument();
      expect(screen.getByText('Scatter Selected')).toBeInTheDocument();
      expect(screen.getByText('Cluster Selected')).toBeInTheDocument();
    }
  });

  it('clears selection after applying an arrangement operation', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_SAVED_POSITIONS));
    const { container } = renderHome();
    const canvas = container.querySelector('[role="application"]');

    if (canvas) {
      setupCanvasMocks(canvas);

      fireEvent.pointerDown(canvas, {
        button: 0,
        clientX: 50,
        clientY: 50,
        pointerId: 1
      });

      fireEvent.pointerMove(canvas, {
        clientX: 500,
        clientY: 500,
        pointerId: 1
      });

      fireEvent.pointerUp(canvas, { pointerId: 1 });

      let selectedIcons = container.querySelectorAll('.ring-primary');
      expect(selectedIcons.length).toBeGreaterThan(0);

      await user.pointer({ keys: '[MouseRight]', target: canvas });
      await user.click(screen.getByText('Scatter Selected'));

      selectedIcons = container.querySelectorAll('.ring-primary');
      expect(selectedIcons.length).toBe(0);
    }
  });

  it('does not start selection when clicking on an icon', () => {
    const { container } = renderHome();
    const filesButton = screen.getByRole('button', { name: 'Files' });

    fireEvent.pointerDown(filesButton, {
      button: 0,
      clientX: 100,
      clientY: 100,
      pointerId: 1
    });

    const selectionBox = container.querySelector('.border-primary');
    expect(selectionBox).not.toBeInTheDocument();
  });

  it('does not start selection on right-click', () => {
    const { container } = renderHome();
    const canvas = container.querySelector('[role="application"]');

    if (canvas) {
      fireEvent.pointerDown(canvas, {
        button: 2,
        clientX: 50,
        clientY: 50,
        pointerId: 1
      });

      const selectionBox = container.querySelector('.border-primary');
      expect(selectionBox).not.toBeInTheDocument();
    }
  });

  it('preserves positions of non-selected icons when arranging selected', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_SAVED_POSITIONS));
    const { container } = renderHome();
    const canvas = container.querySelector('[role="application"]');

    if (canvas) {
      setupCanvasMocks(canvas);

      const settingsButton = screen.getByRole('button', { name: 'Settings' });
      const initialSettingsStyle = settingsButton.getAttribute('style');

      fireEvent.pointerDown(canvas, {
        button: 0,
        clientX: 50,
        clientY: 50,
        pointerId: 1
      });

      fireEvent.pointerMove(canvas, {
        clientX: 500,
        clientY: 350,
        pointerId: 1
      });

      fireEvent.pointerUp(canvas, { pointerId: 1 });

      expect(settingsButton.querySelector('.ring-primary')).toBeNull();

      await user.pointer({ keys: '[MouseRight]', target: canvas });
      await user.click(screen.getByText('Scatter Selected'));

      const newSettingsStyle = settingsButton.getAttribute('style');
      expect(newSettingsStyle).toContain('left: 300px');
      expect(newSettingsStyle).toContain('top: 600px');
      expect(newSettingsStyle).toBe(initialSettingsStyle);
    }
  });

  it('does not start selection on mobile', () => {
    Object.defineProperty(window, 'innerWidth', {
      value: 500,
      configurable: true
    });

    const { container } = renderHome();

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    const canvas = container.querySelector('[role="application"]');

    if (canvas) {
      fireEvent.pointerDown(canvas, {
        button: 0,
        clientX: 50,
        clientY: 50,
        pointerId: 1
      });

      fireEvent.pointerMove(canvas, {
        clientX: 200,
        clientY: 200,
        pointerId: 1
      });

      const selectionBox = container.querySelector('.border-primary');
      expect(selectionBox).not.toBeInTheDocument();
    }

    Object.defineProperty(window, 'innerWidth', {
      value: 1024,
      configurable: true
    });
  });
});
