import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/i18n';
import { Sidebar } from './Sidebar';

const mockOpenWindow = vi.fn();
const mockNavigate = vi.fn();
const mockOnClose = vi.fn();

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

const setMatchMedia = (options: {
  coarsePointer?: boolean;
  mobileWidth?: boolean;
}) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('pointer: coarse')
      ? Boolean(options.coarsePointer)
      : query.includes('max-width: 1023px')
        ? Boolean(options.mobileWidth)
        : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }));
};

const renderSidebar = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <Sidebar isOpen onClose={mockOnClose} />
      </MemoryRouter>
    </I18nextProvider>
  );

const windowedLabels = ['Console', 'Notes'];

describe('Sidebar launch behavior', () => {
  beforeEach(() => {
    mockOpenWindow.mockReset();
    mockNavigate.mockReset();
    mockOnClose.mockReset();
    Object.defineProperty(navigator, 'maxTouchPoints', {
      value: 0,
      configurable: true
    });
    setMatchMedia({ coarsePointer: false, mobileWidth: false });
  });

  it.each(
    windowedLabels
  )('opens windowed apps on single click on desktop for %s', async (label) => {
    renderSidebar();

    await waitFor(() => expect(window.matchMedia).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: label }));

    expect(mockOpenWindow).toHaveBeenCalledWith(label.toLowerCase());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('navigates on touch devices instead of opening windows', async () => {
    Object.defineProperty(navigator, 'maxTouchPoints', {
      value: 1,
      configurable: true
    });
    setMatchMedia({ coarsePointer: true, mobileWidth: false });

    renderSidebar();

    await waitFor(() => expect(window.matchMedia).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Console' }));

    expect(mockOpenWindow).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/console');
  });

  it('navigates for non-windowed apps on desktop', async () => {
    renderSidebar();

    await waitFor(() => expect(window.matchMedia).toHaveBeenCalled());

    // Home is the only non-windowed app
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));

    expect(mockOpenWindow).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('shows context menu on right-click on desktop', async () => {
    renderSidebar();

    await waitFor(() => expect(window.matchMedia).toHaveBeenCalled());

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Notes' }));

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Open in Window')).toBeInTheDocument();
  });

  it('context menu Open navigates to route', async () => {
    renderSidebar();

    await waitFor(() => expect(window.matchMedia).toHaveBeenCalled());

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Notes' }));
    fireEvent.click(screen.getByText('Open'));

    expect(mockNavigate).toHaveBeenCalledWith('/notes');
    expect(mockOpenWindow).not.toHaveBeenCalled();
  });

  it.each(
    windowedLabels
  )('context menu Open in Window opens floating window for %s', async (label) => {
    renderSidebar();

    await waitFor(() => expect(window.matchMedia).toHaveBeenCalled());

    fireEvent.contextMenu(screen.getByRole('button', { name: label }));
    fireEvent.click(screen.getByText('Open in Window'));

    expect(mockOpenWindow).toHaveBeenCalledWith(label.toLowerCase());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not show Open in Window for non-windowed apps', async () => {
    renderSidebar();

    await waitFor(() => expect(window.matchMedia).toHaveBeenCalled());

    // Home is the only non-windowed app
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Home' }));

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.queryByText('Open in Window')).not.toBeInTheDocument();
  });
});
