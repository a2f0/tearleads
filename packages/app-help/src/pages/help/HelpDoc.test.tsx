import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { HelpDocPage } from './HelpDoc';

vi.mock('../../components/help-links/HelpDocumentation', () => ({
  HelpDocumentation: ({ docId }: { docId: string }) => (
    <div data-testid="help-documentation">{docId}</div>
  )
}));

describe('HelpDocPage', () => {
  it('renders documentation for a known doc route', () => {
    render(
      <MemoryRouter initialEntries={['/help/docs/tuxedo']}>
        <Routes>
          <Route path="/help/docs/:docId" element={<HelpDocPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'Tuxedo' })).toBeInTheDocument();
    expect(screen.getByTestId('help-documentation')).toHaveTextContent(
      'tuxedo'
    );
  });

  it('renders not found state for unknown doc route', () => {
    render(
      <MemoryRouter initialEntries={['/help/docs/not-real']}>
        <Routes>
          <Route path="/help/docs/:docId" element={<HelpDocPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(
      screen.getByText('This documentation page was not found.')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('help-documentation')).not.toBeInTheDocument();
  });
});
