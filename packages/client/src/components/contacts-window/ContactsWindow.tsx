import { useCallback, useRef, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { useDatabaseContext } from '@/db/hooks';
import { ContactsWindowDetail } from './ContactsWindowDetail';
import { ContactsWindowImport } from './ContactsWindowImport';
import { ContactsWindowList } from './ContactsWindowList';
import type { ViewMode } from './ContactsWindowMenuBar';
import { ContactsWindowMenuBar } from './ContactsWindowMenuBar';
import { ContactsWindowNew } from './ContactsWindowNew';
import { ContactsWindowTableView } from './ContactsWindowTableView';

type WindowView = 'list' | 'detail' | 'create' | 'import';

interface ContactsWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function ContactsWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: ContactsWindowProps) {
  const { isUnlocked } = useDatabaseContext();
  const [currentView, setCurrentView] = useState<WindowView>('list');
  const [selectedContactId, setSelectedContactId] = useState<string | null>(
    null
  );
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
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

  const handleImportComplete = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  const handleCreated = useCallback((contactId: string) => {
    setSelectedContactId(contactId);
    setCurrentView('detail');
  }, []);

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

  return (
    <>
      <FloatingWindow
        id={id}
        title={getTitle()}
        onClose={onClose}
        onMinimize={onMinimize}
        onDimensionsChange={onDimensionsChange}
        onFocus={onFocus}
        zIndex={zIndex}
        {...(initialDimensions && { initialDimensions })}
        defaultWidth={500}
        defaultHeight={450}
        minWidth={350}
        minHeight={300}
      >
        <div className="flex h-full flex-col">
          <ContactsWindowMenuBar
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onNewContact={handleNewContact}
            onImportCsv={handleImportCsv}
            onClose={onClose}
            isNewContactDisabled={currentView === 'create'}
            isImportDisabled={!isUnlocked}
          />
          <div className="flex-1 overflow-hidden">
            {currentView === 'import' ? (
              <ContactsWindowImport
                file={importFile}
                onDone={handleImportDone}
                onImported={handleImportComplete}
              />
            ) : currentView === 'detail' && selectedContactId ? (
              <ContactsWindowDetail
                contactId={selectedContactId}
                onBack={handleBack}
                onDeleted={handleDeleted}
              />
            ) : currentView === 'create' ? (
              <ContactsWindowNew onBack={handleBack} onCreated={handleCreated} />
            ) : viewMode === 'table' ? (
              <ContactsWindowTableView
                onSelectContact={handleSelectContact}
                onCreateContact={handleNewContact}
                refreshToken={refreshToken}
              />
            ) : (
              <ContactsWindowList
                onSelectContact={handleSelectContact}
                onCreateContact={handleNewContact}
                refreshToken={refreshToken}
              />
            )}
          </div>
        </div>
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
