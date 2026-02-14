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
} from '@tearleads/settings';
import { ChevronRight, Scale } from 'lucide-react';
import { Link } from 'react-router-dom';
import { FeatureFlags } from '@/components/settings/FeatureFlags';
import { BackLink } from '@/components/ui/back-link';
import { useAppVersion } from '@/hooks/useAppVersion';

interface SettingsProps {
  showBackLink?: boolean;
}

export function Settings({ showBackLink = true }: SettingsProps) {
  const version = useAppVersion();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {showBackLink && <BackLink defaultTo="/" defaultLabel="Back to Home" />}
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

      <SettingsSection>
        <FeatureFlags />
      </SettingsSection>

      {/* Open Source Licenses Section */}
      <Link
        to="/licenses"
        className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50"
        data-testid="open-source-licenses-link"
      >
        <div className="flex items-center gap-3">
          <Scale className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="font-medium">Open Source Licenses</p>
            <p className="text-muted-foreground text-sm">
              View licenses for third-party software
            </p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </Link>

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
