import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Help } from './Help';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

describe('Help', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
  });

  it('renders top-level options', () => {
    render(
      <MemoryRouter>
        <Help />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();
    expect(screen.getByText('API Docs')).toBeInTheDocument();
    expect(screen.getByText('Developer')).toBeInTheDocument();
    expect(screen.getByText('Legal')).toBeInTheDocument();
  });

  it('navigates to API docs', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Help />
      </MemoryRouter>
    );

    await user.click(screen.getByText('API Docs'));
    expect(mockNavigate).toHaveBeenCalledWith('/help/api');
  });

  it('shows developer docs and navigates to a doc', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Help />
      </MemoryRouter>
    );

    await user.click(screen.getByText('Developer'));
    await user.click(screen.getByText('CLI Reference'));
    expect(mockNavigate).toHaveBeenCalledWith('/help/docs/cli-reference');
  });

  it('shows legal docs and can return to top-level', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Help />
      </MemoryRouter>
    );

    await user.click(screen.getByText('Legal'));
    expect(screen.getByText('Privacy Policy')).toBeInTheDocument();
    await user.click(screen.getByText('Back to Help'));
    expect(screen.getByText('Developer')).toBeInTheDocument();
  });
});
