import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { BusinessesManager } from './BusinessesManager.js';

describe('BusinessesManager', () => {
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

    await user.type(screen.getByLabelText('Business Name'), 'Zeta Co');
    await user.click(screen.getByRole('button', { name: 'Save Business' }));
    await user.type(screen.getByLabelText('Business Name'), 'Acme Co');
    await user.click(screen.getByRole('button', { name: 'Save Business' }));

    const table = screen.getByRole('table', { name: 'Businesses table' });
    const getNameCells = () =>
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map(
          (row) => within(row).getAllByRole('cell').at(0)?.textContent ?? ''
        );

    expect(getNameCells()).toEqual(['Acme Co', 'Zeta Co']);

    await user.click(screen.getByRole('button', { name: 'Business Name' }));

    expect(getNameCells()).toEqual(['Zeta Co', 'Acme Co']);
  });
});
