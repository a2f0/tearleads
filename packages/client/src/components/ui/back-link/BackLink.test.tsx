import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { BackLink } from './BackLink';

interface RenderBackLinkOptions {
  pathname: string;
  state?: { from?: string; fromLabel?: string };
}

function renderBackLink(
  { pathname, state }: RenderBackLinkOptions,
  props: { defaultTo: string; defaultLabel: string }
) {
  const initialEntries = [{ pathname, state }];
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route
          path="*"
          element={
            <BackLink
              defaultTo={props.defaultTo}
              defaultLabel={props.defaultLabel}
            />
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('BackLink', () => {
  it('uses default route when no state is present (deep link)', () => {
    renderBackLink(
      { pathname: '/photos/123' },
      { defaultTo: '/photos', defaultLabel: 'Back to Photos' }
    );

    const link = screen.getByTestId('back-link');
    expect(link).toHaveAttribute('href', '/photos');
    expect(link).toHaveTextContent('Back to Photos');
  });

  it('uses state route when present', () => {
    renderBackLink(
      {
        pathname: '/photos/123',
        state: { from: '/files', fromLabel: 'Back to Files' }
      },
      { defaultTo: '/photos', defaultLabel: 'Back to Photos' }
    );

    const link = screen.getByTestId('back-link');
    expect(link).toHaveAttribute('href', '/files');
    expect(link).toHaveTextContent('Back to Files');
  });

  it('falls back to default label when only from is provided', () => {
    renderBackLink(
      {
        pathname: '/photos/123',
        state: { from: '/files' }
      },
      { defaultTo: '/photos', defaultLabel: 'Back to Photos' }
    );

    const link = screen.getByTestId('back-link');
    expect(link).toHaveAttribute('href', '/files');
    expect(link).toHaveTextContent('Back to Photos');
  });

  it('renders arrow icon', () => {
    renderBackLink(
      { pathname: '/photos/123' },
      { defaultTo: '/photos', defaultLabel: 'Back to Photos' }
    );

    const link = screen.getByTestId('back-link');
    const svg = link.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });
});
