import { ContactsWindow as ContactsWindowBase } from '@rapid/contacts';
import type { WindowDimensions } from '@rapid/window-manager';
import { ClientContactsProvider } from '@/contexts/ClientContactsProvider';

interface ContactsWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

/**
 * ContactsWindow wrapped with ClientContactsProvider.
 * This provides all the dependencies (database, UI components, translations)
 * required by the @rapid/contacts package.
 */
export function ContactsWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: ContactsWindowProps) {
  return (
    <ClientContactsProvider>
      <ContactsWindowBase
        id={id}
        onClose={onClose}
        onMinimize={onMinimize}
        onDimensionsChange={onDimensionsChange}
        onFocus={onFocus}
        zIndex={zIndex}
        initialDimensions={initialDimensions}
      />
    </ClientContactsProvider>
  );
}
