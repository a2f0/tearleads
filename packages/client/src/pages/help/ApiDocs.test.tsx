import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApiDocsPage } from './ApiDocs';

vi.mock('@tearleads/api/dist/openapi.json', () => ({
  default: {
    openapi: '3.0.0',
    info: { title: 'Client Docs' },
    paths: {}
  }
}));

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
