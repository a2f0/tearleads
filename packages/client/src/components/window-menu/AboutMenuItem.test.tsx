import { ThemeProvider } from '@rapid/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AboutMenuItem } from './AboutMenuItem';

const mockVersion = '1.2.3';

vi.mock('@/hooks/useAppVersion', () => ({
  useAppVersion: () => mockVersion
}));

function renderMenuItem() {
  return render(
    <ThemeProvider>
      <AboutMenuItem />
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
});
