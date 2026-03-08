import '../../test/setupIntegration';

import {
  ALL_CONTACTS_ID,
  ContactsGroupsSidebar,
  useContactsContext
} from '@tearleads/contacts';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { and, eq, inArray } from 'drizzle-orm';
import { useCallback } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ClientContactsProvider } from '@/contexts/ClientContactsProvider';
import { getDatabase } from '@/db';
import { contactGroups, contacts, vfsLinks, vfsRegistry } from '@/db/schema';
import { renderWithDatabase } from '../../test/renderWithDatabase';
import { ContactsWindow } from './index';

vi.mock('@/contexts/OrgContext', () => ({
  useOrg: () => ({
    activeOrganizationId: null,
    organizations: [],
    setActiveOrganizationId: vi.fn(),
    isLoading: false
  })
}));

function ContactsSidebarDropHarness() {
  const { getDatabase: getContactsDatabase } = useContactsContext();

  const handleDropToGroup = useCallback(
    async (groupId: string, contactIds: string[]) => {
      const uniqueContactIds = Array.from(new Set(contactIds.filter(Boolean)));
      if (uniqueContactIds.length === 0) return;

      const db = getContactsDatabase();
      const existingLinks = await db
        .select({ childId: vfsLinks.childId })
        .from(vfsLinks)
        .where(
          and(
            eq(vfsLinks.parentId, groupId),
            inArray(vfsLinks.childId, uniqueContactIds)
          )
        );

      const existingChildIds = new Set(
        existingLinks.map((link) => link.childId)
      );
      const linksToInsert = uniqueContactIds
        .filter((contactId) => !existingChildIds.has(contactId))
        .map((contactId) => ({
          id: crypto.randomUUID(),
          parentId: groupId,
          childId: contactId,
          wrappedSessionKey: '',
          createdAt: new Date()
        }));

      if (linksToInsert.length === 0) return;
      await db.insert(vfsLinks).values(linksToInsert);
    },
    [getContactsDatabase]
  );

  return (
    <ContactsGroupsSidebar
      width={240}
      onWidthChange={() => {}}
      selectedGroupId={ALL_CONTACTS_ID}
      onGroupSelect={() => {}}
      onDropToGroup={handleDropToGroup}
    />
  );
}

describe('Contacts drag and drop integration', () => {
  it('adds dropped contact ids to a group in real database', async () => {
    await renderWithDatabase(
      <ClientContactsProvider>
        <ContactsSidebarDropHarness />
      </ClientContactsProvider>,
      {
        beforeRender: async () => {
          const db = getDatabase();
          const now = new Date();

          await db.insert(vfsRegistry).values([
            {
              id: 'group-1',
              objectType: 'contactGroup',
              ownerId: null,
              createdAt: now
            },
            {
              id: 'contact-1',
              objectType: 'contact',
              ownerId: null,
              createdAt: now
            }
          ]);

          await db.insert(contactGroups).values({
            id: 'group-1',
            encryptedName: 'Family',
            color: null,
            icon: null
          });

          await db.insert(contacts).values({
            id: 'contact-1',
            firstName: 'Jane',
            lastName: 'Doe',
            birthday: null,
            createdAt: now,
            updatedAt: now,
            deleted: false
          });
        }
      }
    );

    await waitFor(
      () => {
        expect(
          screen.getByRole('button', { name: /Family/i })
        ).toHaveTextContent('0');
      },
      { timeout: 4000 }
    );

    const groupButton = screen.getByRole('button', { name: /Family/i });
    const dataTransfer = {
      getData: (type: string) =>
        type === 'application/x-tearleads-contact-ids'
          ? JSON.stringify({ ids: ['contact-1'] })
          : ''
    };

    fireEvent.dragOver(groupButton, { dataTransfer });
    fireEvent.drop(groupButton, { dataTransfer });

    await waitFor(async () => {
      const db = getDatabase();
      const links = await db
        .select({ id: vfsLinks.id })
        .from(vfsLinks)
        .where(eq(vfsLinks.parentId, 'group-1'));
      expect(links).toHaveLength(1);
    });

    await waitFor(
      () => {
        expect(
          screen.getByRole('button', { name: /Family/i })
        ).toHaveTextContent('1');
      },
      { timeout: 4000 }
    );
  });

  it('updates table view when switching to a contact group', async () => {
    const user = userEvent.setup();

    await renderWithDatabase(
      <ContactsWindow
        id="contacts-window"
        onClose={() => {}}
        onMinimize={() => {}}
        onFocus={() => {}}
        zIndex={100}
      />,
      {
        beforeRender: async () => {
          const db = getDatabase();
          const now = new Date();

          await db.insert(vfsRegistry).values([
            {
              id: 'group-1',
              objectType: 'contactGroup',
              ownerId: null,
              createdAt: now
            },
            {
              id: 'contact-1',
              objectType: 'contact',
              ownerId: null,
              createdAt: now
            },
            {
              id: 'contact-2',
              objectType: 'contact',
              ownerId: null,
              createdAt: now
            }
          ]);

          await db.insert(contactGroups).values({
            id: 'group-1',
            encryptedName: 'Family',
            color: null,
            icon: null
          });

          await db.insert(contacts).values([
            {
              id: 'contact-1',
              firstName: 'Alice',
              lastName: 'Grouped',
              birthday: null,
              createdAt: now,
              updatedAt: now,
              deleted: false
            },
            {
              id: 'contact-2',
              firstName: 'Bob',
              lastName: 'Ungrouped',
              birthday: null,
              createdAt: now,
              updatedAt: now,
              deleted: false
            }
          ]);

          await db.insert(vfsLinks).values({
            id: 'link-1',
            parentId: 'group-1',
            childId: 'contact-1',
            wrappedSessionKey: '',
            createdAt: now
          });
        }
      }
    );

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Table' }));

    await waitFor(() => {
      expect(screen.getByText('Alice Grouped')).toBeInTheDocument();
      expect(screen.getByText('Bob Ungrouped')).toBeInTheDocument();
    });

    await user.click(
      await screen.findByRole('button', { name: /Family/i }, { timeout: 10000 })
    );

    await waitFor(() => {
      expect(screen.getByText('Alice Grouped')).toBeInTheDocument();
      expect(screen.queryByText('Bob Ungrouped')).not.toBeInTheDocument();
    });
  });
});
