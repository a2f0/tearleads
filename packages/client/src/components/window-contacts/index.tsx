import { ContactsWindow as ContactsWindowBase } from '@tearleads/contacts';
import type { WindowDimensions } from '@tearleads/window-manager';
import { ClientContactsProvider } from '@/contexts/ClientContactsProvider';
import { useWindowOpenRequest } from '@/contexts/WindowManagerContext';

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
 * required by the @tearleads/contacts package.
 */
export function ContactsWindow(props: ContactsWindowProps) {
  const openRequest = useWindowOpenRequest('contacts');

  return (
    <ClientContactsProvider>
      <ContactsWindowBase
        {...props}
        {...(openRequest && {
          openContactRequest: openRequest
        })}
      />
    </ClientContactsProvider>
  );
}
