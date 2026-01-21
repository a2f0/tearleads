import { eq } from 'drizzle-orm';
import {
  ChevronDown,
  ChevronUp,
  Info,
  Loader2,
  Mail,
  Phone,
  Plus,
  Trash2,
  User
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import { RefreshButton } from '@/components/ui/refresh-button';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { contacts as contactsTable } from '@/db/schema';
import {
  type ContactInfo,
  type SortColumn,
  type SortDirection,
  useContacts
} from '@/hooks/useContacts';
import { useTypedTranslation } from '@/i18n';

interface ContactsWindowTableViewProps {
  onSelectContact: (contactId: string) => void;
  onCreateContact: () => void;
  refreshToken?: number;
}

interface SortHeaderProps {
  column: SortColumn;
  label: string;
  currentColumn: SortColumn;
  direction: SortDirection;
  onClick: (column: SortColumn) => void;
}

function SortHeader({
  column,
  label,
  currentColumn,
  direction,
  onClick
}: SortHeaderProps) {
  const isActive = column === currentColumn;

  return (
    <button
      type="button"
      className="flex items-center gap-1 text-left font-medium hover:text-foreground"
      onClick={() => onClick(column)}
    >
      {label}
      {isActive && (
        <span className="shrink-0">
          {direction === 'asc' ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </span>
      )}
    </button>
  );
}

export function ContactsWindowTableView({
  onSelectContact,
  onCreateContact,
  refreshToken
}: ContactsWindowTableViewProps) {
  const { isUnlocked, isLoading } = useDatabaseContext();
  const { t } = useTypedTranslation('contextMenu');
  const [sortColumn, setSortColumn] = useState<SortColumn>('firstName');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const {
    contactsList,
    loading,
    error,
    hasFetched,
    fetchContacts,
    setHasFetched
  } = useContacts({ refreshToken, sortColumn, sortDirection });
  const [contextMenu, setContextMenu] = useState<{
    contact: ContactInfo;
    x: number;
    y: number;
  } | null>(null);

  const handleSortChange = useCallback(
    (column: SortColumn) => {
      setSortColumn((prevColumn) => {
        if (prevColumn === column) {
          setSortDirection((prevDir) => (prevDir === 'asc' ? 'desc' : 'asc'));
          return prevColumn;
        }
        setSortDirection('asc');
        return column;
      });
      setHasFetched(false);
    },
    [setHasFetched]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, contact: ContactInfo) => {
      e.preventDefault();
      setContextMenu({ contact, x: e.clientX, y: e.clientY });
    },
    []
  );

  const handleGetInfo = useCallback(() => {
    if (contextMenu) {
      onSelectContact(contextMenu.contact.id);
      setContextMenu(null);
    }
  }, [contextMenu, onSelectContact]);

  const handleDelete = useCallback(async () => {
    if (!contextMenu) return;

    try {
      const db = getDatabase();
      await db
        .update(contactsTable)
        .set({ deleted: true, updatedAt: new Date() })
        .where(eq(contactsTable.id, contextMenu.contact.id));

      setHasFetched(false);
    } catch (err) {
      console.error('Failed to delete contact:', err);
    } finally {
      setContextMenu(null);
    }
  }, [contextMenu, setHasFetched]);

  const getDisplayName = (contact: ContactInfo) => {
    return `${contact.firstName}${contact.lastName ? ` ${contact.lastName}` : ''}`;
  };

  return (
    <div className="flex h-full flex-col space-y-2 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <User className="h-5 w-5 text-muted-foreground" />
          <h2 className="font-semibold text-sm">Contacts</h2>
        </div>
        {isUnlocked && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onCreateContact}
              className="h-7 px-2"
              data-testid="table-create-contact-button"
            >
              <Plus className="h-4 w-4" />
            </Button>
            <RefreshButton
              onClick={fetchContacts}
              loading={loading}
              size="sm"
            />
          </div>
        )}
      </div>

      {isLoading && (
        <div className="rounded-lg border p-4 text-center text-muted-foreground text-xs">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && <InlineUnlock description="contacts" />}

      {error && (
        <div className="whitespace-pre-line rounded-lg border border-destructive bg-destructive/10 p-2 text-destructive text-xs">
          {error}
        </div>
      )}

      {isUnlocked &&
        !error &&
        (loading && !hasFetched ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border p-4 text-muted-foreground text-xs">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading contacts...
          </div>
        ) : contactsList.length === 0 && hasFetched ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border p-6 text-center">
            <User className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="font-medium text-sm">No contacts yet</p>
              <p className="text-muted-foreground text-xs">
                Create your first contact
              </p>
            </div>
            <Button
              size="sm"
              onClick={onCreateContact}
              data-testid="table-empty-create-contact"
            >
              <Plus className="mr-1 h-3 w-3" />
              Create
            </Button>
          </div>
        ) : (
          <div className="flex-1 overflow-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left">
                    <SortHeader
                      column="firstName"
                      label="Name"
                      currentColumn={sortColumn}
                      direction={sortDirection}
                      onClick={handleSortChange}
                    />
                  </th>
                  <th className="px-2 py-1.5 text-left">
                    <SortHeader
                      column="primaryEmail"
                      label="Email"
                      currentColumn={sortColumn}
                      direction={sortDirection}
                      onClick={handleSortChange}
                    />
                  </th>
                  <th className="px-2 py-1.5 text-left">Phone</th>
                </tr>
              </thead>
              <tbody>
                {contactsList.map((contact) => (
                  <tr
                    key={contact.id}
                    className="cursor-pointer border-border/50 border-b hover:bg-accent/50"
                    onClick={() => onSelectContact(contact.id)}
                    onContextMenu={(e) => handleContextMenu(e, contact)}
                  >
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <User className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">
                          {getDisplayName(contact)}
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {contact.primaryEmail && (
                        <span className="flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          <span className="truncate">
                            {contact.primaryEmail}
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {contact.primaryPhone && (
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {contact.primaryPhone}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        >
          <ContextMenuItem
            icon={<Info className="h-4 w-4" />}
            onClick={handleGetInfo}
          >
            {t('getInfo')}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Trash2 className="h-4 w-4" />}
            onClick={handleDelete}
          >
            {t('delete')}
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}
