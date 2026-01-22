import { ApiDocs } from '@rapid/ui';
import openapiSpec from '@rapid/api/openapi.json';

export function ApiDocsPage() {
  return (
    <div className="p-6">
      <ApiDocs spec={openapiSpec} />
    </div>
  );
}
