import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@rapid/classic', () => ({
  ClassicApp: ({
    initialState
  }: {
    initialState: { tags: { name: string }[] };
  }) => <div data-testid="classic-app">{initialState.tags[0]?.name}</div>
}));

vi.mock('@/components/ui/back-link', () => ({
  BackLink: ({
    defaultTo,
    defaultLabel
  }: {
    defaultTo: string;
    defaultLabel: string;
  }) => <a href={defaultTo}>{defaultLabel}</a>
}));

vi.mock('@/lib/classicState', () => ({
  CLASSIC_INITIAL_STATE: {
    tags: [{ id: 'tag-1', name: 'Work' }],
    notesById: {},
    noteOrderByTagId: {},
    activeTagId: 'tag-1'
  }
}));

import { Classic } from './Classic';

describe('Classic page', () => {
  const renderPage = () =>
    render(
      <MemoryRouter>
        <Classic />
      </MemoryRouter>
    );

  it('renders heading and description', () => {
    renderPage();

    expect(screen.getByText('Classic')).toBeInTheDocument();
    expect(
      screen.getByText('Tag-sorted notes workspace with per-tag ordering.')
    ).toBeInTheDocument();
  });

  it('renders back link and classic app', () => {
    renderPage();

    expect(screen.getByText('Back to Home')).toBeInTheDocument();
    expect(screen.getByTestId('classic-app')).toHaveTextContent('Work');
  });
});
