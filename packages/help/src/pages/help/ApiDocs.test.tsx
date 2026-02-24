import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiDocsPage } from './ApiDocs.js';

describe('ApiDocsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the shared API docs UI', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    );

    render(
      <MemoryRouter>
        <ApiDocsPage />
      </MemoryRouter>
    );

    expect(
      screen.getByRole('heading', { name: 'API Docs' })
    ).toBeInTheDocument();
    expect(screen.getByText('Loading API docs...')).toBeInTheDocument();
  });

  it('renders loaded OpenAPI docs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
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
        })
      }))
    );

    render(
      <MemoryRouter>
        <ApiDocsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('Client Docs')).toBeInTheDocument();
    expect(await screen.findByText('Ping')).toBeInTheDocument();
  });
});
