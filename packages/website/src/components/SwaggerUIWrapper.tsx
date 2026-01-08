import type { OpenAPIV3 } from 'openapi-types';
import SwaggerUI from 'swagger-ui-react';
import 'swagger-ui-react/swagger-ui.css';

interface SwaggerUIWrapperProps {
  spec: OpenAPIV3.Document;
}

export function SwaggerUIWrapper({ spec }: SwaggerUIWrapperProps) {
  return (
    <div className="swagger-ui-container">
      <SwaggerUI spec={spec} />
    </div>
  );
}
