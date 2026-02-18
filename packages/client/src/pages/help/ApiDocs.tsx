import { ApiDocs } from '@tearleads/ui';
import { FileText } from 'lucide-react';
import type { OpenAPIV3 } from 'openapi-types';
import { useEffect, useState } from 'react';
import { BackLink } from '@/components/ui/back-link';

function isOpenApiDocument(value: unknown): value is OpenAPIV3.Document {
  return typeof value === 'object' && value !== null && 'openapi' in value;
}

export function ApiDocsPage() {
  const [openapiSpec, setOpenapiSpec] = useState<OpenAPIV3.Document | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/v1/openapi.json');
        if (!response.ok || cancelled) {
          return;
        }

        const spec: unknown = await response.json();
        if (isOpenApiDocument(spec)) {
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
