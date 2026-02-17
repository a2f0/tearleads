import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';

vi.mock('../components/index.js', () => ({
  BorderRadiusToggle: () => (
    <div data-testid="border-radius-toggle-container">BorderRadiusToggle</div>
  ),
  FontSelector: () => (
    <div data-testid="font-selector-container">FontSelector</div>
  ),
  IconBackgroundToggle: () => (
    <div data-testid="icon-background-toggle-container">
      IconBackgroundToggle
    </div>
  ),
  IconDepthToggle: () => (
    <div data-testid="icon-depth-toggle-container">IconDepthToggle</div>
  ),
  LanguageSelector: () => (
    <div data-testid="language-selector-container">LanguageSelector</div>
  ),
  PatternSelector: () => (
    <div data-testid="pattern-selector-container">PatternSelector</div>
  ),
  SettingsSection: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ThemeSelector: () => (
    <div data-testid="theme-selector-container">ThemeSelector</div>
  ),
  TooltipsToggle: () => (
    <div data-testid="tooltips-toggle-container">TooltipsToggle</div>
  ),
  WindowOpacityToggle: () => (
    <div data-testid="window-opacity-toggle-container">WindowOpacityToggle</div>
  )
}));

describe('SettingsPage', () => {
  it('renders settings sections and extras', () => {
    render(
      <SettingsPage
        backLink={<button type="button">Back to Home</button>}
        featureFlagsSection={<div data-testid="feature-flags-panel" />}
        licensesLink={<div data-testid="open-source-licenses-link" />}
        version="1.2.3"
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Settings' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to Home' })).toBeVisible();
    expect(screen.getByTestId('theme-selector-container')).toBeInTheDocument();
    expect(screen.getByTestId('feature-flags-panel')).toBeInTheDocument();
    expect(screen.getByTestId('open-source-licenses-link')).toBeInTheDocument();
    expect(screen.getByTestId('app-version')).toHaveTextContent('v1.2.3');
  });

  it('renders unknown version fallback', () => {
    render(<SettingsPage />);
    expect(screen.getByTestId('app-version')).toHaveTextContent('vunknown');
  });
});
