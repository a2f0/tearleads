import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiDocsSidebar } from './ApiDocsSidebar.js';
import type { ApiTagGroup } from './apiDocsData.js';

const tagGroups: ApiTagGroup[] = [
  {
    name: 'Auth',
    description: 'Authentication endpoints',
    operations: [
      {
        id: 'auth-login',
        method: 'post',
        path: '/auth/login',
        summary: 'Login',
        tags: ['Auth'],
        parameters: [],
        responses: []
      }
    ]
  },
  {
    name: 'General',
    operations: [
      {
        id: 'ping',
        method: 'get',
        path: '/ping',
        summary: 'Ping',
        tags: ['General'],
        parameters: [],
        responses: []
      }
    ]
  }
];

describe('ApiDocsSidebar', () => {
  it('renders overview counts and sections', () => {
    render(
      <ApiDocsSidebar
        tagGroups={tagGroups}
        totalOperations={2}
        baseUrl="https://api.example.com"
        showBaseUrl={true}
        baseUrlLabel="Base URL"
      />
    );

    expect(screen.getByText('2 endpoints')).toBeInTheDocument();
    expect(screen.getByText('2 groups')).toBeInTheDocument();
    expect(screen.getByText('Auth')).toBeInTheDocument();
    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('https://api.example.com')).toBeInTheDocument();
  });

  it('omits base URL block when disabled', () => {
    render(
      <ApiDocsSidebar
        tagGroups={tagGroups}
        totalOperations={2}
        baseUrl="https://api.example.com"
        showBaseUrl={false}
        baseUrlLabel="Base URL"
      />
    );

    expect(
      screen.queryByText('https://api.example.com')
    ).not.toBeInTheDocument();
  });
});
