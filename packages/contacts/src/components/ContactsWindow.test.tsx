import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactsWindow } from './ContactsWindow';

const mockUseContactsContext = vi.fn();
const mockLinkContactsToGroup = vi.fn();

vi.mock('@tearleads/window-manager', () => ({
  FloatingWindow: ({
    children,
    title
  }: {
    children: ReactNode;
    title: string;
  }) => (
    <div data-testid="floating-window">
      <div data-testid="window-title">{title}</div>
      {children}
    </div>
  ),
  WindowControlBar: ({ children }: { children: ReactNode }) => (
    <div data-testid="control-bar">{children}</div>
  ),
  WindowControlGroup: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  useWindowRefresh: () => {
    const [refreshToken, setRefreshToken] = React.useState(0);
    const triggerRefresh = () => {
      setRefreshToken((value) => value + 1);
    };
    return { refreshToken, triggerRefresh };
  },
  WindowControlButton: ({
    children,
    onClick,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  )
}));

vi.mock('../context', () => ({
  useContactsContext: () => mockUseContactsContext()
}));

vi.mock('../lib/linkContactsToGroup', () => ({
  linkContactsToGroup: (db: unknown, groupId: string, contactIds: string[]) =>
    mockLinkContactsToGroup(db, groupId, contactIds)
}));

vi.mock('./ContactsWindowContent', () => ({
  ALL_CONTACTS_ID: '__all__',
  ContactsWindowContent: ({
    controlBar,
    children
  }: {
    controlBar?: ReactNode;
    children: ReactNode;
  }) => (
    <div data-testid="contacts-window-content-shell">
      {controlBar}
      {children}
    </div>
  )
}));

vi.mock('./ContactsWindowList', () => ({
  ContactsWindowList: ({
    onSelectContact,
    refreshToken
  }: {
    onSelectContact: (contactId: string) => void;
    refreshToken: number;
  }) => (
    <div data-testid="contacts-list">
      <span data-testid="contacts-refresh-token">{refreshToken}</span>
      <button
        type="button"
        data-testid="select-contact"
        onClick={() => onSelectContact('contact-1')}
      >
        Select Contact
      </button>
    </div>
  )
}));

vi.mock('./ContactsWindowTableView', () => ({
  ContactsWindowTableView: () => <div data-testid="contacts-table-view" />
}));

vi.mock('./ContactsWindowDetail', () => ({
  ContactsWindowDetail: ({
    contactId
  }: {
    contactId: string;
    onDeleted: () => void;
  }) => (
    <div data-testid="contacts-detail">
      <span data-testid="contact-id">{contactId}</span>
    </div>
  )
}));

vi.mock('./ContactsWindowNew', () => ({
  ContactsWindowNew: ({
    onBack
  }: {
    onBack: () => void;
    onCreated: () => void;
  }) => (
    <div data-testid="contacts-new">
      <button type="button" data-testid="new-back" onClick={onBack}>
        Back
      </button>
    </div>
  )
}));

vi.mock('./ContactsWindowImport', () => ({
  ContactsWindowImport: ({
    file
  }: {
    file: File | null;
    onDone: () => void;
    onImported: () => void;
  }) => <div data-testid="contacts-import-view">{file?.name ?? 'no-file'}</div>
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
    vi.clearAllMocks();
    mockLinkContactsToGroup.mockResolvedValue(0);
    mockUseContactsContext.mockReturnValue({
      databaseState: { isUnlocked: true },
      getDatabase: vi.fn(() => ({}))
    });
  });

  it('renders control bar list actions when unlocked', () => {
    render(<ContactsWindow {...defaultProps} />);

    expect(screen.getByTestId('control-bar')).toBeInTheDocument();
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
    render(<ContactsWindow {...defaultProps} />);

    await user.click(screen.getByTestId('contacts-window-control-new'));

    expect(screen.getByTestId('contacts-new')).toBeInTheDocument();
    expect(
      screen.getByTestId('contacts-window-control-back')
    ).toBeInTheDocument();

    await user.click(screen.getByTestId('contacts-window-control-back'));

    expect(screen.getByTestId('contacts-list')).toBeInTheDocument();
    expect(
      screen.queryByTestId('contacts-window-control-back')
    ).not.toBeInTheDocument();
  });

  it('opens the file picker from control bar import action', async () => {
    const user = userEvent.setup();
    render(<ContactsWindow {...defaultProps} />);

    const fileInput = screen.getByTestId('contacts-import-input');
    const clickSpy = vi.spyOn(fileInput, 'click');

    await user.click(screen.getByTestId('contacts-window-control-import'));

    expect(clickSpy).toHaveBeenCalled();
  });

  it('disables control bar import action when database is locked', () => {
    mockUseContactsContext.mockReturnValue({
      databaseState: { isUnlocked: false },
      getDatabase: vi.fn(() => ({}))
    });

    render(<ContactsWindow {...defaultProps} />);

    expect(screen.getByTestId('contacts-window-control-import')).toBeDisabled();
  });

  it('refreshes list view from control bar refresh action', async () => {
    const user = userEvent.setup();
    render(<ContactsWindow {...defaultProps} />);

    expect(screen.getByTestId('contacts-refresh-token')).toHaveTextContent('0');

    await user.click(screen.getByTestId('contacts-window-control-refresh'));

    expect(screen.getByTestId('contacts-refresh-token')).toHaveTextContent('1');
  });

  it('returns from detail view using control bar back action', async () => {
    const user = userEvent.setup();
    render(<ContactsWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-contact'));

    expect(screen.getByTestId('contacts-detail')).toBeInTheDocument();
    expect(
      screen.getByTestId('contacts-window-control-back')
    ).toBeInTheDocument();

    await user.click(screen.getByTestId('contacts-window-control-back'));

    expect(screen.queryByTestId('contacts-detail')).not.toBeInTheDocument();
    expect(screen.getByTestId('contacts-list')).toBeInTheDocument();
  });
});
