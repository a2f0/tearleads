import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { databaseSetupProgressStore } from '@/stores/databaseSetupProgressStore';
import { DatabaseSetupOverlay } from './DatabaseSetupOverlay';

describe('DatabaseSetupOverlay', () => {
  afterEach(() => {
    cleanup();
    act(() => {
      databaseSetupProgressStore.finish();
    });
  });

  it('does not render when store is inactive', () => {
    render(<DatabaseSetupOverlay />);
    expect(
      screen.queryByTestId('database-setup-overlay')
    ).not.toBeInTheDocument();
  });

  it('renders when store is active', () => {
    act(() => {
      databaseSetupProgressStore.start();
    });

    render(<DatabaseSetupOverlay />);
    expect(screen.getByTestId('database-setup-overlay')).toBeInTheDocument();
  });

  it('displays the current step label', () => {
    act(() => {
      databaseSetupProgressStore.start();
      databaseSetupProgressStore.update('Running database migrations...', 85);
    });

    render(<DatabaseSetupOverlay />);
    expect(
      screen.getByText('Running database migrations...')
    ).toBeInTheDocument();
  });

  it('displays the progress percentage', () => {
    act(() => {
      databaseSetupProgressStore.start();
      databaseSetupProgressStore.update('Loading...', 42);
    });

    render(<DatabaseSetupOverlay />);
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  it('renders a progressbar with correct aria attributes', () => {
    act(() => {
      databaseSetupProgressStore.start();
      databaseSetupProgressStore.update('Opening database...', 70);
    });

    render(<DatabaseSetupOverlay />);
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '70');
    expect(progressbar).toHaveAttribute('aria-valuemin', '0');
    expect(progressbar).toHaveAttribute('aria-valuemax', '100');
  });

  it('hides when store finishes', () => {
    act(() => {
      databaseSetupProgressStore.start();
    });

    const { rerender } = render(<DatabaseSetupOverlay />);
    expect(screen.getByTestId('database-setup-overlay')).toBeInTheDocument();

    act(() => {
      databaseSetupProgressStore.finish();
    });

    rerender(<DatabaseSetupOverlay />);
    expect(
      screen.queryByTestId('database-setup-overlay')
    ).not.toBeInTheDocument();
  });
});
