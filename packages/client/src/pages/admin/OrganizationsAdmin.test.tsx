import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationsAdmin } from './OrganizationsAdmin';

vi.mock('@/components/admin-organizations', () => ({
  OrganizationsList: ({
    onOrganizationSelect
  }: {
    onOrganizationSelect: (id: string) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onOrganizationSelect('org-1')}>
        Select Org 1
      </button>
    </div>
  ),
  CreateOrganizationDialog: () => null
}));

describe('OrganizationsAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
