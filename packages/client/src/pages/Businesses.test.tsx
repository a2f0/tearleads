import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Businesses } from './Businesses';

describe('Businesses', () => {
  it('renders businesses page content', () => {
    render(
      <MemoryRouter>
        <Businesses />
      </MemoryRouter>
    );

    expect(
      screen.getByRole('heading', { name: 'Businesses' })
    ).toBeInTheDocument();
    expect(screen.getByText('No businesses yet')).toBeInTheDocument();
  });
});
