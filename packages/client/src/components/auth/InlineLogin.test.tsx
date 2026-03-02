// one-component-per-file: allow
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineLogin } from './InlineLogin';

const mockLogin = vi.fn();
const mockClearAuthError = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    authError: null,
    clearAuthError: mockClearAuthError,
    login: mockLogin
  })
}));

const mockOpenWindow = vi.fn();
vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowManagerActions: () => ({ openWindow: mockOpenWindow })
}));

const mockUseIsMobile = vi.fn();
vi.mock('@/hooks/device', () => ({
  useIsMobile: () => mockUseIsMobile()
}));

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

function renderWithRoutes() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<InlineLogin />} />
        <Route path="/sync" element={<div data-testid="sync-page" />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('InlineLogin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIsMobile.mockReturnValue(false);
  });

  it('renders with data-testid', () => {
    renderWithRouter(<InlineLogin />);

    expect(screen.getByTestId('inline-login')).toBeInTheDocument();
  });

  it('renders default description', () => {
    renderWithRouter(<InlineLogin />);

    expect(
      screen.getByText('Sign in required to access this feature.')
    ).toBeInTheDocument();
  });

  it('renders custom description', () => {
    renderWithRouter(<InlineLogin description="email" />);

    expect(
      screen.getByText('Sign in required to access email.')
    ).toBeInTheDocument();
  });

  it('renders login form', () => {
    renderWithRouter(<InlineLogin />);

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });

  it('passes custom description to login form', () => {
    renderWithRouter(<InlineLogin description="email" />);

    expect(
      screen.getByText('Please sign in to continue to email')
    ).toBeInTheDocument();
  });

  it('renders user icon', () => {
    renderWithRouter(<InlineLogin />);

    const icon = screen.getByTestId('inline-login').querySelector('svg');
    expect(icon).toBeInTheDocument();
  });

  it('renders outer card wrapper with border', () => {
    renderWithRouter(<InlineLogin />);

    const wrapper = screen.getByTestId('inline-login');
    expect(wrapper.className).toContain('rounded-lg');
    expect(wrapper.className).toContain('border');
    expect(wrapper.className).toContain('bg-background');
  });

  it('renders max-w-xs constraint on form wrapper', () => {
    renderWithRouter(<InlineLogin />);

    const wrapper = screen.getByTestId('inline-login');
    const formContainer = wrapper.querySelector('.max-w-xs');
    expect(formContainer).toBeInTheDocument();
  });

  it('renders "Create one" link', () => {
    renderWithRouter(<InlineLogin />);

    expect(
      screen.getByText("Don't have an account?", { exact: false })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Create one' })
    ).toBeInTheDocument();
  });

  it('opens sync window on desktop when "Create one" is clicked', async () => {
    const user = userEvent.setup();
    renderWithRoutes();

    await user.click(screen.getByRole('link', { name: 'Create one' }));
    expect(mockOpenWindow).toHaveBeenCalledWith('sync');
  });

  it('navigates to /sync on mobile when "Create one" is clicked', async () => {
    const user = userEvent.setup();
    mockUseIsMobile.mockReturnValue(true);
    renderWithRoutes();

    await user.click(screen.getByRole('link', { name: 'Create one' }));
    expect(mockOpenWindow).not.toHaveBeenCalled();
    expect(await screen.findByTestId('sync-page')).toBeInTheDocument();
  });
});
