import { render, screen } from '@testing-library/react';
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
});
