import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppTooltipProvider } from './AppTooltipProvider';

// Mock useSettings hook
const mockGetSetting = vi.fn();
vi.mock('@/db/SettingsProvider', () => ({
  useSettings: () => ({
    getSetting: mockGetSetting
  })
}));

// Mock TooltipProvider
vi.mock('@rapid/ui', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-provider">{children}</div>
  )
}));

describe('AppTooltipProvider', () => {
  it('renders children without TooltipProvider when tooltips disabled', () => {
    mockGetSetting.mockReturnValue('disabled');

    render(
      <AppTooltipProvider>
        <span>Test Content</span>
      </AppTooltipProvider>
    );

    expect(screen.getByText('Test Content')).toBeInTheDocument();
    expect(screen.queryByTestId('tooltip-provider')).not.toBeInTheDocument();
  });

  it('renders TooltipProvider when tooltips enabled', () => {
    mockGetSetting.mockReturnValue('enabled');

    render(
      <AppTooltipProvider>
        <span>Test Content</span>
      </AppTooltipProvider>
    );

    expect(screen.getByText('Test Content')).toBeInTheDocument();
    expect(screen.getByTestId('tooltip-provider')).toBeInTheDocument();
  });
});
