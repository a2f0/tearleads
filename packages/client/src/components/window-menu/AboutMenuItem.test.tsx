import { ThemeProvider } from '@rapid/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as useAppVersionModule from '@/hooks/useAppVersion';
import { AboutMenuItem } from './AboutMenuItem';

vi.mock('@/hooks/useAppVersion', () => ({
  useAppVersion: vi.fn(() => '1.2.3')
}));

function renderMenuItem(props: { appName?: string; version?: string } = {}) {
  return render(
    <ThemeProvider>
      <AboutMenuItem {...props} />
    </ThemeProvider>
  );
}

describe('AboutMenuItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the menu item', () => {
    renderMenuItem();
    expect(screen.getByText('About')).toBeInTheDocument();
  });

  it('opens dialog when menu item is clicked', async () => {
    const user = userEvent.setup();
    renderMenuItem();

    await user.click(screen.getByText('About'));

    expect(screen.getByTestId('about-dialog')).toBeInTheDocument();
  });

  it('displays version from useAppVersion hook', async () => {
    const user = userEvent.setup();
    renderMenuItem();

    await user.click(screen.getByText('About'));

    expect(screen.getByTestId('about-version')).toHaveTextContent('1.2.3');
  });

  it('closes dialog after clicking OK', async () => {
    const user = userEvent.setup();
    renderMenuItem();

    // Open dialog
    await user.click(screen.getByText('About'));
    expect(screen.getByTestId('about-dialog')).toBeInTheDocument();

    // Click OK
    await user.click(screen.getByTestId('about-ok'));

    expect(screen.queryByTestId('about-dialog')).not.toBeInTheDocument();
  });

  it('closes dialog when backdrop is clicked', async () => {
    const user = userEvent.setup();
    renderMenuItem();

    // Open dialog
    await user.click(screen.getByText('About'));
    expect(screen.getByTestId('about-dialog')).toBeInTheDocument();

    // Click backdrop
    await user.click(screen.getByTestId('about-backdrop'));

    expect(screen.queryByTestId('about-dialog')).not.toBeInTheDocument();
  });

  it('displays custom app name when provided', async () => {
    const user = userEvent.setup();
    renderMenuItem({ appName: 'VFS Explorer' });

    await user.click(screen.getByText('About'));

    expect(screen.getByText('About VFS Explorer')).toBeInTheDocument();
  });

  it('displays custom version when provided', async () => {
    const user = userEvent.setup();
    renderMenuItem({ version: '0.0.8' });

    await user.click(screen.getByText('About'));

    expect(screen.getByTestId('about-version')).toHaveTextContent('0.0.8');
  });

  it('prefers provided version over hook version', async () => {
    const user = userEvent.setup();
    renderMenuItem({ version: '9.9.9' });

    await user.click(screen.getByText('About'));

    expect(screen.getByTestId('about-version')).toHaveTextContent('9.9.9');
  });

  it('displays both custom app name and version together', async () => {
    const user = userEvent.setup();
    renderMenuItem({ appName: 'Email', version: '0.0.8' });

    await user.click(screen.getByText('About'));

    expect(screen.getByText('About Email')).toBeInTheDocument();
    expect(screen.getByTestId('about-version')).toHaveTextContent('0.0.8');
  });

  it('displays Unknown when hook returns undefined and no version prop', async () => {
    vi.mocked(useAppVersionModule.useAppVersion).mockReturnValue(undefined);
    const user = userEvent.setup();
    renderMenuItem();

    await user.click(screen.getByText('About'));

    expect(screen.getByTestId('about-version')).toHaveTextContent('Unknown');
  });
});
