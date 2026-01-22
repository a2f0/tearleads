import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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

import { ApiDocsPage } from './ApiDocs.js';

describe('ApiDocsPage', () => {
  it('renders the shared API docs UI', () => {
    render(<ApiDocsPage />);

    expect(screen.getByText('Client Docs')).toBeInTheDocument();
    expect(screen.getByText('Ping')).toBeInTheDocument();
  });
});
