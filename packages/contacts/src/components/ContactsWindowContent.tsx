import {
  ALL_CONTACTS_ID,
  ContactsGroupsSidebar
} from './ContactsGroupsSidebar';
import type { ViewMode } from './ContactsWindowMenuBar';
import { ContactsWindowMenuBar } from './ContactsWindowMenuBar';

interface ContactsWindowContentProps {
  onClose: () => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onNewContact: () => void;
  onImportCsv: () => void;
  isNewContactDisabled: boolean;
  isImportDisabled: boolean;
  isUnlocked: boolean;
  sidebarWidth: number;
  onSidebarWidthChange: (width: number) => void;
  selectedGroupId: string | null;
  onGroupSelect: (groupId: string | null) => void;
  onGroupChanged: () => void;
  onDropToGroup: (groupId: string, contactIds: string[]) => Promise<void>;
  children: React.ReactNode;
}

export function ContactsWindowContent({
  onClose,
  viewMode,
  onViewModeChange,
  onNewContact,
  onImportCsv,
  isNewContactDisabled,
  isImportDisabled,
  isUnlocked,
  sidebarWidth,
  onSidebarWidthChange,
  selectedGroupId,
  onGroupSelect,
  onGroupChanged,
  onDropToGroup,
  children
}: ContactsWindowContentProps) {
  return (
    <div className="flex h-full flex-col">
      <ContactsWindowMenuBar
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        onNewContact={onNewContact}
        onImportCsv={onImportCsv}
        onClose={onClose}
        isNewContactDisabled={isNewContactDisabled}
        isImportDisabled={isImportDisabled}
      />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {isUnlocked && (
          <ContactsGroupsSidebar
            width={sidebarWidth}
            onWidthChange={onSidebarWidthChange}
            selectedGroupId={selectedGroupId}
            onGroupSelect={onGroupSelect}
            onGroupChanged={onGroupChanged}
            onDropToGroup={onDropToGroup}
          />
        )}
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          data-testid="contacts-window-content"
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export { ALL_CONTACTS_ID };
