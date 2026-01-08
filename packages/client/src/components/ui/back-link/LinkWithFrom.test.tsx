import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { LinkWithFrom } from './LinkWithFrom';

describe('LinkWithFrom', () => {
  it('passes current pathname as state', () => {
    render(
      <MemoryRouter initialEntries={['/files']}>
        <Routes>
          <Route
            path="/files"
            element={
              <LinkWithFrom
                to="/photos/123"
                fromLabel="Back to Files"
                data-testid="link"
              >
                View Photo
              </LinkWithFrom>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    const link = screen.getByTestId('link');
    expect(link).toHaveAttribute('href', '/photos/123');
    expect(link).toHaveTextContent('View Photo');
  });
});
