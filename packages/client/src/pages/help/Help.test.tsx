import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  beforeEach(() => {
    mockNavigate.mockReset();
  });

  const docCases = [
    { label: 'CLI', path: '/help/docs/cli' },
    { label: 'CLI Reference', path: '/help/docs/cli-reference' },
    { label: 'CI', path: '/help/docs/ci' },
    { label: 'Chrome Extension', path: '/help/docs/chrome-extension' },
    { label: 'Backup & Restore', path: '/help/docs/backup-restore' },
    { label: 'Tuxedo', path: '/help/docs/tuxedo' }
  ] as const;

  it('renders help page with top-level help options', () => {
    render(
      <MemoryRouter>
        <Help />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();
    expect(screen.getByText('API Docs')).toBeInTheDocument();
    expect(screen.getByText('Developer')).toBeInTheDocument();
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

  it('navigates to help documentation pages', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <Help />
      </MemoryRouter>
    );

    await user.click(screen.getByText('Developer'));

    for (const { label, path } of docCases) {
      await user.click(screen.getByText(label));
      expect(mockNavigate).toHaveBeenLastCalledWith(path);
    }

    expect(mockNavigate).toHaveBeenCalledTimes(docCases.length);
  });

  it('shows developer docs and returns to top-level help', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Help />
      </MemoryRouter>
    );

    await user.click(screen.getByText('Developer'));
    expect(screen.getByText('CI')).toBeInTheDocument();

    await user.click(screen.getByText('Back to Help'));
    expect(screen.getByText('Developer')).toBeInTheDocument();
  });
});
