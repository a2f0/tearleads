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

  it('renders multiple window types together', () => {
    const allWindowCases = windowCases.filter(
      (windowCase) => windowCase.type !== 'admin-users'
    );
    const windows = allWindowCases.map((windowCase, index) => ({
      id: windowCase.id,
      type: windowCase.type,
      zIndex: 100 + index
    }));
    setMockWindows(windows);
    renderWindowRenderer();

    for (const windowCase of allWindowCases) {
      expect(screen.getByTestId(windowCase.windowTestId)).toBeInTheDocument();
    }
  });
});
