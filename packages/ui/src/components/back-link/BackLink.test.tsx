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
  return render(
    <MemoryRouter initialEntries={[{ pathname, state }]}> 
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
  it('uses defaults when navigation state is absent', () => {
    renderBackLink(
      { pathname: '/photos/1' },
      { defaultTo: '/photos', defaultLabel: 'Back to Photos' }
    );

    const link = screen.getByTestId('back-link');
    expect(link).toHaveAttribute('href', '/photos');
    expect(link).toHaveTextContent('Back to Photos');
  });

  it('uses state values when provided', () => {
    renderBackLink(
      {
        pathname: '/photos/1',
        state: { from: '/files', fromLabel: 'Back to Files' }
      },
      { defaultTo: '/photos', defaultLabel: 'Back to Photos' }
    );

    const link = screen.getByTestId('back-link');
    expect(link).toHaveAttribute('href', '/files');
    expect(link).toHaveTextContent('Back to Files');
    expect(link.querySelector('svg')).toBeInTheDocument();
  });
});
