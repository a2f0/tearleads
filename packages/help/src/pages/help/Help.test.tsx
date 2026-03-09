import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Help } from './Help';

function Pathname() {
  const location = useLocation();
  return <div data-testid="pathname">{location.pathname}</div>;
}

function renderHelp() {
  render(
    <MemoryRouter initialEntries={['/help']}>
      <Help />
      <Pathname />
    </MemoryRouter>
  );
}

describe('Help', () => {
  const docCases = [
    { label: 'CLI Reference', path: '/help/docs/cli-reference' },
    { label: 'CI', path: '/help/docs/ci' },
    { label: 'Chrome Extension', path: '/help/docs/chrome-extension' },
    { label: 'Backup & Restore', path: '/help/docs/backup-restore' },
    { label: 'VFS', path: '/help/docs/vfs' },
    { label: 'Tuxedo', path: '/help/docs/tuxedo' }
  ] as const;

  it('renders help page with top-level help options', () => {
    renderHelp();

    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();
    expect(screen.getByText('API Docs')).toBeInTheDocument();
    expect(screen.getByText('Developer')).toBeInTheDocument();
    expect(screen.getByText('Legal')).toBeInTheDocument();
  });

  it('navigates to /help/api when API Docs is clicked', async () => {
    const user = userEvent.setup();
    renderHelp();

    await user.click(screen.getByText('API Docs'));

    expect(screen.getByTestId('pathname')).toHaveTextContent('/help/api');
  });

  it('navigates to help documentation pages', async () => {
    const user = userEvent.setup();
    renderHelp();

    await user.click(screen.getByText('Developer'));

    for (const { label, path } of docCases) {
      await user.click(screen.getByText(label));
      expect(screen.getByTestId('pathname')).toHaveTextContent(path);
    }
  });

  it('shows developer docs and returns to top-level help', async () => {
    const user = userEvent.setup();
    renderHelp();

    await user.click(screen.getByText('Developer'));
    expect(screen.getByText('CI')).toBeInTheDocument();

    await user.click(screen.getByText('Back to Help'));
    expect(screen.getByText('Developer')).toBeInTheDocument();
  });

  it('navigates to legal documentation pages', async () => {
    const user = userEvent.setup();
    renderHelp();

    await user.click(screen.getByText('Legal'));

    await user.click(screen.getByText('Privacy Policy'));
    expect(screen.getByTestId('pathname')).toHaveTextContent(
      '/help/docs/privacy-policy'
    );

    await user.click(screen.getByText('Terms of Service'));
    expect(screen.getByTestId('pathname')).toHaveTextContent(
      '/help/docs/terms-of-service'
    );
  });

  it('shows legal docs and returns to top-level help', async () => {
    const user = userEvent.setup();
    renderHelp();

    await user.click(screen.getByText('Legal'));
    expect(screen.getByText('Privacy Policy')).toBeInTheDocument();
    expect(screen.getByText('Terms of Service')).toBeInTheDocument();

    await user.click(screen.getByText('Back to Help'));
    expect(screen.getByText('Legal')).toBeInTheDocument();
  });
});
