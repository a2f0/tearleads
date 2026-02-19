import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  mockSaveWindowDimensionsForType,
  mockUpdateWindowDimensions,
  renderWindowRenderer,
  resetWindowRendererMocks,
  setMockWindows
} from './windowRendererTestHarness';

describe('WindowRenderer core behavior', () => {
  beforeEach(() => {
    resetWindowRendererMocks();
  });

  it('renders nothing when no windows are open', () => {
    setMockWindows([]);
    const { container } = renderWindowRenderer();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when all windows are minimized', () => {
    setMockWindows([
      { id: 'notes-1', type: 'notes', zIndex: 100, isMinimized: true }
    ]);
    const { container } = renderWindowRenderer();
    expect(container).toBeEmptyDOMElement();
  });

  it('skips minimized windows when rendering', () => {
    setMockWindows([
      { id: 'notes-1', type: 'notes', zIndex: 100, isMinimized: true },
      { id: 'notes-2', type: 'notes', zIndex: 101 }
    ]);
    renderWindowRenderer();
    expect(
      screen.queryByTestId('notes-window-notes-1')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('notes-window-notes-2')).toBeInTheDocument();
  });

  it('renders multiple windows', () => {
    setMockWindows([
      { id: 'notes-1', type: 'notes', zIndex: 100 },
      { id: 'notes-2', type: 'notes', zIndex: 101 }
    ]);
    renderWindowRenderer();
    expect(screen.getByTestId('notes-window-notes-1')).toBeInTheDocument();
    expect(screen.getByTestId('notes-window-notes-2')).toBeInTheDocument();
  });

  it('calls saveWindowDimensionsForType when dimensions change', async () => {
    const user = userEvent.setup();
    setMockWindows([{ id: 'notes-1', type: 'notes', zIndex: 100 }]);
    renderWindowRenderer();

    await user.click(screen.getByTestId('resize-notes-1'));
    expect(mockUpdateWindowDimensions).toHaveBeenCalledWith('notes-1', {
      x: 10,
      y: 20,
      width: 500,
      height: 400
    });
    expect(mockSaveWindowDimensionsForType).toHaveBeenCalledWith('notes', {
      x: 10,
      y: 20,
      width: 500,
      height: 400
    });
  });

  it('includes isMaximized when dimensions change provides it', async () => {
    const user = userEvent.setup();
    setMockWindows([{ id: 'notes-1', type: 'notes', zIndex: 100 }]);
    renderWindowRenderer();

    await user.click(screen.getByTestId('resize-maximized-notes-1'));
    expect(mockUpdateWindowDimensions).toHaveBeenCalledWith('notes-1', {
      x: 10,
      y: 20,
      width: 500,
      height: 400,
      isMaximized: true
    });
    expect(mockSaveWindowDimensionsForType).toHaveBeenCalledWith('notes', {
      x: 10,
      y: 20,
      width: 500,
      height: 400
    });
  });

  it('passes correct zIndex to windows', () => {
    setMockWindows([
      { id: 'notes-1', type: 'notes', zIndex: 100 },
      { id: 'notes-2', type: 'notes', zIndex: 105 }
    ]);
    renderWindowRenderer();

    expect(screen.getByTestId('notes-window-notes-1')).toHaveAttribute(
      'data-zindex',
      '100'
    );
    expect(screen.getByTestId('notes-window-notes-2')).toHaveAttribute(
      'data-zindex',
      '105'
    );
  });

  it('passes initial dimensions to notes window', () => {
    setMockWindows([
      {
        id: 'notes-1',
        type: 'notes',
        zIndex: 100,
        dimensions: { x: 12, y: 24, width: 420, height: 320 }
      }
    ]);
    renderWindowRenderer();
    expect(screen.getByTestId('notes-window-notes-1')).toHaveAttribute(
      'data-initial-width',
      '420'
    );
  });

  it('passes initial dimensions to console window', () => {
    setMockWindows([
      {
        id: 'console-1',
        type: 'console',
        zIndex: 100,
        dimensions: { x: 20, y: 30, width: 640, height: 480 }
      }
    ]);
    renderWindowRenderer();
    expect(screen.getByTestId('console-window-console-1')).toHaveAttribute(
      'data-initial-width',
      '640'
    );
  });

  it('passes initial dimensions to email window', () => {
    setMockWindows([
      {
        id: 'email-1',
        type: 'email',
        zIndex: 100,
        dimensions: { x: 24, y: 36, width: 520, height: 440 }
      }
    ]);
    renderWindowRenderer();
    expect(screen.getByTestId('email-window-email-1')).toHaveAttribute(
      'data-initial-width',
      '520'
    );
  });

  it('renders nothing for unknown window types', () => {
    setMockWindows([{ id: 'unknown-1', type: 'unknown', zIndex: 100 }]);
    renderWindowRenderer();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders mixed window types', () => {
    setMockWindows([
      { id: 'notes-1', type: 'notes', zIndex: 100 },
      { id: 'console-1', type: 'console', zIndex: 101 }
    ]);
    renderWindowRenderer();
    expect(screen.getByTestId('notes-window-notes-1')).toBeInTheDocument();
    expect(screen.getByTestId('console-window-console-1')).toBeInTheDocument();
  });

  it('renders all four window types together', () => {
    setMockWindows([
      { id: 'notes-1', type: 'notes', zIndex: 100 },
      { id: 'console-1', type: 'console', zIndex: 101 },
      { id: 'settings-1', type: 'settings', zIndex: 102 },
      { id: 'email-1', type: 'email', zIndex: 103 }
    ]);
    renderWindowRenderer();
    expect(screen.getByTestId('notes-window-notes-1')).toBeInTheDocument();
    expect(screen.getByTestId('console-window-console-1')).toBeInTheDocument();
    expect(
      screen.getByTestId('settings-window-settings-1')
    ).toBeInTheDocument();
    expect(screen.getByTestId('email-window-email-1')).toBeInTheDocument();
  });
});
