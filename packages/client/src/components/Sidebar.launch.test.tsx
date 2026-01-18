import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/i18n';
import { Sidebar } from './Sidebar';

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
        <Sidebar isOpen onClose={vi.fn()} />
      </MemoryRouter>
    </I18nextProvider>
  );

describe('Sidebar launch behavior', () => {
  beforeEach(() => {
    mockOpenWindow.mockReset();
    mockNavigate.mockReset();
    Object.defineProperty(navigator, 'maxTouchPoints', {
      value: 0,
      configurable: true
    });
    setMatchMedia({ coarsePointer: false, mobileWidth: false });
  });

  it('opens windowed apps on desktop', async () => {
    renderSidebar();

    await waitFor(() => expect(window.matchMedia).toHaveBeenCalled());

    fireEvent.doubleClick(screen.getByRole('button', { name: 'Console' }));

    expect(mockOpenWindow).toHaveBeenCalledWith('console');
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
});
