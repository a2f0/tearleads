import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { HELP_EXTERNAL_LINKS } from '@/constants/help';
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
  const externalLinkCases = [
    { label: 'CLI', href: HELP_EXTERNAL_LINKS.cli },
    {
      label: 'Chrome Extension',
      href: HELP_EXTERNAL_LINKS.chromeExtension
    },
    {
      label: 'Backup & Restore',
      href: HELP_EXTERNAL_LINKS.backupRestore
    }
  ] as const;

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

    for (const { label, href } of externalLinkCases) {
      await user.click(screen.getByText(label));
      expect(openSpy).toHaveBeenLastCalledWith(href, '_blank', 'noopener');
    }

    expect(openSpy).toHaveBeenCalledTimes(externalLinkCases.length);

    openSpy.mockRestore();
  });
});
