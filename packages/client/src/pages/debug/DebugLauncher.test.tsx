import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DebugLauncher } from './DebugLauncher';

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

function renderDebugLauncher() {
  return render(
    <MemoryRouter>
      <DebugLauncher />
    </MemoryRouter>
  );
}

describe('DebugLauncher', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
  });

  it('renders debug launcher content', () => {
    renderDebugLauncher();

    expect(screen.getByRole('heading', { name: 'Debug' })).toBeInTheDocument();
    expect(screen.getByTestId('debug-launcher-system-info')).toHaveTextContent(
      'System Info'
    );
    expect(screen.getByTestId('debug-launcher-browser')).toHaveTextContent(
      'Browser'
    );
  });

  it('opens system info when System Info square is clicked', async () => {
    const user = userEvent.setup();
    renderDebugLauncher();

    await user.click(screen.getByTestId('debug-launcher-system-info'));

    expect(mockNavigate).toHaveBeenCalledWith('/debug/system-info');
  });

  it('opens browser launcher when Browser square is clicked', async () => {
    const user = userEvent.setup();
    renderDebugLauncher();

    await user.click(screen.getByTestId('debug-launcher-browser'));

    expect(mockNavigate).toHaveBeenCalledWith('/debug/browser');
  });
});
