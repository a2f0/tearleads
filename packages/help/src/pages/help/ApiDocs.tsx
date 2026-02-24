import { ApiDocs, BackLink } from '@tearleads/ui';
import { FileText } from 'lucide-react';
import { type ComponentProps, useEffect, useState } from 'react';

type ApiSpec = ComponentProps<typeof ApiDocs>['spec'];

function isApiSpec(value: unknown): value is ApiSpec {
  return typeof value === 'object' && value !== null && 'openapi' in value;
}

export function ApiDocsPage() {
  const [openapiSpec, setOpenapiSpec] = useState<ApiSpec | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/v1/openapi.json');
        if (!response.ok || cancelled) {
          return;
        }

        const spec: unknown = await response.json();
        if (isApiSpec(spec)) {
          setOpenapiSpec(spec);
        }
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="space-y-2">
        <BackLink defaultTo="/help" defaultLabel="Back to Help" />
        <div className="flex items-center gap-3">
          <FileText className="h-8 w-8 text-muted-foreground" />
          <h1 className="font-bold text-2xl tracking-tight">API Docs</h1>
        </div>
      </div>

      {openapiSpec ? (
        <ApiDocs spec={openapiSpec} />
      ) : (
        <div className="text-muted-foreground text-sm">Loading API docs...</div>
      )}
    </div>
  );
}
