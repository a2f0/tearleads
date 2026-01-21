import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactsWindowImport } from './ContactsWindowImport';

const mockParseFile = vi.fn();
const mockImportContacts = vi.fn();

vi.mock('@/hooks/useContactsImport', () => ({
  useContactsImport: () => ({
    parseFile: mockParseFile,
    importContacts: mockImportContacts,
    importing: false,
    progress: 0
  })
}));

const mockDatabaseContext = { isUnlocked: true, isLoading: false };

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockDatabaseContext
}));

vi.mock('@/components/contacts/column-mapper', () => ({
  ColumnMapper: ({
    onImport,
    onCancel
  }: {
    onImport: (mapping: {
      firstName: number | null;
      lastName: number | null;
      email1Label: number | null;
      email1Value: number | null;
      email2Label: number | null;
      email2Value: number | null;
      phone1Label: number | null;
      phone1Value: number | null;
      phone2Label: number | null;
      phone2Value: number | null;
      phone3Label: number | null;
      phone3Value: number | null;
      birthday: number | null;
    }) => void;
    onCancel: () => void;
  }) => (
    <div data-testid="column-mapper">
      <button
        type="button"
        onClick={() =>
          onImport({
            firstName: 0,
            lastName: 1,
            email1Label: null,
            email1Value: null,
            email2Label: null,
            email2Value: null,
            phone1Label: null,
            phone1Value: null,
            phone2Label: null,
            phone2Value: null,
            phone3Label: null,
            phone3Value: null,
            birthday: null
          })
        }
        data-testid="mapper-import"
      >
        Import
      </button>
      <button type="button" onClick={onCancel} data-testid="mapper-cancel">
        Cancel
      </button>
    </div>
  )
}));

vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">{description}</div>
  )
}));

describe('ContactsWindowImport', () => {
  const file = new File(['First Name,Last Name\nJohn,Doe'], 'contacts.csv', {
    type: 'text/csv'
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabaseContext.isUnlocked = true;
    mockDatabaseContext.isLoading = false;
  });

  it('renders the column mapper after parsing a file', async () => {
    mockParseFile.mockResolvedValue({
      headers: ['First Name', 'Last Name'],
      rows: [['John', 'Doe']]
    });

    render(
      <ContactsWindowImport file={file} onDone={vi.fn()} onImported={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('column-mapper')).toBeInTheDocument();
    });
  });

  it('shows an error when the CSV has no headers', async () => {
    mockParseFile.mockResolvedValue({ headers: [], rows: [] });

    render(
      <ContactsWindowImport file={file} onDone={vi.fn()} onImported={vi.fn()} />
    );

    await waitFor(() => {
      expect(
        screen.getByText('CSV file is empty or has no headers')
      ).toBeInTheDocument();
    });
  });

  it('clears mapping state when cancel is clicked', async () => {
    const user = userEvent.setup();
    mockParseFile.mockResolvedValue({
      headers: ['First Name'],
      rows: [['John']]
    });

    render(
      <ContactsWindowImport file={file} onDone={vi.fn()} onImported={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('column-mapper')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('mapper-cancel'));

    expect(
      screen.getByText('Choose File > Import CSV to select a file.')
    ).toBeInTheDocument();
  });

  it('shows an error when parsing fails', async () => {
    mockParseFile.mockRejectedValue(new Error('Parse failed'));

    render(
      <ContactsWindowImport file={file} onDone={vi.fn()} onImported={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText('Parse failed')).toBeInTheDocument();
    });
  });

  it('does not call onImported when no contacts are imported', async () => {
    const user = userEvent.setup();
    const onImported = vi.fn();

    mockParseFile.mockResolvedValue({
      headers: ['First Name'],
      rows: [['John']]
    });
    mockImportContacts.mockResolvedValue({
      total: 1,
      imported: 0,
      skipped: 1,
      errors: []
    });

    render(
      <ContactsWindowImport
        file={file}
        onDone={vi.fn()}
        onImported={onImported}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('column-mapper')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('mapper-import'));

    await waitFor(() => {
      const matches = screen.getAllByText(
        (_content, node) =>
          node?.textContent === 'Imported 0 contacts, skipped 1'
      );
      expect(matches.length).toBeGreaterThan(0);
    });
    expect(onImported).not.toHaveBeenCalled();
  });

  it('shows an error when import fails', async () => {
    const user = userEvent.setup();

    mockParseFile.mockResolvedValue({
      headers: ['First Name'],
      rows: [['John']]
    });
    mockImportContacts.mockRejectedValue(new Error('Import failed'));

    render(
      <ContactsWindowImport file={file} onDone={vi.fn()} onImported={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('column-mapper')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('mapper-import'));

    await waitFor(() => {
      expect(screen.getByText('Import failed')).toBeInTheDocument();
    });
  });

  it('renders import errors when provided', async () => {
    const user = userEvent.setup();

    mockParseFile.mockResolvedValue({
      headers: ['First Name'],
      rows: [['John']]
    });
    mockImportContacts.mockResolvedValue({
      total: 1,
      imported: 0,
      skipped: 1,
      errors: ['Row 1 missing name']
    });

    render(
      <ContactsWindowImport file={file} onDone={vi.fn()} onImported={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('column-mapper')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('mapper-import'));

    await waitFor(() => {
      expect(screen.getByText('Row 1 missing name')).toBeInTheDocument();
    });
  });

  it('shows a summary when multiple errors occur', async () => {
    const user = userEvent.setup();

    mockParseFile.mockResolvedValue({
      headers: ['First Name'],
      rows: [['John']]
    });
    mockImportContacts.mockResolvedValue({
      total: 1,
      imported: 0,
      skipped: 1,
      errors: ['Error 1', 'Error 2', 'Error 3', 'Error 4', 'Error 5', 'Error 6']
    });

    render(
      <ContactsWindowImport file={file} onDone={vi.fn()} onImported={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('column-mapper')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('mapper-import'));

    await waitFor(() => {
      expect(screen.getByText('...and 1 more')).toBeInTheDocument();
    });
  });

  it('skips parsing when database is locked', async () => {
    mockDatabaseContext.isUnlocked = false;
    mockParseFile.mockResolvedValue({
      headers: ['First Name'],
      rows: [['John']]
    });

    render(
      <ContactsWindowImport file={file} onDone={vi.fn()} onImported={vi.fn()} />
    );

    await waitFor(() => {
      expect(mockParseFile).not.toHaveBeenCalled();
    });
  });

  it('calls onDone when Done is clicked', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();

    mockParseFile.mockResolvedValue({
      headers: ['First Name'],
      rows: [['John']]
    });

    render(
      <ContactsWindowImport file={file} onDone={onDone} onImported={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('column-mapper')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('calls onImported after a successful import', async () => {
    const user = userEvent.setup();
    const onImported = vi.fn();

    mockParseFile.mockResolvedValue({
      headers: ['First Name'],
      rows: [['John']]
    });
    mockImportContacts.mockResolvedValue({
      total: 1,
      imported: 1,
      skipped: 0,
      errors: []
    });

    render(
      <ContactsWindowImport
        file={file}
        onDone={vi.fn()}
        onImported={onImported}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('column-mapper')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('mapper-import'));

    await waitFor(() => {
      expect(onImported).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('Imported 1 contact')).toBeInTheDocument();
  });
});
