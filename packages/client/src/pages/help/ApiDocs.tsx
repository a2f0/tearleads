import { ApiDocs } from '@tearleads/ui';
import { FileText } from 'lucide-react';
import type { OpenAPIV3 } from 'openapi-types';
import { useEffect, useState } from 'react';
import { BackLink } from '@/components/ui/back-link';

function isOpenApiDocument(value: unknown): value is OpenAPIV3.Document {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return (
    typeof Reflect.get(value, 'openapi') === 'string' &&
    typeof Reflect.get(value, 'info') === 'object' &&
    Reflect.get(value, 'info') !== null &&
    typeof Reflect.get(value, 'paths') === 'object' &&
    Reflect.get(value, 'paths') !== null
  );
}

export function ApiDocsPage() {
  const [openapiSpec, setOpenapiSpec] = useState<OpenAPIV3.Document | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    const modulePath = '@tearleads/api/dist/openapi.json';

    import(modulePath)
      .then((module) => {
        if (!cancelled && isOpenApiDocument(module.default)) {
          setOpenapiSpec(module.default);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOpenapiSpec(null);
        }
      });

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
