import { ThemeProvider } from '@tearleads/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsInlineUnlock } from './AnalyticsInlineUnlock';

const mockUseDatabaseContext = vi.fn();

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

describe('AnalyticsInlineUnlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders setup message when database is not set up', () => {
    mockUseDatabaseContext.mockReturnValue({
      isSetUp: false,
      unlock: vi.fn()
    });

    render(
      <ThemeProvider>
        <AnalyticsInlineUnlock />
      </ThemeProvider>
    );

    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
    expect(screen.getByText('Database is not set up.')).toBeInTheDocument();
  });

  it('submits unlock request and shows wrong password error', async () => {
    const unlock = vi.fn().mockResolvedValue(false);
    mockUseDatabaseContext.mockReturnValue({
      isSetUp: true,
      unlock
    });

    render(
      <ThemeProvider>
        <AnalyticsInlineUnlock description="analytics" />
      </ThemeProvider>
    );

    await userEvent.type(screen.getByTestId('inline-unlock-password'), 'bad');
    await userEvent.click(screen.getByTestId('inline-unlock-button'));

    expect(unlock).toHaveBeenCalledWith('bad', false);
    expect(screen.getByText('Wrong password')).toBeInTheDocument();
  });

  it('shows generic error when unlock throws', async () => {
    const unlock = vi.fn().mockRejectedValue(new Error('boom'));
    mockUseDatabaseContext.mockReturnValue({
      isSetUp: true,
      unlock
    });

    render(
      <ThemeProvider>
        <AnalyticsInlineUnlock />
      </ThemeProvider>
    );

    await userEvent.type(screen.getByTestId('inline-unlock-password'), 'pw');
    await userEvent.click(screen.getByTestId('inline-unlock-button'));

    expect(screen.getByText('Failed to unlock database')).toBeInTheDocument();
  });
});
