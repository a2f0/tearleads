import type { LicenseInfo } from '@rapid/shared';
import licensesData from '@rapid/shared/licenses.json';
import { BackLink } from '@/components/ui/back-link';

export function Licenses() {
  const licenses = licensesData as LicenseInfo[];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackLink defaultTo="/settings" defaultLabel="Back to Settings" />
      </div>

      <div>
        <h1 className="font-bold text-2xl tracking-tight">
          Open Source Licenses
        </h1>
        <p className="mt-1 text-muted-foreground text-sm">
          This app is built with {licenses.length} open source packages.
        </p>
      </div>

      <div className="rounded-lg border">
        <div className="divide-y">
          {licenses.map((pkg) => (
            <div
              key={`${pkg.name}@${pkg.version}`}
              className="flex items-baseline justify-between px-4 py-3"
            >
              <span className="font-mono text-sm">{pkg.name}</span>
              <span className="text-muted-foreground text-sm">
                v{pkg.version} - {pkg.license}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
