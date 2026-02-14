import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Vehicles } from './Vehicles';

vi.mock('@/components/vehicles', () => ({
  VehiclesManager: () => (
    <div data-testid="vehicles-manager">Vehicles Manager</div>
  )
}));

describe('Vehicles page', () => {
  it('renders heading and empty state', () => {
    render(
      <MemoryRouter>
        <Vehicles />
      </MemoryRouter>
    );

    expect(
      screen.getByRole('heading', { name: 'Vehicles' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('vehicles-manager')).toBeInTheDocument();
  });

  it('hides back link when requested', () => {
    render(
      <MemoryRouter>
        <Vehicles showBackLink={false} />
      </MemoryRouter>
    );

    expect(screen.queryByText('Back to Home')).toBeNull();
  });
});
