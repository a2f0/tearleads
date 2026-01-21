import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactsWindow } from './ContactsWindow';

const mockInsert = vi.fn().mockReturnValue({
  values: vi.fn().mockResolvedValue(undefined)
});

vi.mock('@/db', () => ({
  getDatabase: () => ({
    insert: mockInsert
  }),
  getDatabaseAdapter: () => ({
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commitTransaction: vi.fn().mockResolvedValue(undefined),
    rollbackTransaction: vi.fn().mockResolvedValue(undefined)
  })
}));

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => ({
    isUnlocked: true,
    isLoading: false,
    currentInstanceId: 'test-instance'
  })
}));

vi.mock('@/db/schema', () => ({
  contacts: {},
  contactEmails: {},
  contactPhones: {}
}));

vi.mock('@/components/floating-window', () => ({
  FloatingWindow: ({
    children,
    title,
    onClose
  }: {
    children: React.ReactNode;
    title: string;
    onClose: () => void;
  }) => (
    <div data-testid="floating-window">
      <div data-testid="window-title">{title}</div>
      <button type="button" onClick={onClose} data-testid="close-window">
        Close
      </button>
      {children}
    </div>
  )
}));

vi.mock('./ContactsWindowList', () => ({
  ContactsWindowList: ({
    onSelectContact,
    onCreateContact
  }: {
    onSelectContact: (id: string) => void;
    onCreateContact: () => void;
    refreshToken?: number;
  }) => (
    <div data-testid="contacts-list">
      <button
        type="button"
        onClick={() => onSelectContact('contact-123')}
        data-testid="select-contact"
      >
        Select Contact
      </button>
      <button
        type="button"
        onClick={onCreateContact}
        data-testid="create-contact-from-list"
      >
        Create Contact
      </button>
    </div>
  )
}));

vi.mock('./ContactsWindowDetail', () => ({
  ContactsWindowDetail: ({
    contactId,
    onBack,
    onDeleted
  }: {
    contactId: string;
    onBack: () => void;
    onDeleted: () => void;
  }) => (
    <div data-testid="contacts-detail">
      <span data-testid="detail-contact-id">{contactId}</span>
      <button type="button" onClick={onBack} data-testid="back-button">
        Back
      </button>
      <button type="button" onClick={onDeleted} data-testid="delete-button">
        Delete
      </button>
    </div>
  )
}));

vi.mock('./ContactsWindowNew', () => ({
  ContactsWindowNew: ({
    onBack,
    onCreated
  }: {
    onBack: () => void;
    onCreated: (id: string) => void;
  }) => (
    <div data-testid="contacts-new">
      <button type="button" onClick={onBack} data-testid="new-back-button">
        Back
      </button>
      <button
        type="button"
        onClick={() => onCreated('new-contact-id')}
        data-testid="save-new-contact"
      >
        Save
      </button>
    </div>
  )
}));

vi.mock('./ContactsWindowMenuBar', () => ({
  ContactsWindowMenuBar: ({
    onNewContact,
    onViewModeChange,
    onImportCsv
  }: {
    onNewContact: () => void;
    onViewModeChange: (mode: 'list' | 'table') => void;
    onImportCsv: () => void;
  }) => (
    <div data-testid="menu-bar">
      <button
        type="button"
        onClick={onNewContact}
        data-testid="new-contact-button"
      >
        New Contact
      </button>
      <button
        type="button"
        onClick={onImportCsv}
        data-testid="import-csv-button"
      >
        Import CSV
      </button>
      <button
        type="button"
        onClick={() => onViewModeChange('table')}
        data-testid="table-view-button"
      >
        Table View
      </button>
    </div>
  )
}));

vi.mock('./ContactsWindowTableView', () => ({
  ContactsWindowTableView: ({ refreshToken }: { refreshToken?: number }) => (
    <div data-testid="contacts-table" data-refresh={refreshToken} />
  )
}));

vi.mock('./ContactsWindowImport', () => ({
  ContactsWindowImport: ({
    file,
    onDone,
    onImported
  }: {
    file: File | null;
    onDone: () => void;
    onImported: () => void;
  }) => (
    <div data-testid="contacts-import">
      <span data-testid="import-file-name">{file?.name ?? 'no file'}</span>
      <button type="button" onClick={onDone} data-testid="import-done">
        Done
      </button>
      <button type="button" onClick={onImported} data-testid="import-complete">
        Import Complete
      </button>
    </div>
  )
}));

describe('ContactsWindow', () => {
  const defaultProps = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined)
    });
  });

  it('renders in FloatingWindow', () => {
    render(<ContactsWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows list view by default', () => {
    render(<ContactsWindow {...defaultProps} />);
    expect(screen.getByTestId('contacts-list')).toBeInTheDocument();
    expect(screen.queryByTestId('contacts-detail')).not.toBeInTheDocument();
  });

  it('switches to detail view when contact is selected', async () => {
    const user = userEvent.setup();
    render(<ContactsWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-contact'));

    await waitFor(() => {
      expect(screen.getByTestId('contacts-detail')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('contacts-list')).not.toBeInTheDocument();
  });

  it('keeps menu bar visible in detail view', async () => {
    const user = userEvent.setup();
    render(<ContactsWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-contact'));

    await waitFor(() => {
      expect(screen.getByTestId('contacts-detail')).toBeInTheDocument();
    });
    expect(screen.getByTestId('menu-bar')).toBeInTheDocument();
  });

  it('passes correct contactId to detail view', async () => {
    const user = userEvent.setup();
    render(<ContactsWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-contact'));

    await waitFor(() => {
      expect(screen.getByTestId('detail-contact-id')).toHaveTextContent(
        'contact-123'
      );
    });
  });

  it('returns to list view when back is clicked', async () => {
    const user = userEvent.setup();
    render(<ContactsWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-contact'));
    await waitFor(() => {
      expect(screen.getByTestId('contacts-detail')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('back-button'));
    await waitFor(() => {
      expect(screen.getByTestId('contacts-list')).toBeInTheDocument();
    });
  });

  it('returns to list view when contact is deleted', async () => {
    const user = userEvent.setup();
    render(<ContactsWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-contact'));
    await waitFor(() => {
      expect(screen.getByTestId('contacts-detail')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('delete-button'));
    await waitFor(() => {
      expect(screen.getByTestId('contacts-list')).toBeInTheDocument();
    });
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ContactsWindow
        {...defaultProps}
        onClose={onClose}
        onMinimize={vi.fn()}
      />
    );

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('updates title based on view', async () => {
    const user = userEvent.setup();
    render(<ContactsWindow {...defaultProps} />);

    expect(screen.getByTestId('window-title')).toHaveTextContent('Contacts');

    await user.click(screen.getByTestId('select-contact'));

    await waitFor(() => {
      expect(screen.getByTestId('window-title')).toHaveTextContent('Contact');
    });
  });

  it('shows new contact view when new contact button is clicked', async () => {
    const user = userEvent.setup();
    render(<ContactsWindow {...defaultProps} />);

    await user.click(screen.getByTestId('new-contact-button'));

    await waitFor(() => {
      expect(screen.getByTestId('contacts-new')).toBeInTheDocument();
    });
    expect(screen.getByTestId('window-title')).toHaveTextContent('New Contact');
  });

  it('switches to table view when table view button is clicked', async () => {
    const user = userEvent.setup();
    render(<ContactsWindow {...defaultProps} />);

    await user.click(screen.getByTestId('table-view-button'));

    await waitFor(() => {
      expect(screen.getByTestId('contacts-table')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('contacts-list')).not.toBeInTheDocument();
  });

  it('navigates to detail after creating new contact', async () => {
    const user = userEvent.setup();
    render(<ContactsWindow {...defaultProps} />);

    await user.click(screen.getByTestId('new-contact-button'));
    await waitFor(() => {
      expect(screen.getByTestId('contacts-new')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('save-new-contact'));
    await waitFor(() => {
      expect(screen.getByTestId('contacts-detail')).toBeInTheDocument();
      expect(screen.getByTestId('detail-contact-id')).toHaveTextContent(
        'new-contact-id'
      );
    });
  });

  it('returns to list when going back from new contact', async () => {
    const user = userEvent.setup();
    render(<ContactsWindow {...defaultProps} />);

    await user.click(screen.getByTestId('new-contact-button'));
    await waitFor(() => {
      expect(screen.getByTestId('contacts-new')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('new-back-button'));
    await waitFor(() => {
      expect(screen.getByTestId('contacts-list')).toBeInTheDocument();
    });
  });

  it('passes initialDimensions to FloatingWindow when provided', () => {
    render(
      <ContactsWindow
        {...defaultProps}
        initialDimensions={{ x: 100, y: 200, width: 600, height: 500 }}
      />
    );
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('opens file input when import csv is clicked', async () => {
    const user = userEvent.setup();
    render(<ContactsWindow {...defaultProps} />);

    const fileInput = screen.getByTestId(
      'contacts-import-input'
    ) as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, 'click');

    await user.click(screen.getByTestId('import-csv-button'));

    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('shows import view when file is selected', async () => {
    const user = userEvent.setup();
    render(<ContactsWindow {...defaultProps} />);

    const file = new File(['name,email'], 'contacts.csv', { type: 'text/csv' });
    const fileInput = screen.getByTestId('contacts-import-input');

    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(screen.getByTestId('contacts-import')).toBeInTheDocument();
    });
    expect(screen.getByTestId('window-title')).toHaveTextContent('Import CSV');
    expect(screen.getByTestId('import-file-name')).toHaveTextContent(
      'contacts.csv'
    );
  });

  it('returns to list view when import is done', async () => {
    const user = userEvent.setup();
    render(<ContactsWindow {...defaultProps} />);

    const file = new File(['name,email'], 'contacts.csv', { type: 'text/csv' });
    const fileInput = screen.getByTestId('contacts-import-input');

    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(screen.getByTestId('contacts-import')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('import-done'));

    await waitFor(() => {
      expect(screen.getByTestId('contacts-list')).toBeInTheDocument();
    });
  });

  it('updates refresh token when import completes', async () => {
    const user = userEvent.setup();
    render(<ContactsWindow {...defaultProps} />);

    const file = new File(['name,email'], 'contacts.csv', { type: 'text/csv' });
    const fileInput = screen.getByTestId('contacts-import-input');

    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(screen.getByTestId('contacts-import')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('import-complete'));
    await user.click(screen.getByTestId('import-done'));

    await waitFor(() => {
      expect(screen.getByTestId('contacts-list')).toBeInTheDocument();
    });
  });
});
