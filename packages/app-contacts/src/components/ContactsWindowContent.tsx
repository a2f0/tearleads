import {
  WindowControlBar,
  WindowControlGroup,
  WindowSidebar,
  WindowSidebarToggle
} from '@tearleads/window-manager';
import { useState } from 'react';
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
  controlButtons?: React.ReactNode;
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
  controlButtons,
  children
}: ContactsWindowContentProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
      {isUnlocked && (
        <WindowControlBar>
          <WindowControlGroup>
            <WindowSidebarToggle
              onToggle={() => setSidebarOpen((prev) => !prev)}
            />
            {controlButtons}
          </WindowControlGroup>
        </WindowControlBar>
      )}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {isUnlocked && (
          <WindowSidebar
            width={sidebarWidth}
            onWidthChange={onSidebarWidthChange}
            open={sidebarOpen}
            onOpenChange={setSidebarOpen}
            ariaLabel="Contact groups"
            data-testid="contacts-groups-sidebar"
          >
            <ContactsGroupsSidebar
              selectedGroupId={selectedGroupId}
              onGroupSelect={onGroupSelect}
              onGroupChanged={onGroupChanged}
              onDropToGroup={onDropToGroup}
            />
          </WindowSidebar>
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
