import { ApiDocs } from '@tearleads/ui';
import { type ComponentProps, useEffect, useState } from 'react';

type ApiSpec = ComponentProps<typeof ApiDocs>['spec'];

function isApiSpec(value: unknown): value is ApiSpec {
  return typeof value === 'object' && value !== null && 'openapi' in value;
}

export function ApiDocsLoader() {
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

  if (!openapiSpec) {
    if (loadFailed) {
      return <p className="text-danger text-sm">Unable to load API docs.</p>;
    }
    return <p className="text-muted-foreground text-sm">Loading API docs...</p>;
  }

  return <ApiDocs spec={openapiSpec} />;
}
