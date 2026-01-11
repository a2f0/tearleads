import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Licenses } from './Licenses';

vi.mock('@rapid/shared/licenses.json', () => ({
  default: [
    { name: 'react', version: '19.0.0', license: 'MIT' },
    { name: 'typescript', version: '5.0.0', license: 'Apache-2.0' },
    { name: '@testing-library/react', version: '16.0.0', license: 'MIT' }
  ]
}));

function renderLicenses() {
  return render(
    <MemoryRouter>
      <Licenses />
    </MemoryRouter>
  );
}

describe('Licenses', () => {
  it('renders the page title', () => {
    renderLicenses();
    expect(screen.getByText('Open Source Licenses')).toBeInTheDocument();
  });

  it('renders the back link to settings', () => {
    renderLicenses();
    expect(screen.getByTestId('back-link')).toHaveTextContent(
      'Back to Settings'
    );
  });

  it('displays the package count', () => {
    renderLicenses();
    expect(
      screen.getByText('This app is built with 3 open source packages.')
    ).toBeInTheDocument();
  });

  it('renders all packages', () => {
    renderLicenses();
    expect(screen.getByText('react')).toBeInTheDocument();
    expect(screen.getByText('typescript')).toBeInTheDocument();
    expect(screen.getByText('@testing-library/react')).toBeInTheDocument();
  });

  it('displays version and license for each package', () => {
    renderLicenses();
    expect(screen.getByText('v19.0.0 - MIT')).toBeInTheDocument();
    expect(screen.getByText('v5.0.0 - Apache-2.0')).toBeInTheDocument();
    expect(screen.getByText('v16.0.0 - MIT')).toBeInTheDocument();
  });
});
