import type { ReactNode } from 'react';
import {
  BorderRadiusToggle,
  FontSelector,
  IconBackgroundToggle,
  IconDepthToggle,
  LanguageSelector,
  PatternSelector,
  SettingsSection,
  ThemeSelector,
  TooltipsToggle,
  WindowOpacityToggle
} from '../components/index.js';

export interface SettingsPageProps {
  backLink?: ReactNode;
  featureFlagsSection?: ReactNode;
  licensesLink?: ReactNode;
  version?: string | null;
}

export function SettingsPage({
  backLink,
  featureFlagsSection,
  licensesLink,
  version
}: SettingsPageProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {backLink}
        <h1 className="font-bold text-2xl tracking-tight">Settings</h1>
      </div>

      <SettingsSection>
        <ThemeSelector />
      </SettingsSection>

      <SettingsSection>
        <PatternSelector />
      </SettingsSection>

      <SettingsSection>
        <IconDepthToggle />
      </SettingsSection>

      <SettingsSection>
        <IconBackgroundToggle />
      </SettingsSection>

      <SettingsSection>
        <WindowOpacityToggle />
      </SettingsSection>

      <SettingsSection>
        <BorderRadiusToggle />
      </SettingsSection>

      <SettingsSection>
        <LanguageSelector />
      </SettingsSection>

      <SettingsSection>
        <FontSelector />
      </SettingsSection>

      <SettingsSection>
        <TooltipsToggle />
      </SettingsSection>

      {featureFlagsSection ? (
        <SettingsSection>{featureFlagsSection}</SettingsSection>
      ) : null}

      {licensesLink}

      <div className="text-center">
        <p
          className="text-muted-foreground/70 text-xs"
          data-testid="app-version"
        >
          v{version ?? 'unknown'}
        </p>
      </div>
    </div>
  );
}
