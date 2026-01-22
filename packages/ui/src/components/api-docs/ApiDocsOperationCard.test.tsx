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
    expect(screen.getByText('Deprecated')).toBeInTheDocument();
  });
});
