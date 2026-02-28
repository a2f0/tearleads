import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgProvider, useOrg } from './OrgContext';

const mockGetOrganizations = vi.fn();
const mockGetActiveOrgForUser = vi.fn();
const mockSetActiveOrgForUser = vi.fn();
const mockClearActiveOrgForUser = vi.fn();
const mockSetStoredOrgId = vi.fn();
const mockClearStoredOrgId = vi.fn();

let mockAuthValue = {
  isAuthenticated: false,
  isLoading: false,
  user: null as { id: string; email: string } | null
};

vi.mock('./AuthContext', () => ({
  useAuth: () => mockAuthValue
}));

vi.mock('@/lib/api', () => ({
  api: {
    auth: {
      getOrganizations: () => mockGetOrganizations()
    }
  }
}));

vi.mock('@/db/orgPreference', () => ({
  getActiveOrgForUser: (...args: unknown[]) => mockGetActiveOrgForUser(...args),
  setActiveOrgForUser: (...args: unknown[]) => mockSetActiveOrgForUser(...args),
  clearActiveOrgForUser: (...args: unknown[]) =>
    mockClearActiveOrgForUser(...args)
}));

vi.mock('@/lib/orgStorage', () => ({
  setActiveOrganizationId: (...args: unknown[]) => mockSetStoredOrgId(...args),
  clearActiveOrganizationId: () => mockClearStoredOrgId()
}));

function TestComponent() {
  const {
    organizations,
    activeOrganizationId,
    setActiveOrganizationId,
    isLoading
  } = useOrg();

  if (isLoading) {
    return <div data-testid="loading">Loading...</div>;
  }

  return (
    <div>
      <div data-testid="org-count">{organizations.length}</div>
      <div data-testid="active-org">{activeOrganizationId ?? 'none'}</div>
      {organizations.map((org) => (
        <div key={org.id} data-testid={`org-${org.id}`}>
          {org.name}
        </div>
      ))}
      <button
        type="button"
        onClick={() => setActiveOrganizationId('team-org-1')}
      >
        Switch Org
      </button>
    </div>
  );
}

describe('OrgContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthValue = {
      isAuthenticated: false,
      isLoading: false,
      user: null
    };
    mockGetActiveOrgForUser.mockResolvedValue(null);
    mockSetActiveOrgForUser.mockResolvedValue(undefined);
    mockClearActiveOrgForUser.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('provides empty state when not authenticated', async () => {
    render(
      <OrgProvider>
        <TestComponent />
      </OrgProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('org-count')).toHaveTextContent('0');
      expect(screen.getByTestId('active-org')).toHaveTextContent('none');
    });
  });

  it('fetches organizations when authenticated', async () => {
    mockAuthValue = {
      isAuthenticated: true,
      isLoading: false,
      user: { id: 'user-1', email: 'test@example.com' }
    };

    mockGetOrganizations.mockResolvedValueOnce({
      organizations: [
        { id: 'personal-org-1', name: 'Personal', isPersonal: true },
        { id: 'team-org-1', name: 'Team Alpha', isPersonal: false }
      ],
      personalOrganizationId: 'personal-org-1'
    });

    render(
      <OrgProvider>
        <TestComponent />
      </OrgProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('org-count')).toHaveTextContent('2');
      expect(screen.getByTestId('active-org')).toHaveTextContent(
        'personal-org-1'
      );
    });

    expect(screen.getByTestId('org-personal-org-1')).toHaveTextContent(
      'Personal'
    );
    expect(screen.getByTestId('org-team-org-1')).toHaveTextContent(
      'Team Alpha'
    );
  });

  it('restores persisted org choice', async () => {
    mockAuthValue = {
      isAuthenticated: true,
      isLoading: false,
      user: { id: 'user-1', email: 'test@example.com' }
    };

    mockGetOrganizations.mockResolvedValueOnce({
      organizations: [
        { id: 'personal-org-1', name: 'Personal', isPersonal: true },
        { id: 'team-org-1', name: 'Team Alpha', isPersonal: false }
      ],
      personalOrganizationId: 'personal-org-1'
    });
    mockGetActiveOrgForUser.mockResolvedValueOnce('team-org-1');

    render(
      <OrgProvider>
        <TestComponent />
      </OrgProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('active-org')).toHaveTextContent('team-org-1');
    });

    expect(mockGetActiveOrgForUser).toHaveBeenCalledWith('user-1');
  });

  it('falls back to personal org when persisted choice is invalid', async () => {
    mockAuthValue = {
      isAuthenticated: true,
      isLoading: false,
      user: { id: 'user-1', email: 'test@example.com' }
    };

    mockGetOrganizations.mockResolvedValueOnce({
      organizations: [
        { id: 'personal-org-1', name: 'Personal', isPersonal: true }
      ],
      personalOrganizationId: 'personal-org-1'
    });
    mockGetActiveOrgForUser.mockResolvedValueOnce('deleted-org');

    render(
      <OrgProvider>
        <TestComponent />
      </OrgProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('active-org')).toHaveTextContent(
        'personal-org-1'
      );
    });

    expect(mockSetActiveOrgForUser).toHaveBeenCalledWith(
      'user-1',
      'personal-org-1'
    );
  });

  it('persists org choice when switching', async () => {
    mockAuthValue = {
      isAuthenticated: true,
      isLoading: false,
      user: { id: 'user-1', email: 'test@example.com' }
    };

    mockGetOrganizations.mockResolvedValueOnce({
      organizations: [
        { id: 'personal-org-1', name: 'Personal', isPersonal: true },
        { id: 'team-org-1', name: 'Team Alpha', isPersonal: false }
      ],
      personalOrganizationId: 'personal-org-1'
    });

    const user = userEvent.setup();

    render(
      <OrgProvider>
        <TestComponent />
      </OrgProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('org-count')).toHaveTextContent('2');
    });

    await user.click(screen.getByRole('button', { name: 'Switch Org' }));

    await waitFor(() => {
      expect(screen.getByTestId('active-org')).toHaveTextContent('team-org-1');
    });

    expect(mockSetActiveOrgForUser).toHaveBeenCalledWith(
      'user-1',
      'team-org-1'
    );
  });

  it('handles fetch error gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockAuthValue = {
      isAuthenticated: true,
      isLoading: false,
      user: { id: 'user-1', email: 'test@example.com' }
    };

    mockGetOrganizations.mockRejectedValueOnce(new Error('Network error'));

    render(
      <OrgProvider>
        <TestComponent />
      </OrgProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('org-count')).toHaveTextContent('0');
      expect(screen.getByTestId('active-org')).toHaveTextContent('none');
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to fetch organizations:',
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  it('calls clearActiveOrgForUser on logout', async () => {
    mockAuthValue = {
      isAuthenticated: true,
      isLoading: false,
      user: { id: 'user-1', email: 'test@example.com' }
    };

    mockGetOrganizations.mockResolvedValueOnce({
      organizations: [
        { id: 'personal-org-1', name: 'Personal', isPersonal: true }
      ],
      personalOrganizationId: 'personal-org-1'
    });

    const { rerender } = render(
      <OrgProvider>
        <TestComponent />
      </OrgProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('org-count')).toHaveTextContent('1');
    });

    mockClearActiveOrgForUser.mockClear();

    // Simulate logout
    mockAuthValue = {
      isAuthenticated: false,
      isLoading: false,
      user: null
    };

    rerender(
      <OrgProvider>
        <TestComponent />
      </OrgProvider>
    );

    await waitFor(() => {
      expect(mockClearActiveOrgForUser).toHaveBeenCalledWith('user-1');
    });
    expect(screen.getByTestId('org-count')).toHaveTextContent('0');
    expect(screen.getByTestId('active-org')).toHaveTextContent('none');
  });

  it('shows loading state while auth is loading', () => {
    mockAuthValue = {
      isAuthenticated: false,
      isLoading: true,
      user: null
    };

    render(
      <OrgProvider>
        <TestComponent />
      </OrgProvider>
    );

    expect(screen.getByTestId('loading')).toBeInTheDocument();
  });

  it('syncs orgStorage when org is set from fetch', async () => {
    mockAuthValue = {
      isAuthenticated: true,
      isLoading: false,
      user: { id: 'user-1', email: 'test@example.com' }
    };

    mockGetOrganizations.mockResolvedValueOnce({
      organizations: [
        { id: 'personal-org-1', name: 'Personal', isPersonal: true }
      ],
      personalOrganizationId: 'personal-org-1'
    });

    render(
      <OrgProvider>
        <TestComponent />
      </OrgProvider>
    );

    await waitFor(() => {
      expect(mockSetStoredOrgId).toHaveBeenCalledWith('personal-org-1');
    });
  });

  it('syncs orgStorage when user switches org', async () => {
    mockAuthValue = {
      isAuthenticated: true,
      isLoading: false,
      user: { id: 'user-1', email: 'test@example.com' }
    };

    mockGetOrganizations.mockResolvedValueOnce({
      organizations: [
        { id: 'personal-org-1', name: 'Personal', isPersonal: true },
        { id: 'team-org-1', name: 'Team Alpha', isPersonal: false }
      ],
      personalOrganizationId: 'personal-org-1'
    });

    const user = userEvent.setup();

    render(
      <OrgProvider>
        <TestComponent />
      </OrgProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('org-count')).toHaveTextContent('2');
    });

    mockSetStoredOrgId.mockClear();
    await user.click(screen.getByRole('button', { name: 'Switch Org' }));

    await waitFor(() => {
      expect(mockSetStoredOrgId).toHaveBeenCalledWith('team-org-1');
    });
  });

  it('clears orgStorage on logout', async () => {
    mockAuthValue = {
      isAuthenticated: true,
      isLoading: false,
      user: { id: 'user-1', email: 'test@example.com' }
    };

    mockGetOrganizations.mockResolvedValueOnce({
      organizations: [
        { id: 'personal-org-1', name: 'Personal', isPersonal: true }
      ],
      personalOrganizationId: 'personal-org-1'
    });

    const { rerender } = render(
      <OrgProvider>
        <TestComponent />
      </OrgProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('org-count')).toHaveTextContent('1');
    });

    mockClearStoredOrgId.mockClear();

    mockAuthValue = {
      isAuthenticated: false,
      isLoading: false,
      user: null
    };

    rerender(
      <OrgProvider>
        <TestComponent />
      </OrgProvider>
    );

    await waitFor(() => {
      expect(mockClearStoredOrgId).toHaveBeenCalled();
    });
  });
});
