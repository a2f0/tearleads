import { ApiDocs } from '@tearleads/ui';
import { type ComponentProps, useEffect, useState } from 'react';

type ApiSpec = ComponentProps<typeof ApiDocs>['spec'];

function isApiSpec(value: unknown): value is ApiSpec {
  return typeof value === 'object' && value !== null && 'openapi' in value;
}

export function ApiDocsLoader() {
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

  if (!openapiSpec) {
    return <p className="text-muted-foreground text-sm">Loading API docs...</p>;
  }

  return <ApiDocs spec={openapiSpec} />;
}
