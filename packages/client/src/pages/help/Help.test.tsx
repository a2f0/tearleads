import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Help } from './Help';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

describe('Help', () => {
  it('renders help page with all help options', () => {
    render(
      <MemoryRouter>
        <Help />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();
    expect(screen.getByText('API Docs')).toBeInTheDocument();
    expect(screen.getByText('CLI')).toBeInTheDocument();
    expect(screen.getByText('Chrome Extension')).toBeInTheDocument();
    expect(screen.getByText('Backup & Restore')).toBeInTheDocument();
  });

  it('navigates to /help/api when API Docs is clicked', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Help />
      </MemoryRouter>
    );

    await user.click(screen.getByText('API Docs'));

    expect(mockNavigate).toHaveBeenCalledWith('/help/api');
  });

  it('opens external docs links in a new tab', async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(
      <MemoryRouter>
        <Help />
      </MemoryRouter>
    );

    await user.click(screen.getByText('CLI'));
    expect(openSpy).toHaveBeenCalledWith('/products/cli', '_blank', 'noopener');

    await user.click(screen.getByText('Chrome Extension'));
    expect(openSpy).toHaveBeenCalledWith(
      '/products/chrome-extension',
      '_blank',
      'noopener'
    );

    await user.click(screen.getByText('Backup & Restore'));
    expect(openSpy).toHaveBeenCalledWith(
      '/docs/backup-restore',
      '_blank',
      'noopener'
    );

    openSpy.mockRestore();
  });
});
