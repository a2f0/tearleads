import { SettingsPage, type SettingsPageProps } from '@tearleads/settings';
import { ChevronRight, Scale } from 'lucide-react';
import { Link } from 'react-router-dom';
import { FeatureFlags } from '@/components/settings/FeatureFlags';
import { BackLink } from '@/components/ui/back-link';
import { useAppVersion } from '@/hooks/app';

interface SettingsProps {
  showBackLink?: boolean;
}

export function Settings({ showBackLink = true }: SettingsProps) {
  const version = useAppVersion();
  const backLink: SettingsPageProps['backLink'] = showBackLink ? (
    <BackLink defaultTo="/" defaultLabel="Back to Home" />
  ) : null;

  return (
    <SettingsPage
      backLink={backLink}
      featureFlagsSection={<FeatureFlags />}
      licensesLink={
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
      }
      version={version ?? null}
    />
  );
}
