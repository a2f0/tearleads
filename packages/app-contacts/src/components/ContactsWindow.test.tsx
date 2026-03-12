import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as contactsHooks from '../hooks';
import * as useContactsModule from '../hooks/useContacts';
import { TestContactsProvider } from '../test/testUtils';
import { ContactsWindow } from './ContactsWindow';
import * as contactDetailHooks from './contact-detail';

vi.mock('@tearleads/ui', () => ({
  DropdownMenu: ({
    trigger,
    children
  }: {
    trigger: string;
    children: ReactNode;
  }) => (
    <div data-testid={`dropdown-${trigger}`}>
      <button type="button" data-testid={`trigger-${trigger}`}>
        {trigger}
      </button>
      <div data-testid={`menu-${trigger}`}>{children}</div>
    </div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
    checked,
    disabled
  }: {
    children: ReactNode;
    onClick?: () => void;
    checked?: boolean;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      onClick={onClick}
      data-checked={checked}
      disabled={disabled}
      data-testid={`menuitem-${children}`}
    >
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr data-testid="separator" />,
  WindowOptionsMenuItem: () => <div data-testid="window-options" />,
  AboutMenuItem: () => <div data-testid="about-menu-item" />
}));

const mockUseContactGroups = vi.fn();
const mockUseContacts = vi.fn();
const mockUseVirtualizer = vi.fn();
const mockUseContactDetailData = vi.fn();
const mockUseContactDetailForm = vi.fn();

function createMockContactGroupsState() {
  return {
    groups: [],
    loading: false,
    error: null,
    hasFetched: true,
    refetch: vi.fn(),
    createGroup: vi.fn(),
    renameGroup: vi.fn(),
    deleteGroup: vi.fn()
  };
}

function createMockVirtualizerState() {
  return {
    getVirtualItems: () => [{ index: 0, start: 0 }],
    getTotalSize: () => 56,
    measureElement: vi.fn()
  };
}

function createMockContactsState() {
  return {
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
  };
}

function createMockDetailDataState() {
  return {
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
  };
}

function createMockDetailFormState() {
  return {
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
  };
}

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

    mockUseContactGroups.mockReturnValue(createMockContactGroupsState());
    mockUseVirtualizer.mockReturnValue(createMockVirtualizerState());
    mockUseContacts.mockImplementation(() => createMockContactsState());
    mockUseContactDetailData.mockReturnValue(createMockDetailDataState());
    mockUseContactDetailForm.mockReturnValue(createMockDetailFormState());
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
