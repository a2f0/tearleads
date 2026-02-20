import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import packageJson from '../../package.json';
import { Settings } from './Settings';

// Mock @tearleads/settings with a thin page component
vi.mock('@tearleads/settings', () => ({
  SettingsPage: ({
    backLink,
    featureFlagsSection,
    licensesLink,
    version
  }: {
    backLink?: ReactNode;
    featureFlagsSection?: ReactNode;
    licensesLink?: ReactNode;
    version?: string | null;
  }) => (
    <div>
      {backLink}
      <h1>Settings</h1>
      <div data-testid="theme-selector-container">
        <button type="button" data-testid="theme-option-light">
          Light
        </button>
      </div>
      <div data-testid="language-selector-container" />
      <div data-testid="tooltips-toggle-container" />
      <div data-testid="border-radius-toggle-container" />
      <div data-testid="icon-depth-toggle-container" />
      <div data-testid="icon-background-toggle-container" />
      <div data-testid="pattern-selector-container" />
      {featureFlagsSection}
      {licensesLink}
      <div data-testid="app-version">v{version ?? 'unknown'}</div>
    </div>
  )
}));

vi.mock('@/hooks/app', () => ({
  useAppVersion: vi.fn(() => packageJson.version)
}));

function renderSettings(showBackLink = true) {
  return render(
    <MemoryRouter>
      <Settings showBackLink={showBackLink} />
    </MemoryRouter>
  );
}

describe('Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('basic rendering', () => {
    beforeEach(() => {
      renderSettings();
    });

    it('renders the settings title', () => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    it('shows back link by default', () => {
      expect(screen.getByTestId('back-link')).toBeInTheDocument();
    });

    it('renders the theme selector', () => {
      expect(
        screen.getByTestId('theme-selector-container')
      ).toBeInTheDocument();
    });

    it('renders the language selector', () => {
      expect(
        screen.getByTestId('language-selector-container')
      ).toBeInTheDocument();
    });

    it('renders the tooltips toggle', () => {
      expect(
        screen.getByTestId('tooltips-toggle-container')
      ).toBeInTheDocument();
    });

    it('renders the feature flags panel', () => {
      expect(screen.getByTestId('feature-flags-panel')).toBeInTheDocument();
    });

    it('renders the border radius toggle', () => {
      expect(
        screen.getByTestId('border-radius-toggle-container')
      ).toBeInTheDocument();
    });

    it('renders the icon depth toggle', () => {
      expect(
        screen.getByTestId('icon-depth-toggle-container')
      ).toBeInTheDocument();
    });

    it('renders the icon background toggle', () => {
      expect(
        screen.getByTestId('icon-background-toggle-container')
      ).toBeInTheDocument();
    });

    it('renders the pattern selector', () => {
      expect(
        screen.getByTestId('pattern-selector-container')
      ).toBeInTheDocument();
    });

    it('renders the version at the bottom', () => {
      expect(screen.getByTestId('app-version')).toHaveTextContent(
        `v${packageJson.version}`
      );
    });

    it('renders the open source licenses link', () => {
      expect(
        screen.getByTestId('open-source-licenses-link')
      ).toBeInTheDocument();
      expect(screen.getByText('Open Source Licenses')).toBeInTheDocument();
    });
  });

  it('hides back link when disabled', () => {
    const { queryByTestId } = renderSettings(false);
    expect(queryByTestId('back-link')).not.toBeInTheDocument();
  });

  it('renders the theme selector options', async () => {
    renderSettings();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('theme-option-light'));
    expect(screen.getByTestId('theme-selector-container')).toBeInTheDocument();
  });
});
