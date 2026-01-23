import openapiSpec from '@rapid/api/dist/openapi.json';
import { ApiDocs } from '@rapid/ui';
import { FileText } from 'lucide-react';
import { BackLink } from '@/components/ui/back-link';

export function ApiDocsPage() {
  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="space-y-2">
        <BackLink defaultTo="/help" defaultLabel="Back to Help" />
        <div className="flex items-center gap-3">
          <FileText className="h-8 w-8 text-muted-foreground" />
          <h1 className="font-bold text-2xl tracking-tight">API Docs</h1>
        </div>
      </div>

      <ApiDocs spec={openapiSpec} />
    </div>
  );
}
