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
  it('always renders TooltipProvider wrapper (with long delay when disabled)', () => {
    // TooltipProvider is always rendered because some components like ConnectionIndicator
    // use Tooltip internally and require the provider context. When tooltips are disabled,
    // a very long delay (999999ms) effectively prevents tooltips from showing.
    mockGetSetting.mockReturnValue('disabled');

    render(
      <AppTooltipProvider>
        <span>Test Content</span>
      </AppTooltipProvider>
    );

    expect(screen.getByText('Test Content')).toBeInTheDocument();
    expect(screen.getByTestId('tooltip-provider')).toBeInTheDocument();
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
