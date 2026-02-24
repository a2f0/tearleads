import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiDocsLoader } from './ApiDocsLoader';

vi.mock('@tearleads/ui', () => ({
  ApiDocs: ({ spec }: { spec: { info: { title: string } } }) => (
    <div data-testid="api-docs">{spec.info.title}</div>
  )
}));

describe('ApiDocsLoader', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders loading state before docs are loaded', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    render(<ApiDocsLoader />);

    expect(screen.getByText('Loading API docs...')).toBeInTheDocument();
  });

  it('renders docs when openapi payload is valid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          openapi: '3.0.0',
          info: {
            title: 'Website API Docs',
            version: '1.0.0'
          },
          paths: {}
        })
      }))
    );

    render(<ApiDocsLoader />);

    expect(await screen.findByTestId('api-docs')).toHaveTextContent(
      'Website API Docs'
    );
  });

  it('keeps loading state when response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        json: async () => ({})
      }))
    );

    render(<ApiDocsLoader />);

    await waitFor(() => {
      expect(screen.getByText('Loading API docs...')).toBeInTheDocument();
    });
  });

  it('keeps loading state when payload is not an OpenAPI doc', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          info: {
            title: 'Missing openapi field'
          }
        })
      }))
    );

    render(<ApiDocsLoader />);

    await waitFor(() => {
      expect(screen.getByText('Loading API docs...')).toBeInTheDocument();
    });
  });

  it('keeps loading state when fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network failure');
      })
    );

    render(<ApiDocsLoader />);

    await waitFor(() => {
      expect(screen.getByText('Loading API docs...')).toBeInTheDocument();
    });
  });
});
