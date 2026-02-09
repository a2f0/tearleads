import { ContactsWindow as ContactsWindowBase } from '@rapid/contacts';
import type { WindowDimensions } from '@rapid/window-manager';
import { ClientContactsProvider } from '@/contexts/ClientContactsProvider';
import { useWindowManager } from '@/contexts/WindowManagerContext';

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
export function ContactsWindow(props: ContactsWindowProps) {
  const { windowOpenRequests } = useWindowManager();

  return (
    <ClientContactsProvider>
      <ContactsWindowBase
        {...props}
        {...(windowOpenRequests.contacts && {
          openContactRequest: windowOpenRequests.contacts
        })}
      />
    </ClientContactsProvider>
  );
}
