import { ApiDocs, BackLink } from '@tearleads/ui';
import { FileText } from 'lucide-react';
import { type ComponentProps, useEffect, useState } from 'react';

type ApiSpec = ComponentProps<typeof ApiDocs>['spec'];

function isApiSpec(value: unknown): value is ApiSpec {
  return typeof value === 'object' && value !== null && 'openapi' in value;
}

export function ApiDocsPage() {
  const [openapiSpec, setOpenapiSpec] = useState<ApiSpec | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/v1/openapi.json');
        if (cancelled) {
          return;
        }

        if (!response.ok) {
          setLoadFailed(true);
          return;
        }

        const spec: unknown = await response.json();
        if (cancelled) {
          return;
        }
        if (isApiSpec(spec)) {
          setOpenapiSpec(spec);
          return;
        }

        setLoadFailed(true);
      } catch {
        if (!cancelled) {
          setLoadFailed(true);
        }
      }
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
      ) : loadFailed ? (
        <div className="text-danger text-sm">Unable to load API docs.</div>
      ) : (
        <div className="text-muted-foreground text-sm">Loading API docs...</div>
      )}
    </div>
  );
}
