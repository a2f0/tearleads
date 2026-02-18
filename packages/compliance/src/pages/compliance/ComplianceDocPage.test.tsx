import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ComplianceDocPage } from './ComplianceDocPage';

vi.mock('@tearleads/ui', async () => {
  const actual = await vi.importActual('@tearleads/ui');
  return {
    ...actual,
    useTheme: () => ({ resolvedTheme: 'light' })
  };
});

vi.mock('@tearleads/backups', () => ({
  MarkdownWithToc: ({
    source,
    linkComponent
  }: {
    source: string;
    linkComponent?: (
      props: AnchorHTMLAttributes<HTMLAnchorElement>
    ) => ReactNode;
  }) => (
    <div>
      <div data-testid="markdown-preview">{source.slice(0, 24)}</div>
      {linkComponent?.({
        href: './policies/01-account-management-policy.md',
        children: 'Policy Link'
      })}
    </div>
  )
}));

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location-path">{location.pathname}</div>;
}

describe('ComplianceDocPage', () => {
  it('renders framework documentation and sidebar docs', () => {
    render(
      <MemoryRouter initialEntries={['/compliance/SOC2']}>
        <Routes>
          <Route
            path="/compliance/:framework/*"
            element={<ComplianceDocPage />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'SOC 2' })).toBeInTheDocument();
    expect(screen.getByText('Policy Index')).toBeInTheDocument();
    expect(screen.getByTestId('markdown-preview')).toBeInTheDocument();
  });

  it('navigates internal markdown links without full reload', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/compliance/SOC2']}>
        <Routes>
          <Route
            path="/compliance/:framework/*"
            element={<ComplianceDocPage />}
          />
        </Routes>
        <LocationDisplay />
      </MemoryRouter>
    );

    await user.click(screen.getByText('Policy Link'));

    expect(screen.getByTestId('location-path')).toHaveTextContent(
      '/compliance/SOC2/policies/01-account-management-policy.md'
    );
  });

  it('renders not found state for unknown framework', () => {
    render(
      <MemoryRouter initialEntries={['/compliance/UNKNOWN']}>
        <Routes>
          <Route
            path="/compliance/:framework/*"
            element={<ComplianceDocPage />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(
      screen.getByText('This compliance framework was not found.')
    ).toBeInTheDocument();
  });

  it('renders document not found state for unknown document path', () => {
    render(
      <MemoryRouter initialEntries={['/compliance/SOC2/not-a-real-doc.md']}>
        <Routes>
          <Route
            path="/compliance/:framework/*"
            element={<ComplianceDocPage />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Document Not Found')).toBeInTheDocument();
  });
});
