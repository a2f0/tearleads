import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

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

    expect(
      screen.getByRole('dialog', { name: 'API Docs' })
    ).toBeInTheDocument();
    expect(screen.getByText('Client Docs')).toBeInTheDocument();
    expect(screen.getByText('Ping')).toBeInTheDocument();
  });
});
