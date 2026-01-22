import { render, screen } from '@testing-library/react';
import type { OpenAPIV3 } from 'openapi-types';
import { describe, expect, it } from 'vitest';
import { ApiDocs } from './ApiDocs.js';

const mockSpec: OpenAPIV3.Document = {
  openapi: '3.0.0',
  info: {
    title: 'Rapid API',
    version: '1.2.3',
    description: 'Custom API surface for Rapid.'
  },
  tags: [
    {
      name: 'Messaging',
      description: 'Send and read messages.'
    }
  ],
  paths: {
    '/ping': {
      get: {
        summary: 'Ping service',
        responses: {
          '200': {
            description: 'pong'
          }
        }
      }
    },
    '/messages': {
      post: {
        summary: 'Create message',
        tags: ['Messaging'],
        requestBody: {
          description: 'Message payload',
          content: {
            'application/json': {
              schema: {
                type: 'object'
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'created'
          }
        }
      }
    }
  }
};

describe('ApiDocs', () => {
  it('renders API metadata and tag groups', () => {
    render(<ApiDocs spec={mockSpec} />);

    expect(screen.getByText('Rapid API')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Messaging' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'General' })
    ).toBeInTheDocument();
  });

  it('renders operation summaries', () => {
    render(<ApiDocs spec={mockSpec} />);

    expect(screen.getByText('Ping service')).toBeInTheDocument();
    expect(screen.getByText('Create message')).toBeInTheDocument();
  });

  it('renders base URL when provided', () => {
    render(
      <ApiDocs
        spec={{
          ...mockSpec,
          servers: [{ url: 'https://api.example.com' }]
        }}
      />
    );

    expect(screen.getByText('https://api.example.com')).toBeInTheDocument();
  });

  it('omits description when missing', () => {
    render(
      <ApiDocs
        spec={{
          ...mockSpec,
          info: {
            title: 'No description API',
            version: '0.0.2'
          }
        }}
        intro="Intro copy"
      />
    );

    expect(
      screen.queryByText('Custom API surface for Rapid.')
    ).not.toBeInTheDocument();
    expect(screen.getByText('Intro copy')).toBeInTheDocument();
  });

  it('supports custom headers and tag ordering', () => {
    render(
      <ApiDocs
        spec={{
          ...mockSpec,
          info: {
            title: 'Minimal API',
            version: '0.0.1'
          }
        }}
        header={<div>Custom header</div>}
        tagOrder={['General', 'Messaging']}
      />
    );

    expect(screen.getByText('Custom header')).toBeInTheDocument();
    expect(screen.queryByText('API Docs')).not.toBeInTheDocument();
  });
});
