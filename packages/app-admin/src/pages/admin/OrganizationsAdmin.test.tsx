import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationsAdmin } from './OrganizationsAdmin';

const mockUseAdminScope = vi.fn();

vi.mock('@admin/hooks/useAdminScope', () => ({
  useAdminScope: () => mockUseAdminScope()
}));

const mockOrganizationsList = vi.fn(
  ({
    onOrganizationSelect,
    onCreateClick,
    organizationId
  }: {
    onOrganizationSelect: (id: string) => void;
    onCreateClick?: () => void;
    organizationId?: string | null;
  }) => (
    <div data-organization-id={organizationId ?? ''}>
      <button type="button" onClick={() => onOrganizationSelect('org-1')}>
        Select Org 1
      </button>
      <button type="button" onClick={() => onCreateClick?.()}>
        Open Create From List
      </button>
    </div>
  )
);

vi.mock('@admin/components/admin-organizations', () => ({
  OrganizationsList: (props: {
    onOrganizationSelect: (id: string) => void;
    onCreateClick?: () => void;
  }) => mockOrganizationsList(props),
  CreateOrganizationDialog: ({
    open,
    onOpenChange,
    onCreated
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated?: () => void;
  }) => (
    <div>
      <span>{open ? 'Dialog Open' : 'Dialog Closed'}</span>
      <button type="button" onClick={() => onOpenChange(false)}>
        Close Dialog
      </button>
      <button type="button" onClick={() => onCreated?.()}>
        Trigger Created
      </button>
    </div>
  )
}));

describe('OrganizationsAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrganizationsList.mockClear();
    mockUseAdminScope.mockReturnValue({
      context: {
        isRootAdmin: true,
        organizations: [{ id: 'org-1', name: 'Org One' }],
        defaultOrganizationId: null
      },
      selectedOrganizationId: null,
      loading: false,
      error: null,
      setSelectedOrganizationId: vi.fn()
    });
  });

  const defaultProps = {
    onOrganizationSelect: vi.fn()
  };

  function renderOrganizationsAdmin(showBackLink = true) {
    return render(
      <MemoryRouter>
        <OrganizationsAdmin {...defaultProps} showBackLink={showBackLink} />
      </MemoryRouter>
    );
  }

  it('renders heading and create button', () => {
    renderOrganizationsAdmin();
    expect(
      screen.getByRole('heading', { name: 'Organizations Admin' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create Organization' })
    ).toBeInTheDocument();
  });

  it('shows back link by default', () => {
    renderOrganizationsAdmin();
    expect(screen.getByTestId('back-link')).toBeInTheDocument();
  });

  it('hides back link when disabled', () => {
    renderOrganizationsAdmin(false);
    expect(screen.queryByTestId('back-link')).not.toBeInTheDocument();
  });

  it('calls onOrganizationSelect when org is selected', async () => {
    const user = userEvent.setup();
    const onOrganizationSelect = vi.fn();

    render(
      <MemoryRouter>
        <OrganizationsAdmin onOrganizationSelect={onOrganizationSelect} />
      </MemoryRouter>
    );

    await user.click(screen.getByText('Select Org 1'));

    expect(onOrganizationSelect).toHaveBeenCalledWith('org-1');
  });

  it('opens dialog when create button is clicked', async () => {
    const user = userEvent.setup();
    renderOrganizationsAdmin();

    expect(screen.getByText('Dialog Closed')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Create Organization' })
    );

    expect(screen.getByText('Dialog Open')).toBeInTheDocument();
  });

  it('opens dialog when list create button is clicked', async () => {
    const user = userEvent.setup();
    renderOrganizationsAdmin();

    await user.click(screen.getByText('Open Create From List'));

    expect(screen.getByText('Dialog Open')).toBeInTheDocument();
  });

  it('refreshes list when organization is created', async () => {
    const user = userEvent.setup();
    renderOrganizationsAdmin();

    await user.click(screen.getByText('Trigger Created'));

    await waitFor(() => {
      expect(mockOrganizationsList.mock.calls.length).toBeGreaterThan(1);
    });
  });

  it('hides create organization button for org admins', () => {
    mockUseAdminScope.mockReturnValue({
      context: {
        isRootAdmin: false,
        organizations: [{ id: 'org-1', name: 'Org One' }],
        defaultOrganizationId: 'org-1'
      },
      selectedOrganizationId: 'org-1',
      loading: false,
      error: null,
      setSelectedOrganizationId: vi.fn()
    });

    renderOrganizationsAdmin();

    expect(
      screen.queryByRole('button', { name: 'Create Organization' })
    ).not.toBeInTheDocument();
  });
});
