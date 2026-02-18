import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { BusinessesManager } from './BusinessesManager.js';

describe('BusinessesManager', () => {
  async function addBusiness(
    user: ReturnType<typeof userEvent.setup>,
    values: { name: string; duns?: string; ein?: string }
  ) {
    await user.clear(screen.getByLabelText('Business Name'));
    await user.type(screen.getByLabelText('Business Name'), values.name);

    const dunsInput = screen.getByLabelText('DUNS Number');
    await user.clear(dunsInput);
    if (values.duns) {
      await user.type(dunsInput, values.duns);
    }

    const einInput = screen.getByLabelText('EIN');
    await user.clear(einInput);
    if (values.ein) {
      await user.type(einInput, values.ein);
    }

    await user.click(screen.getByRole('button', { name: 'Save Business' }));
  }

  function getSortedNames() {
    const table = screen.getByRole('table', { name: 'Businesses table' });
    return within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell').at(0)?.textContent ?? '');
  }

  it('renders an empty state initially', () => {
    render(<BusinessesManager />);

    expect(screen.getByText('No businesses yet')).toBeInTheDocument();
  });

  it('saves a business with formatted DUNS and EIN', async () => {
    const user = userEvent.setup();
    render(<BusinessesManager />);

    await user.type(screen.getByLabelText('Business Name'), 'Acme Inc.');
    await user.type(screen.getByLabelText('DUNS Number'), '12-345-6789');
    await user.type(screen.getByLabelText('EIN'), '12-3456789');

    await user.click(screen.getByRole('button', { name: 'Save Business' }));

    expect(screen.getByText('Acme Inc.')).toBeInTheDocument();
    expect(screen.getByText('12-345-6789')).toBeInTheDocument();
    expect(screen.getByText('12-3456789')).toBeInTheDocument();
    expect(screen.getByText('Valid')).toBeInTheDocument();
    expect(
      screen.getByRole('table', { name: 'Businesses table' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('businesses-table')).toBeInTheDocument();
  });

  it('shows validation errors for invalid identifiers', async () => {
    const user = userEvent.setup();
    render(<BusinessesManager />);

    await user.type(screen.getByLabelText('Business Name'), 'Acme Inc.');
    await user.type(screen.getByLabelText('DUNS Number'), '000-000-000');
    await user.type(screen.getByLabelText('EIN'), '00-0000000');
    await user.click(screen.getByRole('button', { name: 'Save Business' }));

    expect(
      screen.getByText('DUNS number cannot be all zeros')
    ).toBeInTheDocument();
    expect(screen.getByText('EIN prefix cannot be 00')).toBeInTheDocument();
    expect(screen.queryByText('Valid')).not.toBeInTheDocument();
  });

  it('requires a business name and sorts empty identifiers consistently', async () => {
    const user = userEvent.setup();
    render(<BusinessesManager />);

    await user.click(screen.getByRole('button', { name: 'Save Business' }));
    expect(screen.getByText('Business name is required')).toBeInTheDocument();

    await addBusiness(user, { name: 'Bravo Co' });
    await addBusiness(user, { name: 'Alpha Co' });
    await addBusiness(user, { name: 'Zulu Co', duns: '99-999-9999' });

    await user.click(screen.getByRole('button', { name: 'DUNS Number' }));
    expect(getSortedNames()).toEqual(['Zulu Co', 'Alpha Co', 'Bravo Co']);
  });

  it('does not show valid status when no identifiers are provided', async () => {
    const user = userEvent.setup();
    render(<BusinessesManager />);

    await user.type(screen.getByLabelText('Business Name'), 'No Id Co');
    await user.click(screen.getByRole('button', { name: 'Save Business' }));

    expect(screen.getByText('No Id Co')).toBeInTheDocument();
    expect(screen.queryByText('Valid')).not.toBeInTheDocument();
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0);
  });

  it('sorts businesses when a sortable column header is clicked', async () => {
    const user = userEvent.setup();
    render(<BusinessesManager />);

    await addBusiness(user, { name: 'Zeta Co' });
    await addBusiness(user, { name: 'Acme Co' });

    expect(getSortedNames()).toEqual(['Acme Co', 'Zeta Co']);

    await user.click(screen.getByRole('button', { name: 'Business Name' }));

    expect(getSortedNames()).toEqual(['Zeta Co', 'Acme Co']);

    await user.click(screen.getByRole('button', { name: 'Business Name' }));

    expect(getSortedNames()).toEqual(['Acme Co', 'Zeta Co']);
  });

  it('sorts by DUNS, EIN and Status while preserving tie-breaks', async () => {
    const user = userEvent.setup();
    render(<BusinessesManager />);

    await addBusiness(user, {
      name: 'Beta Co',
      duns: '12-345-6789',
      ein: '22-2222222'
    });
    await addBusiness(user, {
      name: 'Alpha Co',
      duns: '12-345-6789',
      ein: '11-1111111'
    });
    await addBusiness(user, { name: 'Gamma Co' });

    await user.click(screen.getByRole('button', { name: 'DUNS Number' }));
    expect(getSortedNames()).toEqual(['Alpha Co', 'Beta Co', 'Gamma Co']);

    await user.click(screen.getByRole('button', { name: 'EIN' }));
    expect(getSortedNames()).toEqual(['Alpha Co', 'Beta Co', 'Gamma Co']);

    await user.click(screen.getByRole('button', { name: 'Status' }));
    expect(getSortedNames()).toEqual(['Gamma Co', 'Alpha Co', 'Beta Co']);

    await user.click(screen.getByRole('button', { name: 'Status' }));
    expect(getSortedNames()).toEqual(['Alpha Co', 'Beta Co', 'Gamma Co']);
  });
});
