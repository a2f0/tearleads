import openapiSpec from '@rapid/api/dist/openapi.json';
import { ApiDocs } from '@rapid/ui';

export function ApiDocsPage() {
  return (
    <div className="p-6">
      <ApiDocs spec={openapiSpec} />
    </div>
  );
}
