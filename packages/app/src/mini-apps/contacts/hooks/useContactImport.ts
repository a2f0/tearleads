import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useState,
} from "react";
import type { useLog } from "../../../providers/logging/LogProvider";
import type { useContacts } from "../../../stores/contacts/ContactsProvider";
import { useMiniAppMessage } from "../../bus";

// Imports a contact from a user id and selects it, returning the new contact id
// (or null when it could not be imported). Shared by the manual import dialog
// and the org-manager "Import Into Contacts" action, which imports immediately
// with no dialog. `isImportReady` gates on the store being authenticated,
// writable, and ready.
export function useImportContactByUserId(input: {
  importKey: ReturnType<typeof useContacts>["importKey"];
  isImportReady: boolean;
  isSubmittingRef: { current: boolean };
  logError: ReturnType<typeof useLog>["logError"];
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
  setSelectedContactId: (contactId: string) => void;
}) {
  const {
    importKey,
    isImportReady,
    isSubmittingRef,
    logError,
    setIsSubmitting,
    setSelectedContactId,
  } = input;

  return useCallback(
    async (userId: string): Promise<string | null> => {
      const trimmedUserId = userId.trim();
      if (
        !isImportReady ||
        isSubmittingRef.current ||
        trimmedUserId.length === 0
      ) {
        return null;
      }

      isSubmittingRef.current = true;
      setIsSubmitting(true);
      try {
        const contactId = await importKey(trimmedUserId);
        if (contactId) {
          setSelectedContactId(contactId);
        }
        return contactId;
      } catch (error: unknown) {
        logError("Contacts: failed to import contact.", error);
        return null;
      } finally {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    },
    [
      importKey,
      isImportReady,
      isSubmittingRef,
      logError,
      setIsSubmitting,
      setSelectedContactId,
    ],
  );
}

// The org-manager "Import Into Contacts" action imports immediately: create the
// contact and select it rather than opening the import dialog. Contacts may
// still be initializing when the message lands (it was just opened), so stash
// the user id and run the import once the store is ready to write.
export function useImportContactMessage(input: {
  importContactByUserId: (userId: string) => Promise<string | null>;
  isImportReady: boolean;
}) {
  const { importContactByUserId, isImportReady } = input;
  const [pendingImportUserId, setPendingImportUserId] = useState<string | null>(
    null,
  );
  const [importInFlight, setImportInFlight] = useState(false);

  useMiniAppMessage(
    "contacts",
    useCallback((message) => {
      if (message.type === "import-contact") {
        setPendingImportUserId(message.userId);
      }
    }, []),
  );

  useEffect(() => {
    if (pendingImportUserId === null || !isImportReady || importInFlight) {
      return;
    }

    // Claim the pending user id before awaiting so a message that arrives
    // mid-import is preserved (and processed next) instead of being discarded
    // by the completion handler.
    setImportInFlight(true);
    const userIdToImport = pendingImportUserId;
    setPendingImportUserId(null);
    void importContactByUserId(userIdToImport).finally(() => {
      setImportInFlight(false);
    });
  }, [
    importContactByUserId,
    importInFlight,
    isImportReady,
    pendingImportUserId,
  ]);
}
