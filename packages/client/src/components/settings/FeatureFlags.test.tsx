import { ThemeProvider } from '@tearleads/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { FEATURE_FLAGS_STORAGE_KEY } from '@/lib/featureFlags';
import { FeatureFlags } from './FeatureFlags';

function renderFeatureFlags() {
  return render(
    <ThemeProvider>
      <FeatureFlags />
    </ThemeProvider>
  );
}

describe('FeatureFlags', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders the feature flags panel', () => {
    renderFeatureFlags();
    expect(screen.getByTestId('feature-flags-panel')).toBeInTheDocument();
  });

  it('shows default status when no override is set', () => {
    renderFeatureFlags();
    expect(
      screen.getByTestId('feature-flag-vfsServerRegistration-status')
    ).toHaveTextContent('Status: On');
  });

  it('writes override when toggled on', async () => {
    const user = userEvent.setup();
    renderFeatureFlags();

    await user.click(
      screen.getByTestId('feature-flag-vfsServerRegistration-on')
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('feature-flag-vfsServerRegistration-status')
      ).toHaveTextContent('Status: On');
    });

    const stored = localStorage.getItem(FEATURE_FLAGS_STORAGE_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : null;

    expect(parsed).toEqual({ vfsServerRegistration: true });
  });

  it('clears override when reset is clicked', async () => {
    const user = userEvent.setup();
    renderFeatureFlags();

    await user.click(
      screen.getByTestId('feature-flag-vfsServerRegistration-on')
    );

    await user.click(
      screen.getByTestId('feature-flag-vfsServerRegistration-reset')
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('feature-flag-vfsServerRegistration-status')
      ).toHaveTextContent('Status: On');
    });

    expect(localStorage.getItem(FEATURE_FLAGS_STORAGE_KEY)).toBeNull();
  });
});
