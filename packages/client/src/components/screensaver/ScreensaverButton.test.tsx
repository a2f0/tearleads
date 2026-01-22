import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ScreensaverButton } from './ScreensaverButton';
import { ScreensaverProvider, useScreensaver } from './ScreensaverContext';

function TestWrapper({ children }: { children: React.ReactNode }) {
  return <ScreensaverProvider>{children}</ScreensaverProvider>;
}

function StatusIndicator() {
  const { isActive } = useScreensaver();
  return <div data-testid="status">{isActive ? 'active' : 'inactive'}</div>;
}

describe('ScreensaverButton', () => {
  it('renders the button', () => {
    render(
      <TestWrapper>
        <ScreensaverButton />
      </TestWrapper>
    );

    expect(
      screen.getByRole('button', { name: /start screensaver/i })
    ).toBeInTheDocument();
  });

  it('renders section title', () => {
    render(
      <TestWrapper>
        <ScreensaverButton />
      </TestWrapper>
    );

    expect(screen.getByText('Screensaver')).toBeInTheDocument();
  });

  it('renders keyboard shortcut hint', () => {
    render(
      <TestWrapper>
        <ScreensaverButton />
      </TestWrapper>
    );

    expect(screen.getByText(/ctrl\+l|cmd\+l/i)).toBeInTheDocument();
  });

  it('activates screensaver on click', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <ScreensaverButton />
        <StatusIndicator />
      </TestWrapper>
    );

    expect(screen.getByTestId('status')).toHaveTextContent('inactive');

    await user.click(
      screen.getByRole('button', { name: /start screensaver/i })
    );

    expect(screen.getByTestId('status')).toHaveTextContent('active');
  });

  it('has correct test id', () => {
    render(
      <TestWrapper>
        <ScreensaverButton />
      </TestWrapper>
    );

    expect(screen.getByTestId('screensaver-start-button')).toBeInTheDocument();
  });

  describe('platform detection', () => {
    const originalNavigator = window.navigator;

    it('shows Cmd+L on Mac', () => {
      Object.defineProperty(window, 'navigator', {
        value: { platform: 'MacIntel' },
        writable: true
      });

      render(
        <TestWrapper>
          <ScreensaverButton />
        </TestWrapper>
      );

      expect(screen.getByText(/cmd\+l/i)).toBeInTheDocument();

      Object.defineProperty(window, 'navigator', {
        value: originalNavigator,
        writable: true
      });
    });

    it('shows Ctrl+L on non-Mac', () => {
      Object.defineProperty(window, 'navigator', {
        value: { platform: 'Win32' },
        writable: true
      });

      render(
        <TestWrapper>
          <ScreensaverButton />
        </TestWrapper>
      );

      expect(screen.getByText(/ctrl\+l/i)).toBeInTheDocument();

      Object.defineProperty(window, 'navigator', {
        value: originalNavigator,
        writable: true
      });
    });
  });
});
