import type { AdminUser } from '@tearleads/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminUserAiUsage } from './AdminUserAiUsage';

describe('AdminUserAiUsage', () => {
  const mockUser: AdminUser = {
    id: 'user-1',
    email: 'test@example.com',
    emailConfirmed: true,
    admin: false,
    organizationIds: [],
    accounting: {
      totalTokens: 1000,
      totalPromptTokens: 600,
      totalCompletionTokens: 400,
      requestCount: 10,
      lastUsedAt: '2024-01-01T12:00:00Z'
    }
  } as any;

  it('renders accounting information correctly', () => {
    render(<AdminUserAiUsage user={mockUser} onViewAiRequests={() => {}} />);

    expect(screen.getByText('AI Usage')).toBeInTheDocument();
    expect(screen.getByText('1,000')).toBeInTheDocument(); // Total Tokens
    expect(screen.getByText('600')).toBeInTheDocument(); // Prompt Tokens
    expect(screen.getByText('400')).toBeInTheDocument(); // Completion Tokens
    expect(screen.getByText('10')).toBeInTheDocument(); // Requests
  });

  it('calls onViewAiRequests when button is clicked', () => {
    const onViewAiRequests = vi.fn();
    render(
      <AdminUserAiUsage user={mockUser} onViewAiRequests={onViewAiRequests} />
    );

    fireEvent.click(screen.getByText('View Requests'));
    expect(onViewAiRequests).toHaveBeenCalled();
  });
});
