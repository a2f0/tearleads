import { ThemeProvider } from '@tearleads/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import packageJson from '../../package.json';
import { Settings } from './Settings';

// Mock @tearleads/settings with stub components that have test IDs
vi.mock('@tearleads/settings', () => ({
  useSettings: () => ({
    getSetting: vi.fn((key: string) => {
      switch (key) {
        case 'desktopIconDepth':
          return 'debossed';
        case 'desktopIconBackground':
          return 'colored';
        case 'desktopPattern':
          return 'isometric';
        case 'font':
          return 'system';
        case 'language':
          return 'en';
        case 'theme':
          return 'monochrome';
        case 'tooltips':
          return 'enabled';
        case 'borderRadius':
          return 'rounded';
        case 'windowOpacity':
          return 'translucent';
        default:
          return 'enabled';
      }
    }),
    setSetting: vi.fn()
  }),
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
  SettingsSection: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ThemeSelector: () => (
    <div data-testid="theme-selector-container">
      <button type="button" data-testid="theme-option-light">
        Light
      </button>
      ThemeSelector
    </div>
  ),
  TooltipsToggle: () => (
    <div data-testid="tooltips-toggle-container">TooltipsToggle</div>
  ),
  WindowOpacityToggle: () => (
    <div data-testid="window-opacity-toggle-container">WindowOpacityToggle</div>
  )
}));

vi.mock('@/hooks/useAppVersion', () => ({
  useAppVersion: vi.fn(() => packageJson.version)
}));

function renderSettings(showBackLink = true) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <Settings showBackLink={showBackLink} />
      </ThemeProvider>
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
