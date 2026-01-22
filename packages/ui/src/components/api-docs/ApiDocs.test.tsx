import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { OpenAPIV3 } from 'openapi-types';
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
    expect(screen.getByText('Messaging')).toBeInTheDocument();
    expect(screen.getByText('General')).toBeInTheDocument();
  });

  it('renders operation summaries', () => {
    render(<ApiDocs spec={mockSpec} />);

    expect(screen.getByText('Ping service')).toBeInTheDocument();
    expect(screen.getByText('Create message')).toBeInTheDocument();
  });
});
