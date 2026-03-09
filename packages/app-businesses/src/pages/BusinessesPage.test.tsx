import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BusinessesPage } from './BusinessesPage.js';

describe('BusinessesPage', () => {
  it('renders title and child content', () => {
    render(
      <BusinessesPage>
        <div>Businesses content</div>
      </BusinessesPage>
    );

    expect(
      screen.getByRole('heading', { name: 'Businesses' })
    ).toBeInTheDocument();
    expect(screen.getByText('Businesses content')).toBeInTheDocument();
  });

  it('renders optional back link content when provided', () => {
    render(
      <BusinessesPage backLink={<button type="button">Back to Home</button>} />
    );

    expect(screen.getByRole('button', { name: 'Back to Home' })).toBeVisible();
  });
});
