import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { HelpDocPage } from './HelpDoc';

vi.mock('@/components/help-links/HelpDocumentation', () => ({
  HelpDocumentation: ({ docId }: { docId: string }) => (
    <div data-testid="help-documentation">{docId}</div>
  )
}));

describe('HelpDocPage', () => {
  it('renders known docs', () => {
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

  it('renders not found for unknown docs', () => {
    render(
      <MemoryRouter initialEntries={['/help/docs/nope']}>
        <Routes>
          <Route path="/help/docs/:docId" element={<HelpDocPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(
      screen.getByText('This documentation page was not found.')
    ).toBeInTheDocument();
  });
});
