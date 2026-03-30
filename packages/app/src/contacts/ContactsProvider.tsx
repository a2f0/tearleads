import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useAppData } from "../data/AppDataProvider";

interface AddressBookEntry {
  userId: string;
  encapsulationPublicKey: string;
}

interface ContactsContextValue {
  entries: ReadonlyArray<AddressBookEntry>;
  importKey: (userId: string) => Promise<void>;
  removeKey: (userId: string) => void;
}

const ContactsContext = createContext<ContactsContextValue | null>(null);

export function ContactsProvider({ children }: PropsWithChildren) {
  const [entries, setEntries] = useState<AddressBookEntry[]>([]);
  const { apiClient, log } = useAppData();

  const importKey = useCallback(
    async (userId: string) => {
      log(`Importing peer key for userId: ${userId}`);
      const response = await apiClient.getEncapsulationKey(userId);
      if (!response) return;
      setEntries((prev) => {
        const existing = prev.findIndex((e) => e.userId === userId);
        const entry: AddressBookEntry = {
          userId: response.userId,
          encapsulationPublicKey: response.encapsulationPublicKey,
        };
        if (existing >= 0) {
          const next = [...prev];
          next[existing] = entry;
          return next;
        }
        return [...prev, entry];
      });
      log("Peer key imported");
    },
    [log, apiClient],
  );

  const removeKey = useCallback((userId: string) => {
    setEntries((prev) => prev.filter((e) => e.userId !== userId));
  }, []);

  const value = useMemo(
    () => ({ entries, importKey, removeKey }),
    [entries, importKey, removeKey],
  );

  return (
    <ContactsContext.Provider value={value}>
      {children}
    </ContactsContext.Provider>
  );
}

export function useContacts(): ContactsContextValue {
  const ctx = useContext(ContactsContext);
  if (!ctx) {
    throw new Error("useContacts must be used within a ContactsProvider.");
  }
  return ctx;
}
