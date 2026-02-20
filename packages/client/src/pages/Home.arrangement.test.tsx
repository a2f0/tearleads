/**
 * Home page icon arrangement tests (scatter, cluster, auto arrange).
 */

import { ThemeProvider } from '@tearleads/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navItems } from '@/components/Sidebar';
import { WindowManagerProvider } from '@/contexts/WindowManagerContext';
import { setupScreensaverMock } from '@/test/screensaverMock';
import { Home } from './Home';
import { STORAGE_KEY } from './Home.testUtils';
import { GAP, ICON_SIZE, ITEM_HEIGHT } from './homeIconUtils';

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

function setupCanvasMocks(
  canvas: Element,
  width: number = 800,
  height: number = 600
) {
  Object.defineProperty(canvas, 'offsetWidth', {
    value: width,
    configurable: true
  });
  Object.defineProperty(canvas, 'offsetHeight', {
    value: height,
    configurable: true
  });
}

describe('Home icon arrangement', () => {
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

  it('auto arrange resets icon positions', async () => {
    const user = userEvent.setup();
    const { container } = renderHome();

    const canvas = container.querySelector('[role="application"]');
    expect(canvas).toBeInTheDocument();

    if (canvas) {
      await user.pointer({ keys: '[MouseRight]', target: canvas });
    }

    const autoArrangeItem = screen.getByText('Auto Arrange');
    await user.click(autoArrangeItem);

    expect(screen.queryByText('Auto Arrange')).not.toBeInTheDocument();
  });

  it('auto arrange orders desktop icons alphabetically', async () => {
    const user = userEvent.setup();
    const { container } = renderHome();

    const canvas = container.querySelector('[role="application"]');
    expect(canvas).toBeInTheDocument();

    if (canvas) {
      setupCanvasMocks(canvas);
      await user.pointer({ keys: '[MouseRight]', target: canvas });
    }

    await user.click(screen.getByText('Auto Arrange'));

    const iconButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button')
    ).filter((button) => button.style.left && button.style.top);

    const orderedLabels = iconButtons
      .map((button) => ({
        label: button.textContent?.trim() ?? '',
        left: Number.parseFloat(button.style.left),
        top: Number.parseFloat(button.style.top)
      }))
      .filter((item) => item.label.length > 0)
      .sort((a, b) => (a.top - b.top === 0 ? a.left - b.left : a.top - b.top))
      .map((item) => item.label);

    const expectedOrder = [...orderedLabels].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );

    expect(orderedLabels.length).toBeGreaterThan(0);
    expect(orderedLabels).toEqual(expectedOrder);
  });

  it('persists icon positions on auto arrange', async () => {
    const user = userEvent.setup();
    const { container } = renderHome();
    const canvas = container.querySelector('[role="application"]');

    if (canvas) {
      await user.pointer({ keys: '[MouseRight]', target: canvas });
    }

    const autoArrangeItem = screen.getByText('Auto Arrange');
    await user.click(autoArrangeItem);

    const storedPositions = localStorage.getItem(STORAGE_KEY);
    expect(storedPositions).not.toBeNull();
    expect(JSON.parse(storedPositions ?? '{}')).toMatchObject({
      '/files': expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number)
      })
    });
  });

  it('shows scatter option in canvas context menu and randomizes icon positions', async () => {
    const user = userEvent.setup();
    const { container } = renderHome();

    const canvas = container.querySelector('[role="application"]');

    if (canvas) {
      setupCanvasMocks(canvas);
    }

    const filesButton = screen.getByRole('button', { name: 'Files' });
    const initialStyle = filesButton.getAttribute('style');

    if (canvas) {
      await user.pointer({ keys: '[MouseRight]', target: canvas });
    }

    expect(screen.getByText('Scatter')).toBeInTheDocument();

    await user.click(screen.getByText('Scatter'));

    expect(screen.queryByText('Scatter')).not.toBeInTheDocument();

    const storedPositions = localStorage.getItem(STORAGE_KEY);
    expect(storedPositions).not.toBeNull();
    expect(JSON.parse(storedPositions ?? '{}')).toMatchObject({
      '/files': expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number)
      })
    });

    const newStyle = filesButton.getAttribute('style');
    expect(newStyle).not.toEqual(initialStyle);
  });

  it('shows cluster option in canvas context menu and arranges icons in centered square', async () => {
    const user = userEvent.setup();
    const { container } = renderHome();

    const canvas = container.querySelector('[role="application"]');
    const wideLabelWidth = 140;
    const baseLabelWidth = 80;
    const iconButtons = container.querySelectorAll('button[data-icon-path]');

    iconButtons.forEach((button) => {
      const path = button.getAttribute('data-icon-path');
      const width =
        path === '/admin/organizations' ? wideLabelWidth : baseLabelWidth;
      Object.defineProperty(button, 'offsetWidth', {
        value: width,
        configurable: true
      });
      Object.defineProperty(button, 'offsetHeight', {
        value: 88,
        configurable: true
      });
    });

    if (canvas) {
      setupCanvasMocks(canvas);
      await user.pointer({ keys: '[MouseRight]', target: canvas });
    }

    expect(screen.getByText('Cluster')).toBeInTheDocument();

    await user.click(screen.getByText('Cluster'));

    expect(screen.queryByText('Cluster')).not.toBeInTheDocument();

    const storedPositions = localStorage.getItem(STORAGE_KEY);
    expect(storedPositions).not.toBeNull();

    const itemsToArrange = navItems.filter((item) => item.path !== '/');
    const cols = Math.ceil(Math.sqrt(itemsToArrange.length));
    const rows = Math.ceil(itemsToArrange.length / cols);
    const maxItemWidth = Math.max(ICON_SIZE, wideLabelWidth);
    const itemWidth = maxItemWidth + GAP;
    const itemHeightWithGap = ITEM_HEIGHT + GAP;
    const clusterWidth = cols * itemWidth - GAP;
    const clusterHeight = rows * itemHeightWithGap - GAP;
    const expectedX = Math.max(0, (800 - clusterWidth) / 2);
    const expectedY = Math.max(0, (600 - clusterHeight) / 2);
    const horizontalOffset = Math.max(0, (maxItemWidth - baseLabelWidth) / 2);

    const parsedPositions: Record<string, { x: number; y: number }> =
      JSON.parse(storedPositions ?? '{}');
    const filesPosition = parsedPositions['/files'];
    expect(filesPosition).toBeDefined();
    expect(filesPosition?.x).toBeCloseTo(expectedX + horizontalOffset);
    expect(filesPosition?.y).toBeCloseTo(expectedY);

    const filesButton = screen.getByRole('button', { name: 'Files' });
    expect(parseFloat(filesButton.style.left)).toBeCloseTo(
      expectedX + horizontalOffset
    );
    expect(parseFloat(filesButton.style.top)).toBeCloseTo(expectedY);
  });

  it('clusters icons with horizontal spacing based on the widest label', async () => {
    const user = userEvent.setup();
    const { container } = renderHome();

    const canvas = container.querySelector('[role="application"]');
    const wideLabelWidth = 180;
    const baseLabelWidth = 72;
    const iconButtons = container.querySelectorAll('button[data-icon-path]');

    iconButtons.forEach((button) => {
      const path = button.getAttribute('data-icon-path');
      const width =
        path === '/admin/organizations' ? wideLabelWidth : baseLabelWidth;
      Object.defineProperty(button, 'offsetWidth', {
        value: width,
        configurable: true
      });
      Object.defineProperty(button, 'offsetHeight', {
        value: 88,
        configurable: true
      });
    });

    if (canvas) {
      setupCanvasMocks(canvas, 900, 700);
      await user.pointer({ keys: '[MouseRight]', target: canvas });
    }

    await user.click(screen.getByText('Cluster'));

    const storedPositions = localStorage.getItem(STORAGE_KEY);
    expect(storedPositions).not.toBeNull();

    const parsedPositions: Record<string, { x: number; y: number }> =
      JSON.parse(storedPositions ?? '{}');
    const filesPosition = parsedPositions['/files'];
    const searchPosition = parsedPositions['/search'];
    expect(filesPosition).toBeDefined();
    expect(searchPosition).toBeDefined();

    const expectedSpacing = Math.max(ICON_SIZE, wideLabelWidth) + GAP;
    expect(searchPosition?.x).toBeCloseTo(
      (filesPosition?.x ?? 0) + expectedSpacing
    );
    expect(searchPosition?.y).toBeCloseTo(filesPosition?.y ?? 0);
  });

  it('clusters icons using icon size when labels are unmeasured', async () => {
    const user = userEvent.setup();
    const { container } = renderHome();

    const canvas = container.querySelector('[role="application"]');
    if (canvas) {
      setupCanvasMocks(canvas);
      await user.pointer({ keys: '[MouseRight]', target: canvas });
    }

    await user.click(screen.getByText('Cluster'));

    const storedPositions = localStorage.getItem(STORAGE_KEY);
    expect(storedPositions).not.toBeNull();

    const itemsToArrange = navItems.filter(
      (item) => item.path !== '/' && item.path !== '/sqlite/tables'
    );
    const cols = Math.ceil(Math.sqrt(itemsToArrange.length));
    const rows = Math.ceil(itemsToArrange.length / cols);
    const itemWidth = ICON_SIZE + GAP;
    const itemHeightWithGap = ITEM_HEIGHT + GAP;
    const clusterWidth = cols * itemWidth - GAP;
    const clusterHeight = rows * itemHeightWithGap - GAP;
    const expectedX = Math.max(0, (800 - clusterWidth) / 2);
    const expectedY = Math.max(0, (600 - clusterHeight) / 2);

    const parsedPositions: Record<string, { x: number; y: number }> =
      JSON.parse(storedPositions ?? '{}');
    const filesPosition = parsedPositions['/files'];
    expect(filesPosition).toBeDefined();
    expect(filesPosition?.x).toBeCloseTo(expectedX);
    expect(filesPosition?.y).toBeCloseTo(expectedY);
  });

  it('centers icon blocks vertically within cluster rows', async () => {
    const user = userEvent.setup();
    const { container } = renderHome();

    const canvas = container.querySelector('[role="application"]');
    const tallLabelHeight = 120;
    const baseLabelHeight = 88;
    const iconButtons = container.querySelectorAll('button[data-icon-path]');

    iconButtons.forEach((button) => {
      const path = button.getAttribute('data-icon-path');
      const height =
        path === '/admin/organizations' ? tallLabelHeight : baseLabelHeight;
      Object.defineProperty(button, 'offsetWidth', {
        value: 90,
        configurable: true
      });
      Object.defineProperty(button, 'offsetHeight', {
        value: height,
        configurable: true
      });
    });

    if (canvas) {
      setupCanvasMocks(canvas, 900, 700);
      await user.pointer({ keys: '[MouseRight]', target: canvas });
    }

    await user.click(screen.getByText('Cluster'));

    const storedPositions = localStorage.getItem(STORAGE_KEY);
    expect(storedPositions).not.toBeNull();

    const parsedPositions: Record<string, { x: number; y: number }> =
      JSON.parse(storedPositions ?? '{}');
    const filesPosition = parsedPositions['/files'];
    expect(filesPosition).toBeDefined();

    const itemsToArrange = navItems.filter(
      (item) => item.path !== '/' && item.path !== '/sqlite/tables'
    );
    const cols = Math.ceil(Math.sqrt(itemsToArrange.length));
    const rows = Math.ceil(itemsToArrange.length / cols);
    const itemHeight = Math.max(ITEM_HEIGHT, tallLabelHeight);
    const itemHeightWithGap = itemHeight + GAP;
    const clusterHeight = rows * itemHeightWithGap - GAP;
    const expectedStartY = Math.max(0, (700 - clusterHeight) / 2);
    const expectedOffset = Math.max(0, (itemHeight - baseLabelHeight) / 2);

    expect(filesPosition?.y).toBeCloseTo(expectedStartY + expectedOffset);
  });

  it('centers icon blocks horizontally within cluster columns', async () => {
    const user = userEvent.setup();
    const { container } = renderHome();

    const canvas = container.querySelector('[role="application"]');
    const wideLabelWidth = 200;
    const baseLabelWidth = 72;
    const iconButtons = container.querySelectorAll('button[data-icon-path]');

    iconButtons.forEach((button) => {
      const path = button.getAttribute('data-icon-path');
      const width =
        path === '/admin/organizations' ? wideLabelWidth : baseLabelWidth;
      Object.defineProperty(button, 'offsetWidth', {
        value: width,
        configurable: true
      });
      Object.defineProperty(button, 'offsetHeight', {
        value: 88,
        configurable: true
      });
    });

    if (canvas) {
      setupCanvasMocks(canvas, 900, 700);
      await user.pointer({ keys: '[MouseRight]', target: canvas });
    }

    await user.click(screen.getByText('Cluster'));

    const storedPositions = localStorage.getItem(STORAGE_KEY);
    expect(storedPositions).not.toBeNull();

    const parsedPositions: Record<string, { x: number; y: number }> =
      JSON.parse(storedPositions ?? '{}');
    const filesPosition = parsedPositions['/files'];
    expect(filesPosition).toBeDefined();

    const itemsToArrange = navItems.filter(
      (item) => item.path !== '/' && item.path !== '/sqlite/tables'
    );
    const cols = Math.ceil(Math.sqrt(itemsToArrange.length));
    const itemWidth = Math.max(ICON_SIZE, wideLabelWidth) + GAP;
    const clusterWidth = cols * itemWidth - GAP;
    const expectedStartX = Math.max(0, (900 - clusterWidth) / 2);
    const expectedOffset = Math.max(0, (wideLabelWidth - baseLabelWidth) / 2);

    expect(filesPosition?.x).toBeCloseTo(expectedStartX + expectedOffset);
  });
});
