declare module '@rapid/api/dist/openapi.json' {
  import type { OpenAPIV3 } from 'openapi-types';
  const spec: OpenAPIV3.Document;
  export default spec;
}
