import { render, screen } from '@testing-library/react';
import type { OpenAPIV3 } from 'openapi-types';
import { describe, expect, it, vi } from 'vitest';
import { SwaggerUIWrapper } from './SwaggerUIWrapper';

// Mock SwaggerUI as it's a heavy external dependency
vi.mock('swagger-ui-react', () => ({
  default: ({ spec }: { spec: OpenAPIV3.Document }) => (
    <div data-testid="swagger-ui" data-spec-title={spec.info.title}>
      Swagger UI Mock
    </div>
  )
}));

// Mock the CSS import
vi.mock('swagger-ui-react/swagger-ui.css', () => ({}));

const mockSpec: OpenAPIV3.Document = {
  openapi: '3.0.0',
  info: {
    title: 'Test API',
    version: '1.0.0'
  },
  paths: {}
};

describe('SwaggerUIWrapper', () => {
  it('renders SwaggerUI with the provided spec', () => {
    render(<SwaggerUIWrapper spec={mockSpec} />);

    const swaggerUI = screen.getByTestId('swagger-ui');
    expect(swaggerUI).toBeInTheDocument();
    expect(swaggerUI).toHaveAttribute('data-spec-title', 'Test API');
  });

  it('wraps SwaggerUI in a container with correct class', () => {
    const { container } = render(<SwaggerUIWrapper spec={mockSpec} />);

    const wrapper = container.querySelector('.swagger-ui-container');
    expect(wrapper).toBeInTheDocument();
  });

  it('passes different specs correctly', () => {
    const differentSpec: OpenAPIV3.Document = {
      openapi: '3.0.0',
      info: {
        title: 'Another API',
        version: '2.0.0'
      },
      paths: {
        '/test': {
          get: {
            responses: {
              '200': {
                description: 'Success'
              }
            }
          }
        }
      }
    };

    render(<SwaggerUIWrapper spec={differentSpec} />);

    const swaggerUI = screen.getByTestId('swagger-ui');
    expect(swaggerUI).toHaveAttribute('data-spec-title', 'Another API');
  });
});
