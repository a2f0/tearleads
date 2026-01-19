import { useCallback, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { ContactsWindowDetail } from './ContactsWindowDetail';
import { ContactsWindowList } from './ContactsWindowList';
import type { ViewMode } from './ContactsWindowMenuBar';
import { ContactsWindowMenuBar } from './ContactsWindowMenuBar';
import { ContactsWindowNew } from './ContactsWindowNew';
import { ContactsWindowTableView } from './ContactsWindowTableView';

type WindowView = 'list' | 'detail' | 'create';

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
  const [currentView, setCurrentView] = useState<WindowView>('list');
  const [selectedContactId, setSelectedContactId] = useState<string | null>(
    null
  );
  const [viewMode, setViewMode] = useState<ViewMode>('list');

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
      default:
        return 'Contacts';
    }
  };

  return (
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
          onClose={onClose}
          isNewContactDisabled={currentView === 'create'}
        />
        <div className="flex-1 overflow-hidden">
          {currentView === 'detail' && selectedContactId ? (
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
            />
          ) : (
            <ContactsWindowList
              onSelectContact={handleSelectContact}
              onCreateContact={handleNewContact}
            />
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
