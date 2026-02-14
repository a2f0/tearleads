import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Compliance } from './Compliance';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

describe('Compliance', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('renders known framework launch tiles', () => {
    render(
      <MemoryRouter>
        <Compliance />
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
      <MemoryRouter>
        <Compliance />
      </MemoryRouter>
    );

    await user.click(screen.getByText('SOC 2'));

    expect(mockNavigate).toHaveBeenCalledWith('/compliance/SOC2');
  });
});
