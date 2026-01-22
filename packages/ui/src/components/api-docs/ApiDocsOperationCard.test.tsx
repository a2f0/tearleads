import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiDocsOperationCard } from './ApiDocsOperationCard.js';
import type { ApiOperation } from './apiDocsData.js';

describe('ApiDocsOperationCard', () => {
  const operation: ApiOperation = {
    id: 'create-message',
    method: 'post',
    path: '/messages',
    summary: 'Create message',
    description: 'Creates a new message.',
    tags: ['Messaging'],
    parameters: [
      {
        name: 'channelId',
        location: 'path',
        required: true,
        description: 'Channel identifier',
        schemaType: 'string'
      },
      {
        name: 'traceId',
        location: 'header',
        required: false,
        ref: '#/components/parameters/TraceId'
      }
    ],
    requestBody: {
      description: 'Message payload',
      contentTypes: ['application/json'],
      required: true
    },
    responses: [
      {
        status: '201',
        description: 'Created'
      },
      {
        status: '400',
        ref: '#/components/responses/BadRequest'
      }
    ],
    deprecated: true
  };

  it('renders operation details', () => {
    render(<ApiDocsOperationCard operation={operation} />);

    expect(screen.getByText('Create message')).toBeInTheDocument();
    expect(screen.getByText('/messages')).toBeInTheDocument();
    expect(screen.getByText('Creates a new message.')).toBeInTheDocument();
    expect(screen.getByText('channelId')).toBeInTheDocument();
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.getByText('application/json')).toBeInTheDocument();
    expect(screen.getByText('201')).toBeInTheDocument();
    expect(screen.getByText('400')).toBeInTheDocument();
    expect(
      screen.getByText('#/components/parameters/TraceId')
    ).toBeInTheDocument();
    expect(
      screen.getByText('#/components/responses/BadRequest')
    ).toBeInTheDocument();
    expect(screen.getByText('Deprecated')).toBeInTheDocument();
  });

  it('hides optional sections when data is missing', () => {
    render(
      <ApiDocsOperationCard
        operation={{
          id: 'ping',
          method: 'get',
          path: '/ping',
          summary: 'Ping',
          tags: ['General'],
          parameters: [],
          responses: []
        }}
      />
    );

    expect(screen.queryByText('Parameters')).not.toBeInTheDocument();
    expect(screen.queryByText('Request body')).not.toBeInTheDocument();
    expect(screen.queryByText('Responses')).not.toBeInTheDocument();
  });

  it('renders request body reference when provided', () => {
    render(
      <ApiDocsOperationCard
        operation={{
          id: 'upload',
          method: 'put',
          path: '/upload',
          summary: 'Upload',
          tags: ['Uploads'],
          parameters: [],
          requestBody: {
            contentTypes: [],
            ref: '#/components/requestBodies/Upload'
          },
          responses: [
            {
              status: '204'
            }
          ]
        }}
      />
    );

    expect(
      screen.getByText('#/components/requestBodies/Upload')
    ).toBeInTheDocument();
  });
});
