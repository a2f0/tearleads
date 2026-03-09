import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailContactOperations } from '../context';
import { installEmailWindowModuleMocks } from './emailWindowModuleMocks';
import { defaultProps, renderLoadedWindow, renderWithProvider } from './emailWindowTestUtils';
import { mockFolderOperations } from './emailWindowTestFixtures';

describe('EmailWindow compose and folders', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    installEmailWindowModuleMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens compose in the main panel tab', async () => {
    const user = userEvent.setup();
    await renderLoadedWindow();
    expect(screen.queryByTestId('compose-dialog')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('tab', { name: 'New Message' })
    ).not.toBeInTheDocument();
    await user.click(screen.getByTestId('compose'));
    expect(screen.getByTestId('compose-dialog')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'New Message' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByTestId('window-title')).toHaveTextContent('New Message');
    expect(screen.queryByText('Test Subject')).not.toBeInTheDocument();
  });

  it('opens compose with recipients from open request', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: [] })
    });
    renderWithProvider({
      ...defaultProps,
      openComposeRequest: {
        to: ['ada@example.com', 'grace@example.com'],
        requestId: 1
      }
    });
    expect(await screen.findByTestId('compose-dialog')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'New Message' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByTestId('compose-to')).toHaveValue(
      'ada@example.com, grace@example.com'
    );
  });

  it('closes compose tab from close button', async () => {
    const user = userEvent.setup();
    await renderLoadedWindow();
    await user.click(screen.getByTestId('compose'));
    expect(screen.getByTestId('compose-dialog')).toBeInTheDocument();
    await user.click(screen.getByTestId('compose-close'));
    expect(
      screen.queryByTestId('compose-dialog')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('tab', { name: 'New Message' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'All Mail' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByText('Test Subject')).toBeInTheDocument();
  });

  it('switches between inbox and compose tabs', async () => {
    const user = userEvent.setup();
    await renderLoadedWindow();
    await user.click(screen.getByTestId('compose'));
    await user.click(screen.getByRole('tab', { name: 'New Message' }));
    expect(screen.getByTestId('compose-dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'All Mail' }));
    expect(screen.queryByTestId('compose-dialog')).not.toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: 'New Message' })
    ).toBeInTheDocument();
    expect(screen.getByText('Test Subject')).toBeInTheDocument();
  });

  it('closes compose tab from tab close button', async () => {
    const user = userEvent.setup();
    await renderLoadedWindow();
    await user.click(screen.getByTestId('compose'));
    expect(
      screen.getByRole('tab', { name: 'New Message' })
    ).toBeInTheDocument();
    await user.click(screen.getByTestId('email-tab-compose-close'));
    expect(screen.queryByTestId('compose-dialog')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('tab', { name: 'New Message' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'All Mail' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('disables autofill for compose address fields', async () => {
    const user = userEvent.setup();
    await renderLoadedWindow();
    await user.click(screen.getByTestId('compose'));
    expect(screen.getByTestId('compose-to')).toHaveAttribute(
      'autocomplete',
      'off'
    );
    expect(screen.getByTestId('compose-cc')).toHaveAttribute(
      'autocomplete',
      'off'
    );
    expect(screen.getByTestId('compose-bcc')).toHaveAttribute(
      'autocomplete',
      'off'
    );
  });

  it('adds address-book contacts to recipient fields from compose', async () => {
    const user = userEvent.setup();
    const contactOperations: EmailContactOperations = {
      fetchContactEmails: vi.fn().mockResolvedValue([
        {
          contactId: 'contact-1',
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
          label: 'Work',
          isPrimary: true
        }
      ])
    };
    await renderLoadedWindow(defaultProps, { contactOperations });
    await user.click(screen.getByTestId('compose'));
    expect(screen.queryByTestId('address-book-picker')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('compose-to-address-book'));
    expect(await screen.findByTestId('address-book-picker')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: /add ada lovelace to to/i })
    );
    expect(screen.getByTestId('compose-to')).toHaveValue('ada@example.com');
    await user.click(
      screen.getByRole('button', { name: /add ada lovelace to cc/i })
    );
    expect(screen.getByTestId('compose-cc')).toHaveValue('ada@example.com');
    await user.click(
      screen.getByRole('button', { name: /add ada lovelace to bcc/i })
    );
    expect(screen.getByTestId('compose-bcc')).toHaveValue('ada@example.com');
    await user.click(screen.getByTestId('address-book-close'));
    expect(screen.queryByTestId('address-book-picker')).not.toBeInTheDocument();
  });

  it('switches right panel when selecting Sent folder', async () => {
    const user = userEvent.setup();
    await renderLoadedWindow(defaultProps, {
      folderOperations: mockFolderOperations
    });
    await user.click(screen.getByText('Sent'));
    expect(await screen.findByText('No emails in Sent')).toBeInTheDocument();
    expect(screen.getByTestId('window-title')).toHaveTextContent('Sent');
  });
});
