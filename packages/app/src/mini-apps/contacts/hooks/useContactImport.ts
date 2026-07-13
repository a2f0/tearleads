import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
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
// still be initializing when the message lands (it was just opened), so queue
// the user ids and drain them once the store is ready to write. A queue (rather
// than a single slot) preserves every request when several arrive in quick
// succession — before the store is ready, or while an import is in flight.
//
// `isSubmitting` is the store's shared in-flight flag (any create or import,
// manual or message-driven). Gating on it means a background import never runs
// while a manual dialog import holds the shared submit latch — which would make
// the import core no-op and silently drop the queued request.
export function useImportContactMessage(input: {
  importContactByUserId: (userId: string) => Promise<string | null>;
  isImportReady: boolean;
  isSubmitting: boolean;
}) {
  const { importContactByUserId, isImportReady, isSubmitting } = input;
  const [pendingImportUserIds, setPendingImportUserIds] = useState<string[]>(
    [],
  );
  const inFlightUserIdRef = useRef<string | null>(null);

  useMiniAppMessage(
    "contacts",
    useCallback((message) => {
      if (message.type === "import-contact") {
        setPendingImportUserIds((previous) => [...previous, message.userId]);
      }
    }, []),
  );

  useEffect(() => {
    const userIdToImport = pendingImportUserIds[0];
    if (
      userIdToImport === undefined ||
      !isImportReady ||
      isSubmitting ||
      inFlightUserIdRef.current === userIdToImport
    ) {
      return;
    }

    // Latch the specific in-flight id synchronously before dequeuing so a
    // re-run of this effect on the same commit (StrictMode's double invoke, a
    // concurrent render) cannot dispatch or drop the same head twice;
    // `isSubmitting` only flips on the next commit, so it can't guard this
    // window alone. Tracking the id rather than a boolean keeps the queue from
    // stalling if the ref resets on a microtask that races the dequeue's
    // re-render — a stale id never blocks a different head.
    inFlightUserIdRef.current = userIdToImport;
    setPendingImportUserIds((previous) => previous.slice(1));
    void importContactByUserId(userIdToImport).finally(() => {
      inFlightUserIdRef.current = null;
    });
  }, [
    importContactByUserId,
    isImportReady,
    isSubmitting,
    pendingImportUserIds,
  ]);
}
