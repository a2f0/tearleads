import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiDocsPage } from './ApiDocs';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        openapi: '3.0.0',
        info: { title: 'Client Docs' },
        paths: {}
      })
    }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ApiDocsPage', () => {
  it('renders API docs heading and spec title', async () => {
    render(
      <MemoryRouter>
        <ApiDocsPage />
      </MemoryRouter>
    );

    expect(
      screen.getByRole('heading', { name: 'API Docs' })
    ).toBeInTheDocument();
    expect(await screen.findByText('Client Docs')).toBeInTheDocument();
  });

  it('keeps loading state when fetch is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ openapi: '3.0.0', info: { title: 'Ignored' } })
      }))
    );

    render(
      <MemoryRouter>
        <ApiDocsPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Loading API docs...')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('Ignored')).not.toBeInTheDocument();
    });
  });

  it('keeps loading state when response is not an OpenAPI document', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ info: { title: 'Missing openapi key' } })
      }))
    );

    render(
      <MemoryRouter>
        <ApiDocsPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Loading API docs...')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('Missing openapi key')).not.toBeInTheDocument();
    });
  });

  it('keeps loading state when fetch rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      })
    );

    render(
      <MemoryRouter>
        <ApiDocsPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Loading API docs...')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('Client Docs')).not.toBeInTheDocument();
    });
  });
});
