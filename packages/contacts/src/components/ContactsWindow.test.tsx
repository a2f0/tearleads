import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as contactsHooks from '../hooks';
import * as useContactsModule from '../hooks/useContacts';
import { TestContactsProvider } from '../test/testUtils';
import { ContactsWindow } from './ContactsWindow';
import * as contactDetailHooks from './contact-detail';

const mockUseContactGroups = vi.fn();
const mockUseContacts = vi.fn();
const mockUseVirtualizer = vi.fn();
const mockUseContactDetailData = vi.fn();
const mockUseContactDetailForm = vi.fn();

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (...args: unknown[]) => mockUseVirtualizer(...args)
}));

describe('ContactsWindow', () => {
  const defaultProps = {
    id: 'test-contacts-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  beforeEach(() => {
    vi.spyOn(contactsHooks, 'useContactGroups').mockImplementation(() =>
      mockUseContactGroups()
    );
    vi.spyOn(useContactsModule, 'useContacts').mockImplementation((...args) =>
      mockUseContacts(...args)
    );
    vi.spyOn(contactDetailHooks, 'useContactDetailData').mockImplementation(
      (...args) => mockUseContactDetailData(...args)
    );
    vi.spyOn(contactDetailHooks, 'useContactDetailForm').mockImplementation(
      (...args) => mockUseContactDetailForm(...args)
    );

    mockUseContactGroups.mockReset();
    mockUseContacts.mockReset();
    mockUseVirtualizer.mockReset();
    mockUseContactDetailData.mockReset();
    mockUseContactDetailForm.mockReset();

    mockUseContactGroups.mockReturnValue({
      groups: [],
      loading: false,
      error: null,
      hasFetched: true,
      refetch: vi.fn(),
      createGroup: vi.fn(),
      renameGroup: vi.fn(),
      deleteGroup: vi.fn()
    });
    mockUseVirtualizer.mockReturnValue({
      getVirtualItems: () => [{ index: 0, start: 0 }],
      getTotalSize: () => 56,
      measureElement: vi.fn()
    });
    mockUseContacts.mockImplementation(() => ({
      contactsList: [
        {
          id: 'contact-1',
          firstName: 'Ada',
          lastName: 'Lovelace',
          primaryEmail: 'ada@example.com',
          primaryPhone: null
        }
      ],
      loading: false,
      error: null,
      hasFetched: true,
      fetchContacts: vi.fn(),
      setHasFetched: vi.fn()
    }));
    mockUseContactDetailData.mockReturnValue({
      contact: {
        id: 'contact-1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        birthday: null,
        createdAt: new Date('2026-03-09T00:00:00.000Z'),
        updatedAt: new Date('2026-03-09T00:00:00.000Z')
      },
      emails: [],
      phones: [],
      loading: false,
      error: null,
      setError: vi.fn(),
      fetchContact: vi.fn()
    });
    mockUseContactDetailForm.mockReturnValue({
      isEditing: false,
      formData: null,
      emailsForm: [],
      phonesForm: [],
      saving: false,
      deleting: false,
      handleEditClick: vi.fn(),
      handleCancel: vi.fn(),
      handleFormChange: vi.fn(),
      handleEmailChange: vi.fn(),
      handleEmailPrimaryChange: vi.fn(),
      handleDeleteEmail: vi.fn(),
      handleAddEmail: vi.fn(),
      handlePhoneChange: vi.fn(),
      handlePhonePrimaryChange: vi.fn(),
      handleDeletePhone: vi.fn(),
      handleAddPhone: vi.fn(),
      handleSave: vi.fn(),
      handleDelete: vi.fn()
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderWindow({ isUnlocked = true }: { isUnlocked?: boolean } = {}) {
    return render(
      <TestContactsProvider databaseState={{ isUnlocked }}>
        <ContactsWindow {...defaultProps} />
      </TestContactsProvider>
    );
  }

  it('renders control bar list actions when unlocked', () => {
    renderWindow();

    expect(
      screen.getByTestId('contacts-window-control-new')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('contacts-window-control-import')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('contacts-window-control-refresh')
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('contacts-window-control-back')
    ).not.toBeInTheDocument();
  });

  it('opens create view from control bar and returns with control back', async () => {
    const user = userEvent.setup();
    renderWindow();

    await user.click(screen.getByTestId('contacts-window-control-new'));

    expect(screen.getByTestId('window-new-contact-back')).toBeInTheDocument();
    expect(
      screen.getByTestId('contacts-window-control-back')
    ).toBeInTheDocument();

    await user.click(screen.getByTestId('contacts-window-control-back'));

    expect(
      screen.queryByTestId('window-new-contact-back')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('window-contacts-search')).toBeInTheDocument();
    expect(
      screen.queryByTestId('contacts-window-control-back')
    ).not.toBeInTheDocument();
  });

  it('opens the file picker from control bar import action', async () => {
    const user = userEvent.setup();
    renderWindow();

    const fileInput = screen.getByTestId('contacts-import-input');
    const clickSpy = vi.spyOn(fileInput, 'click');

    await user.click(screen.getByTestId('contacts-window-control-import'));

    expect(clickSpy).toHaveBeenCalled();
  });

  it('disables control bar import action when database is locked', () => {
    renderWindow({ isUnlocked: false });

    expect(
      screen.queryByTestId('contacts-window-control-import')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('menuitem-importCsv')).toBeDisabled();
  });

  it('refreshes list view from control bar refresh action', async () => {
    const user = userEvent.setup();
    renderWindow();

    expect(mockUseContacts).toHaveBeenCalledWith({
      groupId: undefined,
      refreshToken: 0
    });

    await user.click(screen.getByTestId('contacts-window-control-refresh'));

    await waitFor(() => {
      expect(mockUseContacts).toHaveBeenCalledWith({
        groupId: undefined,
        refreshToken: 1
      });
    });
  });

  it('returns from detail view using control bar back action', async () => {
    const user = userEvent.setup();
    renderWindow();

    await user.click(screen.getByText('Ada Lovelace'));

    expect(screen.getByTestId('window-contact-edit')).toBeInTheDocument();
    expect(
      screen.getByTestId('contacts-window-control-back')
    ).toBeInTheDocument();

    await user.click(screen.getByTestId('contacts-window-control-back'));

    expect(screen.queryByTestId('window-contact-edit')).not.toBeInTheDocument();
    expect(screen.getByTestId('window-contacts-search')).toBeInTheDocument();
  });
});
