import { OPENAPI_JSON_PATH } from '@tearleads/ui';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiDocsLoader } from './ApiDocsLoader';

vi.mock('@tearleads/ui', () => ({
  OPENAPI_JSON_PATH: '/openapi.json',
  ApiDocs: ({ spec }: { spec: { info: { title: string } } }) => (
    <div data-testid="api-docs">{spec.info.title}</div>
  )
}));

describe('ApiDocsLoader', () => {
  const originalFetch = globalThis.fetch;
  type MockFetchResponse = {
    ok: boolean;
    json: () => Promise<unknown>;
  };

  function stubFetch(implementation: unknown): void {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: implementation
    });
  }

  afterEach(() => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: originalFetch
    });
  });

  it('renders loading state before docs are loaded', () => {
    const fetchMock = vi.fn(() => new Promise<never>(() => {}));
    stubFetch(fetchMock);

    render(<ApiDocsLoader />);

    expect(screen.getByText('Loading API docs...')).toBeInTheDocument();
  });

  it('renders docs when openapi payload is valid', async () => {
    const fetchMock = vi.fn(async (): Promise<MockFetchResponse> => ({
      ok: true,
      json: async () => ({
        openapi: '3.0.0',
        info: {
          title: 'Website API Docs',
          version: '1.0.0'
        },
        paths: {}
      })
    }));
    stubFetch(fetchMock);

    render(<ApiDocsLoader />);

    expect(fetchMock).toHaveBeenCalledWith(OPENAPI_JSON_PATH);
    expect(await screen.findByTestId('api-docs')).toHaveTextContent(
      'Website API Docs'
    );
  });

  it('shows error when response is not ok', async () => {
    const fetchMock = vi.fn(async (): Promise<MockFetchResponse> => ({
      ok: false,
      json: async () => ({})
    }));
    stubFetch(fetchMock);

    render(<ApiDocsLoader />);

    expect(
      await screen.findByText('Unable to load API docs.')
    ).toBeInTheDocument();
  });

  it('shows error when payload is not an OpenAPI doc', async () => {
    const fetchMock = vi.fn(async (): Promise<MockFetchResponse> => ({
      ok: true,
      json: async () => ({
        info: {
          title: 'Missing openapi field'
        }
      })
    }));
    stubFetch(fetchMock);

    render(<ApiDocsLoader />);

    expect(
      await screen.findByText('Unable to load API docs.')
    ).toBeInTheDocument();
  });

  it('shows error when fetch fails', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network failure');
    });
    stubFetch(fetchMock);

    render(<ApiDocsLoader />);

    expect(
      await screen.findByText('Unable to load API docs.')
    ).toBeInTheDocument();
  });

  it('does not update state after unmount before fetch resolves', async () => {
    let resolveFetch: ((value: MockFetchResponse) => void) | null = null;
    const fetchMock = vi.fn(
      () =>
        new Promise<MockFetchResponse>((resolve) => {
          resolveFetch = resolve;
        })
    );
    stubFetch(fetchMock);

    const { unmount } = render(<ApiDocsLoader />);
    unmount();

    if (resolveFetch === null) {
      throw new Error('Expected fetch resolver to be initialized');
    }

    resolveFetch({
      ok: false,
      json: async () => ({})
    });

    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not update state after unmount before json resolves', async () => {
    let resolveJson: ((value: unknown) => void) | null = null;
    const fetchMock = vi.fn(async (): Promise<MockFetchResponse> => ({
      ok: true,
      json: () =>
        new Promise((resolve) => {
          resolveJson = resolve;
        })
    }));
    stubFetch(fetchMock);

    const { unmount } = render(<ApiDocsLoader />);
    await Promise.resolve();
    unmount();

    if (resolveJson === null) {
      throw new Error('Expected JSON resolver to be initialized');
    }

    resolveJson({
      openapi: '3.0.0',
      info: { title: 'Ignored', version: '1.0.0' },
      paths: {}
    });

    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not set loadFailed after unmount when fetch later throws', async () => {
    let rejectFetch: ((reason?: unknown) => void) | null = null;
    const fetchMock = vi.fn(
      () =>
        new Promise<MockFetchResponse>((_, reject) => {
          rejectFetch = reject;
        })
    );
    stubFetch(fetchMock);

    const { unmount } = render(<ApiDocsLoader />);
    unmount();

    if (rejectFetch === null) {
      throw new Error('Expected fetch rejector to be initialized');
    }

    rejectFetch(new Error('late failure'));

    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
