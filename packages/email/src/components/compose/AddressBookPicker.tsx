import { WINDOW_TABLE_TYPOGRAPHY, WindowTableRow } from '@rapid/window-manager';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { type EmailContactEmail, useEmailContext } from '../../context';

type RecipientField = 'to' | 'cc' | 'bcc';
type SortColumn = 'name' | 'email' | 'label' | 'isPrimary';
type SortDirection = 'asc' | 'desc';

interface AddressBookPickerProps {
  disabled?: boolean;
  onSelect: (field: RecipientField, email: string) => void;
}

const SEARCHABLE_SEPARATOR = ' ';

function compareBooleans(
  a: boolean,
  b: boolean,
  direction: SortDirection
): number {
  const aValue = a ? 1 : 0;
  const bValue = b ? 1 : 0;
  return direction === 'asc' ? aValue - bValue : bValue - aValue;
}

function compareStrings(
  a: string,
  b: string,
  direction: SortDirection
): number {
  const compared = a.localeCompare(b);
  return direction === 'asc' ? compared : -compared;
}

function getDisplayName(contact: EmailContactEmail): string {
  const first = contact.firstName.trim();
  const last = (contact.lastName ?? '').trim();
  const full = [first, last].filter((part) => part.length > 0).join(' ');
  return full.length > 0 ? full : '(No name)';
}

export function AddressBookPicker({
  disabled = false,
  onSelect
}: AddressBookPickerProps) {
  const { contactOperations } = useEmailContext();
  const [rows, setRows] = useState<EmailContactEmail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortColumn, setSortColumn] = useState<SortColumn>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  useEffect(() => {
    if (!contactOperations) return;

    let isMounted = true;

    const loadContactEmails = async () => {
      setLoading(true);
      setError(null);
      try {
        const contactEmails = await contactOperations.fetchContactEmails();
        if (isMounted) {
          setRows(contactEmails);
        }
      } catch (err) {
        if (isMounted) {
          setError(
            err instanceof Error ? err.message : 'Failed to load contacts'
          );
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadContactEmails();

    return () => {
      isMounted = false;
    };
  }, [contactOperations]);

  const visibleRows = useMemo(() => {
    const searchValue = search.trim().toLowerCase();

    const filtered = searchValue
      ? rows.filter((row) => {
          const searchableValue = [
            row.firstName,
            row.lastName ?? '',
            row.email,
            row.label ?? ''
          ]
            .join(SEARCHABLE_SEPARATOR)
            .toLowerCase();
          return searchableValue.includes(searchValue);
        })
      : rows;

    return [...filtered].sort((a, b) => {
      if (sortColumn === 'isPrimary') {
        return compareBooleans(a.isPrimary, b.isPrimary, sortDirection);
      }

      if (sortColumn === 'email') {
        return compareStrings(a.email, b.email, sortDirection);
      }

      if (sortColumn === 'label') {
        return compareStrings(a.label ?? '', b.label ?? '', sortDirection);
      }

      return compareStrings(
        getDisplayName(a),
        getDisplayName(b),
        sortDirection
      );
    });
  }, [rows, search, sortColumn, sortDirection]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortColumn(column);
    setSortDirection('asc');
  };

  const sortIcon = (column: SortColumn) => {
    if (sortColumn !== column) return null;
    return sortDirection === 'asc' ? (
      <ChevronUp className="h-3.5 w-3.5" />
    ) : (
      <ChevronDown className="h-3.5 w-3.5" />
    );
  };

  if (!contactOperations) {
    return null;
  }

  return (
    <section
      className="rounded-md border p-3"
      aria-label="Address Book"
      data-testid="address-book-picker"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-medium text-sm">Address Book</h3>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search contacts"
          aria-label="Search contacts"
          className="w-52 rounded-md border bg-background px-2 py-1 text-base focus:outline-none focus:ring-2 focus:ring-ring"
          disabled={disabled || loading}
          data-testid="address-book-search"
        />
      </div>

      {error && (
        <p
          className="mb-2 text-destructive text-sm"
          data-testid="address-error"
        >
          {error}
        </p>
      )}

      <div className="max-h-48 overflow-auto rounded border">
        <table className={WINDOW_TABLE_TYPOGRAPHY.table}>
          <thead className={WINDOW_TABLE_TYPOGRAPHY.header}>
            <tr>
              <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                <button
                  type="button"
                  onClick={() => handleSort('name')}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  disabled={disabled || loading}
                >
                  Name
                  {sortIcon('name')}
                </button>
              </th>
              <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                <button
                  type="button"
                  onClick={() => handleSort('email')}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  disabled={disabled || loading}
                >
                  Email
                  {sortIcon('email')}
                </button>
              </th>
              <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                <button
                  type="button"
                  onClick={() => handleSort('label')}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  disabled={disabled || loading}
                >
                  Label
                  {sortIcon('label')}
                </button>
              </th>
              <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                <button
                  type="button"
                  onClick={() => handleSort('isPrimary')}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  disabled={disabled || loading}
                >
                  Primary
                  {sortIcon('isPrimary')}
                </button>
              </th>
              <th
                className={`${WINDOW_TABLE_TYPOGRAPHY.headerCell} text-right`}
              >
                Add To
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <WindowTableRow
                key={`${row.contactId}:${row.email}`}
                className="cursor-default hover:bg-transparent last:border-b-0"
              >
                <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
                  {getDisplayName(row)}
                </td>
                <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>{row.email}</td>
                <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
                  {row.label ?? '-'}
                </td>
                <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
                  {row.isPrimary ? 'Yes' : 'No'}
                </td>
                <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => onSelect('to', row.email)}
                      className="rounded border px-1.5 py-0.5 text-xs hover:bg-accent disabled:opacity-50"
                      disabled={disabled || loading}
                      aria-label={`Add ${getDisplayName(row)} to To (${row.email})`}
                    >
                      To
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelect('cc', row.email)}
                      className="rounded border px-1.5 py-0.5 text-xs hover:bg-accent disabled:opacity-50"
                      disabled={disabled || loading}
                      aria-label={`Add ${getDisplayName(row)} to Cc (${row.email})`}
                    >
                      Cc
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelect('bcc', row.email)}
                      className="rounded border px-1.5 py-0.5 text-xs hover:bg-accent disabled:opacity-50"
                      disabled={disabled || loading}
                      aria-label={`Add ${getDisplayName(row)} to Bcc (${row.email})`}
                    >
                      Bcc
                    </button>
                  </div>
                </td>
              </WindowTableRow>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && visibleRows.length === 0 && (
        <p className="mt-2 text-muted-foreground text-xs">
          {rows.length === 0
            ? 'No contacts with email addresses.'
            : 'No matches.'}
        </p>
      )}
      {loading && (
        <p className="mt-2 text-muted-foreground text-xs">
          Loading contacts...
        </p>
      )}
    </section>
  );
}
