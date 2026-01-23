import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DocsWindow } from './DocsWindow';

vi.mock('@rapid/api/dist/openapi.json', () => ({
  default: {
    openapi: '3.0.0',
    info: {
      title: 'Client Docs',
      version: '0.1.0',
      description: 'Client docs overview.'
    },
    paths: {
      '/ping': {
        get: {
          summary: 'Ping',
          responses: {
            '200': {
              description: 'ok'
            }
          }
        }
      }
    }
  }
}));

vi.mock('@rapid/ui', () => ({
  ApiDocs: ({ spec }: { spec: { info: { title: string } } }) => (
    <div data-testid="api-docs">{spec.info.title}</div>
  )
}));

vi.mock('@/components/floating-window', () => ({
  FloatingWindow: ({
    children,
    title
  }: {
    children: React.ReactNode;
    title: string;
  }) => (
    <div data-testid="floating-window">
      <div data-testid="window-title">{title}</div>
      {children}
    </div>
  )
}));

describe('DocsWindow', () => {
  it('renders the API docs inside a floating window', () => {
    render(
      <DocsWindow
        id="docs-1"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={1}
      />
    );

    expect(screen.getByTestId('window-title')).toHaveTextContent('API Docs');
    expect(screen.getByTestId('api-docs')).toHaveTextContent('Client Docs');
  });
});
