import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { BusinessesManager } from './BusinessesManager';

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
  });
});
