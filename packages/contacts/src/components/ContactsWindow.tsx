import {
  FloatingWindow,
  type WindowDimensions
} from '@tearleads/window-manager';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useContactsContext } from '../context';
import type { ImportResult } from '../hooks/useContactsImport';
import { linkContactsToGroup } from '../lib/linkContactsToGroup';
import {
  ALL_CONTACTS_ID,
  ContactsWindowContent
} from './ContactsWindowContent';
import { ContactsWindowDetail } from './ContactsWindowDetail';
import { ContactsWindowImport } from './ContactsWindowImport';
import { ContactsWindowList } from './ContactsWindowList';
import type { ViewMode } from './ContactsWindowMenuBar';
import { ContactsWindowNew } from './ContactsWindowNew';
import { ContactsWindowTableView } from './ContactsWindowTableView';

type WindowView = 'list' | 'detail' | 'create' | 'import';

interface ContactsWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
  openContactRequest?: {
    contactId?: string;
    groupId?: string;
    requestId: number;
  };
}

export function ContactsWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions,
  openContactRequest
}: ContactsWindowProps) {
  const { databaseState, getDatabase } = useContactsContext();
  const { isUnlocked } = databaseState;
  const [currentView, setCurrentView] = useState<WindowView>('list');
  const [selectedContactId, setSelectedContactId] = useState<string | null>(
    null
  );
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    openContactRequest?.groupId ?? ALL_CONTACTS_ID
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSelectContact = useCallback((contactId: string) => {
    setSelectedContactId(contactId);
    setCurrentView('detail');
  }, []);

  const handleBack = useCallback(() => {
    setSelectedContactId(null);
    setCurrentView('list');
  }, []);

  const handleDeleted = useCallback(() => {
    setSelectedContactId(null);
    setCurrentView('list');
  }, []);

  const handleNewContact = useCallback(() => {
    setCurrentView('create');
  }, []);

  const handleImportCsv = useCallback(() => {
    if (!isUnlocked) return;
    fileInputRef.current?.click();
  }, [isUnlocked]);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const [file] = Array.from(e.target.files ?? []);
      if (file) {
        setSelectedContactId(null);
        setImportFile(file);
        setCurrentView('import');
      }
      e.target.value = '';
    },
    []
  );

  const handleImportDone = useCallback(() => {
    setImportFile(null);
    setCurrentView('list');
  }, []);

  const handleImportComplete = useCallback((_result: ImportResult) => {
    setRefreshToken((value) => value + 1);
  }, []);

  const handleCreated = useCallback((contactId: string) => {
    setSelectedContactId(contactId);
    setCurrentView('detail');
  }, []);

  const handleGroupChanged = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  const handleDropToGroup = useCallback(
    async (groupId: string, contactIds: string[]) => {
      const db = getDatabase();
      const insertedCount = await linkContactsToGroup(db, groupId, contactIds);
      if (insertedCount > 0) {
        setRefreshToken((value) => value + 1);
      }
    },
    [getDatabase]
  );

  const resolvedGroupId =
    selectedGroupId && selectedGroupId !== ALL_CONTACTS_ID
      ? selectedGroupId
      : undefined;

  useEffect(() => {
    if (openContactRequest?.requestId === undefined) return;

    if (openContactRequest.groupId) {
      setSelectedGroupId(openContactRequest.groupId);
      setCurrentView('list');
      setSelectedContactId(null);
    }

    if (openContactRequest.contactId) {
      setSelectedContactId(openContactRequest.contactId);
      setCurrentView('detail');
    }
  }, [openContactRequest]);

  const getTitle = () => {
    switch (currentView) {
      case 'detail':
        return 'Contact';
      case 'create':
        return 'New Contact';
      case 'import':
        return 'Import CSV';
      default:
        return 'Contacts';
    }
  };

  const renderContent = () => {
    if (currentView === 'import') {
      return (
        <ContactsWindowImport
          file={importFile}
          onDone={handleImportDone}
          onImported={handleImportComplete}
        />
      );
    }

    if (currentView === 'detail' && selectedContactId) {
      return (
        <ContactsWindowDetail
          contactId={selectedContactId}
          onBack={handleBack}
          onDeleted={handleDeleted}
        />
      );
    }

    if (currentView === 'create') {
      return (
        <ContactsWindowNew onBack={handleBack} onCreated={handleCreated} />
      );
    }

    if (viewMode === 'table') {
      return (
        <ContactsWindowTableView
          onSelectContact={handleSelectContact}
          onCreateContact={handleNewContact}
          refreshToken={refreshToken}
          groupId={resolvedGroupId}
        />
      );
    }

    return (
      <ContactsWindowList
        onSelectContact={handleSelectContact}
        onCreateContact={handleNewContact}
        refreshToken={refreshToken}
        groupId={resolvedGroupId}
      />
    );
  };

  return (
    <>
      <FloatingWindow
        id={id}
        title={getTitle()}
        onClose={onClose}
        onMinimize={onMinimize}
        onDimensionsChange={onDimensionsChange}
        onRename={onRename}
        onFocus={onFocus}
        zIndex={zIndex}
        {...(initialDimensions && { initialDimensions })}
        defaultWidth={500}
        defaultHeight={450}
        minWidth={350}
        minHeight={300}
      >
        <ContactsWindowContent
          onClose={onClose}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onNewContact={handleNewContact}
          onImportCsv={handleImportCsv}
          isNewContactDisabled={currentView === 'create'}
          isImportDisabled={!isUnlocked}
          isUnlocked={isUnlocked}
          sidebarWidth={sidebarWidth}
          onSidebarWidthChange={setSidebarWidth}
          selectedGroupId={selectedGroupId}
          onGroupSelect={setSelectedGroupId}
          onGroupChanged={handleGroupChanged}
          onDropToGroup={handleDropToGroup}
        >
          {renderContent()}
        </ContactsWindowContent>
      </FloatingWindow>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={handleFileInputChange}
        data-testid="contacts-import-input"
      />
    </>
  );
}
