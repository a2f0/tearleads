import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DebugBrowserLauncher } from './DebugBrowserLauncher';

const mockNavigate = vi.fn();

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

function renderDebugBrowserLauncher() {
  return render(
    <MemoryRouter>
      <DebugBrowserLauncher />
    </MemoryRouter>
  );
}

describe('DebugBrowserLauncher', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
  });

  it('renders browser launcher options', () => {
    renderDebugBrowserLauncher();

    expect(
      screen.getByRole('heading', { name: 'Browser' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('debug-browser-local-storage')).toHaveTextContent(
      'Local Storage'
    );
    expect(screen.getByTestId('debug-browser-opfs')).toHaveTextContent('OPFS');
    expect(screen.getByTestId('debug-browser-cache-storage')).toHaveTextContent(
      'Cache Storage'
    );
  });

  it('navigates to local storage browser route', async () => {
    const user = userEvent.setup();
    renderDebugBrowserLauncher();

    await user.click(screen.getByTestId('debug-browser-local-storage'));

    expect(mockNavigate).toHaveBeenCalledWith('/debug/browser/local-storage');
  });

  it('navigates to opfs browser route', async () => {
    const user = userEvent.setup();
    renderDebugBrowserLauncher();

    await user.click(screen.getByTestId('debug-browser-opfs'));

    expect(mockNavigate).toHaveBeenCalledWith('/debug/browser/opfs');
  });

  it('navigates to cache storage browser route', async () => {
    const user = userEvent.setup();
    renderDebugBrowserLauncher();

    await user.click(screen.getByTestId('debug-browser-cache-storage'));

    expect(mockNavigate).toHaveBeenCalledWith('/debug/browser/cache-storage');
  });
});
