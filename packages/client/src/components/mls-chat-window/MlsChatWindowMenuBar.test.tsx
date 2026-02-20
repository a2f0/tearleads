import { ThemeProvider } from '@tearleads/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MlsChatWindowMenuBar } from './MlsChatWindowMenuBar';

vi.mock('@tearleads/mls-chat/package.json', () => ({
  default: { version: '0.0.7' }
}));

vi.mock('@/hooks/app', () => ({
  useAppVersion: () => '0.0.0'
}));

describe('MlsChatWindowMenuBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderMenuBar = (onClose = vi.fn()) =>
    render(
      <ThemeProvider>
        <MlsChatWindowMenuBar onClose={onClose} />
      </ThemeProvider>
    );

  it('renders File and Help menu triggers', () => {
    renderMenuBar();
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument();
  });

  it('shows Close option in File menu', async () => {
    const user = userEvent.setup();
    renderMenuBar();

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeInTheDocument();
  });

  it('opens About dialog with package version info from Help menu', async () => {
    const user = userEvent.setup();
    renderMenuBar();

    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.click(screen.getByRole('menuitem', { name: 'About' }));

    expect(screen.getByText('About MLS Chat')).toBeInTheDocument();
    expect(screen.getByTestId('about-version')).toHaveTextContent('0.0.7');
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('calls onClose when Close is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderMenuBar(onClose);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
