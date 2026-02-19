import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  hasFocusTestId,
  hasMinimizeCase,
  type WindowClickCase,
  type WindowMinimizeCase,
  windowCases
} from './windowRendererTestCases';
import {
  mockCloseWindow,
  mockFocusWindow,
  mockMinimizeWindow,
  mockWindows,
  renderWindowRenderer,
  resetWindowRendererMocks,
  setMockWindows
} from './windowRendererTestHarness';

function renderSingleWindow(type: string, id: string) {
  setMockWindows([{ id, type, zIndex: 100 }]);
  renderWindowRenderer();
}

function renderWindowWithHigherZSibling(type: string, id: string) {
  setMockWindows([
    { id, type, zIndex: 100 },
    { id: 'higher-z-window', type: 'notes', zIndex: 101 }
  ]);
  renderWindowRenderer();
}

describe('WindowRenderer interactions', () => {
  beforeEach(() => {
    resetWindowRendererMocks();
  });

  const renderCases: WindowClickCase[] = windowCases.map((windowCase) => [
    windowCase.label,
    windowCase.type,
    windowCase.id,
    windowCase.windowTestId
  ]);

  it.each(
    renderCases
  )('renders %s window for %s type', (_label, type, id, testId) => {
    renderSingleWindow(type, id);
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });

  const closeCases: WindowClickCase[] = windowCases.map((windowCase) => [
    windowCase.label,
    windowCase.type,
    windowCase.id,
    windowCase.closeTestId
  ]);

  it.each(
    closeCases
  )('calls closeWindow when %s close button is clicked', async (_label, type, id, testId) => {
    const user = userEvent.setup();
    renderSingleWindow(type, id);
    await user.click(screen.getByTestId(testId));
    expect(mockCloseWindow).toHaveBeenCalledWith(id);
  });

  const focusCases: WindowClickCase[] = windowCases
    .filter(hasFocusTestId)
    .map((windowCase) => [
      windowCase.label,
      windowCase.type,
      windowCase.id,
      windowCase.focusTestId
    ]);

  it.each(
    focusCases
  )('calls focusWindow when %s window is clicked', async (_label, type, id, testId) => {
    const user = userEvent.setup();
    renderWindowWithHigherZSibling(type, id);
    await user.click(screen.getByTestId(testId));
    expect(mockFocusWindow).toHaveBeenCalledWith(id);
  });

  it('does not call focusWindow when clicking the already-focused window', async () => {
    const user = userEvent.setup();
    renderSingleWindow('contacts', 'contacts-1');

    await user.click(screen.getByTestId('contacts-window-contacts-1'));

    expect(mockFocusWindow).not.toHaveBeenCalled();
  });

  it('does not call focusWindow when the clicked window no longer exists', async () => {
    const user = userEvent.setup();
    setMockWindows([{ id: 'notes-1', type: 'notes', zIndex: 100 }]);
    renderWindowRenderer();

    mockWindows.length = 0;
    await user.click(screen.getByTestId('notes-window-notes-1'));

    expect(mockFocusWindow).not.toHaveBeenCalled();
  });

  const minimizeCases: WindowMinimizeCase[] = windowCases
    .filter(hasMinimizeCase)
    .map((windowCase) => [
      windowCase.label,
      windowCase.type,
      windowCase.id,
      windowCase.minimize.testId,
      windowCase.minimize.dimensions
    ]);

  it.each(
    minimizeCases
  )('calls minimizeWindow when %s minimize button is clicked', async (_label, type, id, testId, dimensions) => {
    const user = userEvent.setup();
    renderSingleWindow(type, id);
    await user.click(screen.getByTestId(testId));
    expect(mockMinimizeWindow).toHaveBeenCalledWith(id, dimensions);
  });

  it('renders all twenty-seven window types together', () => {
    setMockWindows([
      { id: 'notes-1', type: 'notes', zIndex: 100 },
      { id: 'console-1', type: 'console', zIndex: 101 },
      { id: 'settings-1', type: 'settings', zIndex: 102 },
      { id: 'email-1', type: 'email', zIndex: 103 },
      { id: 'files-1', type: 'files', zIndex: 104 },
      { id: 'videos-1', type: 'videos', zIndex: 105 },
      { id: 'photos-1', type: 'photos', zIndex: 106 },
      { id: 'camera-1', type: 'camera', zIndex: 107 },
      { id: 'models-1', type: 'models', zIndex: 108 },
      { id: 'keychain-1', type: 'keychain', zIndex: 109 },
      { id: 'wallet-1', type: 'wallet', zIndex: 110 },
      { id: 'contacts-1', type: 'contacts', zIndex: 111 },
      { id: 'sqlite-1', type: 'sqlite', zIndex: 112 },
      { id: 'ai-1', type: 'ai', zIndex: 113 },
      { id: 'analytics-1', type: 'analytics', zIndex: 114 },
      { id: 'audio-1', type: 'audio', zIndex: 115 },
      { id: 'admin-1', type: 'admin', zIndex: 116 },
      { id: 'tables-1', type: 'tables', zIndex: 117 },
      { id: 'debug-1', type: 'debug', zIndex: 118 },
      { id: 'documents-1', type: 'documents', zIndex: 119 },
      { id: 'help-1', type: 'help', zIndex: 120 },
      { id: 'local-storage-1', type: 'local-storage', zIndex: 121 },
      { id: 'opfs-1', type: 'opfs', zIndex: 122 },
      { id: 'calendar-1', type: 'calendar', zIndex: 123 },
      { id: 'businesses-1', type: 'businesses', zIndex: 124 },
      { id: 'vehicles-1', type: 'vehicles', zIndex: 125 },
      { id: 'health-1', type: 'health', zIndex: 126 }
    ]);
    renderWindowRenderer();

    expect(screen.getByTestId('notes-window-notes-1')).toBeInTheDocument();
    expect(screen.getByTestId('console-window-console-1')).toBeInTheDocument();
    expect(
      screen.getByTestId('settings-window-settings-1')
    ).toBeInTheDocument();
    expect(screen.getByTestId('email-window-email-1')).toBeInTheDocument();
    expect(screen.getByTestId('files-window-files-1')).toBeInTheDocument();
    expect(screen.getByTestId('video-window-videos-1')).toBeInTheDocument();
    expect(screen.getByTestId('photos-window-photos-1')).toBeInTheDocument();
    expect(screen.getByTestId('camera-window-camera-1')).toBeInTheDocument();
    expect(screen.getByTestId('models-window-models-1')).toBeInTheDocument();
    expect(
      screen.getByTestId('keychain-window-keychain-1')
    ).toBeInTheDocument();
    expect(screen.getByTestId('wallet-window-wallet-1')).toBeInTheDocument();
    expect(
      screen.getByTestId('contacts-window-contacts-1')
    ).toBeInTheDocument();
    expect(screen.getByTestId('sqlite-window-sqlite-1')).toBeInTheDocument();
    expect(screen.getByTestId('opfs-window-opfs-1')).toBeInTheDocument();
    expect(
      screen.getByTestId('calendar-window-calendar-1')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('businesses-window-businesses-1')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('vehicles-window-vehicles-1')
    ).toBeInTheDocument();
    expect(screen.getByTestId('health-window-health-1')).toBeInTheDocument();
    expect(
      screen.getByTestId('local-storage-window-local-storage-1')
    ).toBeInTheDocument();
    expect(screen.getByTestId('ai-window-ai-1')).toBeInTheDocument();
    expect(
      screen.getByTestId('analytics-window-analytics-1')
    ).toBeInTheDocument();
    expect(screen.getByTestId('audio-window-audio-1')).toBeInTheDocument();
    expect(screen.getByTestId('admin-window-admin-1')).toBeInTheDocument();
    expect(screen.getByTestId('tables-window-tables-1')).toBeInTheDocument();
    expect(screen.getByTestId('debug-window-debug-1')).toBeInTheDocument();
    expect(
      screen.getByTestId('documents-window-documents-1')
    ).toBeInTheDocument();
    expect(screen.getByTestId('help-window-help-1')).toBeInTheDocument();
  });
});
