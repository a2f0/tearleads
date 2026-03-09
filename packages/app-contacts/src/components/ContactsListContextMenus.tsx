import { Info, Mail, Trash2, UserPlus } from 'lucide-react';
import type { ContactInfo } from '../hooks/useContacts';

interface MenuPosition {
  x: number;
  y: number;
}

interface ContactContextMenuState extends MenuPosition {
  contact: ContactInfo;
}

interface ContactsListContextMenusProps {
  contextMenu: ContactContextMenuState | null;
  emptySpaceContextMenu: MenuPosition | null;
  onCloseContextMenu: () => void;
  onCloseEmptySpaceMenu: () => void;
  onSendEmail: () => void;
  onGetInfo: () => void;
  onDelete: () => void;
  onNewContact: () => void;
  labels: {
    getInfo: string;
    delete: string;
  };
  ContextMenu: React.ComponentType<{
    x: number;
    y: number;
    onClose: () => void;
    children: React.ReactNode;
  }>;
  ContextMenuItem: React.ComponentType<{
    icon?: React.ReactNode;
    onClick: () => void;
    children: React.ReactNode;
  }>;
}

export function ContactsListContextMenus({
  contextMenu,
  emptySpaceContextMenu,
  onCloseContextMenu,
  onCloseEmptySpaceMenu,
  onSendEmail,
  onGetInfo,
  onDelete,
  onNewContact,
  labels,
  ContextMenu,
  ContextMenuItem
}: ContactsListContextMenusProps) {
  return (
    <>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={onCloseContextMenu}
        >
          {contextMenu.contact.primaryEmail && (
            <ContextMenuItem
              icon={<Mail className="h-4 w-4" />}
              onClick={onSendEmail}
            >
              Send email
            </ContextMenuItem>
          )}
          <ContextMenuItem
            icon={<Info className="h-4 w-4" />}
            onClick={onGetInfo}
          >
            {labels.getInfo}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Trash2 className="h-4 w-4" />}
            onClick={onDelete}
          >
            {labels.delete}
          </ContextMenuItem>
        </ContextMenu>
      )}

      {emptySpaceContextMenu && (
        <ContextMenu
          x={emptySpaceContextMenu.x}
          y={emptySpaceContextMenu.y}
          onClose={onCloseEmptySpaceMenu}
        >
          <ContextMenuItem
            icon={<UserPlus className="h-4 w-4" />}
            onClick={onNewContact}
          >
            New Contact
          </ContextMenuItem>
        </ContextMenu>
      )}
    </>
  );
}
