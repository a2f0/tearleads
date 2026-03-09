import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Compliance } from './Compliance';

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location-path">{location.pathname}</div>;
}

describe('Compliance', () => {
  it('renders known framework launch tiles', () => {
    render(
      <MemoryRouter initialEntries={['/compliance']}>
        <Routes>
          <Route path="/compliance" element={<Compliance />} />
          <Route
            path="/compliance/:framework/*"
            element={<div>Framework Page</div>}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(
      screen.getByRole('heading', { name: 'Compliance' })
    ).toBeInTheDocument();
    expect(screen.getByText('SOC 2')).toBeInTheDocument();
    expect(screen.getByText('HIPAA')).toBeInTheDocument();
    expect(screen.getByText('NIST SP 800-53')).toBeInTheDocument();
  });

  it('navigates to the selected framework', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/compliance']}>
        <Routes>
          <Route path="/compliance" element={<Compliance />} />
          <Route
            path="/compliance/:framework/*"
            element={<div>Framework Page</div>}
          />
        </Routes>
        <LocationDisplay />
      </MemoryRouter>
    );

    await user.click(screen.getByText('SOC 2'));

    expect(screen.getByTestId('location-path')).toHaveTextContent(
      '/compliance/SOC2'
    );
  });
});
