import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '../test/consoleMocks';
import { installEmailWindowModuleMocks } from '../test/emailWindowModuleMocks';
import {
  defaultProps,
  renderLoadedWindow,
  renderWithProvider
} from '../test/emailWindowTestUtils';
import {
  mockEmailLargeSize,
  mockEmailSmallSize
} from './emailWindowTestFixtures';

describe('EmailWindow navigation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    installEmailWindowModuleMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders with loading state initially', async () => {
    let resolveFetch:
      | ((value: { ok: true; json: () => Promise<{ emails: [] }> }) => void)
      | undefined;
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise<{ ok: true; json: () => Promise<{ emails: [] }> }>(
          (resolve) => {
            resolveFetch = resolve;
          }
        )
    );
    renderWithProvider();
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
    expect(screen.getByTestId('window-title')).toHaveTextContent('All Mail');
    if (!resolveFetch) throw new Error('Expected fetch resolver');
    resolveFetch({
      ok: true,
      json: async () => ({ emails: [] })
    });
    expect(await screen.findByText('No emails yet')).toBeInTheDocument();
  });

  it('displays emails after loading', async () => {
    await renderLoadedWindow();
    expect(screen.getByText('sender@example.com')).toBeInTheDocument();
  });

  it('displays empty state when no emails', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: [] })
    });
    renderWithProvider();
    expect(await screen.findByText('No emails yet')).toBeInTheDocument();
  });

  it('displays error state on fetch failure', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      statusText: 'Internal Server Error'
    });
    const consoleSpy = mockConsoleError();
    renderWithProvider();
    expect(
      await screen.findByText(/Failed to fetch emails/)
    ).toBeInTheDocument();
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to fetch emails:',
      expect.any(Error)
    );
  });

  it('calls onClose when close button clicked', async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: [] })
    });
    renderWithProvider();
    await user.click(screen.getByTestId('close-window'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('shows email detail view when email is clicked', async () => {
    const user = userEvent.setup();
    await renderLoadedWindow();
    await user.click(screen.getByText('Test Subject'));
    expect(
      await screen.findByTestId('email-window-control-back')
    ).toBeInTheDocument();
    expect(screen.getByText('From: sender@example.com')).toBeInTheDocument();
    expect(screen.getByText('To: recipient@example.com')).toBeInTheDocument();
    expect(screen.getByTestId('window-title')).toHaveTextContent('Email');
  });

  it('returns to list view when back button is clicked', async () => {
    const user = userEvent.setup();
    await renderLoadedWindow();
    await user.click(screen.getByText('Test Subject'));
    expect(
      await screen.findByTestId('email-window-control-back')
    ).toBeInTheDocument();
    await user.click(screen.getByTestId('email-window-control-back'));
    expect(await screen.findByText('Test Subject')).toBeInTheDocument();
    expect(
      screen.queryByTestId('email-window-control-back')
    ).not.toBeInTheDocument();
  });

  it('renders table view when view mode is switched', async () => {
    const user = userEvent.setup();
    await renderLoadedWindow();
    await user.click(screen.getByTestId('switch-to-table'));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Subject' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'From' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Date' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Size' })
    ).toBeInTheDocument();
  });

  it('displays email data in table view', async () => {
    const user = userEvent.setup();
    await renderLoadedWindow();
    await user.click(screen.getByTestId('switch-to-table'));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    const cells = screen.getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('Test Subject');
    expect(cells[1]).toHaveTextContent('sender@example.com');
  });

  it('displays size in MB for large files', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: [mockEmailLargeSize] })
    });
    renderWithProvider();
    expect(await screen.findByText('Large Email')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Large Email'));
    expect(await screen.findByText(/2\.0 MB/)).toBeInTheDocument();
  });

  it('displays size in bytes for small files', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: [mockEmailSmallSize] })
    });
    renderWithProvider();
    expect(await screen.findByText('Small Email')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Small Email'));
    expect(await screen.findByText(/500 B/)).toBeInTheDocument();
  });

  it('keeps menu bar when email is selected', async () => {
    const user = userEvent.setup();
    await renderLoadedWindow();
    await screen.findByText('Test Subject');
    await user.click(screen.getByText('Test Subject'));
    expect(await screen.findByTestId('menu-bar')).toBeInTheDocument();
  });

  it('renders control bar compose and refresh actions in list view', async () => {
    await renderLoadedWindow();
    expect(screen.getByTestId('control-bar')).toBeInTheDocument();
    expect(
      screen.getByTestId('email-window-control-compose')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('email-window-control-refresh')
    ).toBeInTheDocument();
  });

  it('opens compose from the control bar compose action', async () => {
    const user = userEvent.setup();
    await renderLoadedWindow();
    await user.click(screen.getByTestId('email-window-control-compose'));
    expect(screen.getByTestId('compose-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('window-title')).toHaveTextContent('New Message');
  });

  it('returns to list view from the control bar back action', async () => {
    const user = userEvent.setup();
    await renderLoadedWindow();
    await user.click(screen.getByTestId('email-window-control-compose'));
    expect(screen.getByTestId('compose-dialog')).toBeInTheDocument();
    await user.click(screen.getByTestId('email-window-control-close-compose'));
    expect(await screen.findByText('Test Subject')).toBeInTheDocument();
    expect(screen.getByTestId('window-title')).toHaveTextContent('All Mail');
  });
});
