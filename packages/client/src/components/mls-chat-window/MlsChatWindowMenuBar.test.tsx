import { ThemeProvider } from '@rapid/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MlsChatWindowMenuBar } from './MlsChatWindowMenuBar';

vi.mock('@/hooks/useAppVersion', () => ({
  useAppVersion: () => '1.2.3'
}));

describe('MlsChatWindowMenuBar', () => {
  const renderMenuBar = (onClose = vi.fn()) =>
    render(
      <ThemeProvider>
        <MlsChatWindowMenuBar onClose={onClose} />
      </ThemeProvider>
    );

  it('renders File menu trigger', () => {
    renderMenuBar();
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
  });

  it('shows About and Close options in File menu', async () => {
    const user = userEvent.setup();
    renderMenuBar();

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(screen.getByRole('menuitem', { name: 'About' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeInTheDocument();
  });

  it('opens About dialog with version info', async () => {
    const user = userEvent.setup();
    renderMenuBar();

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'About' }));

    expect(screen.getByText('About MLS Chat')).toBeInTheDocument();
    expect(screen.getByTestId('about-version')).toHaveTextContent('1.2.3');
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
