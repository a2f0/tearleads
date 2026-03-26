import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { getEncapsulationKey } from "../api/routes/auth/encapsulationKey";
import { useLog } from "../logging/LogProvider";

interface AddressBookEntry {
  userId: string;
  encapsulationPublicKey: string;
}

interface AddressBookContextValue {
  entries: ReadonlyArray<AddressBookEntry>;
  importKey: (userId: string) => Promise<void>;
  removeKey: (userId: string) => void;
}

const AddressBookContext = createContext<AddressBookContextValue | null>(null);

export function AddressBookProvider({ children }: PropsWithChildren) {
  const [entries, setEntries] = useState<AddressBookEntry[]>([]);
  const { log } = useLog();

  const importKey = useCallback(
    async (userId: string) => {
      log(`Importing peer key for userId: ${userId}`);
      const response = await getEncapsulationKey(userId);
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
    [log],
  );

  const removeKey = useCallback((userId: string) => {
    setEntries((prev) => prev.filter((e) => e.userId !== userId));
  }, []);

  const value = useMemo(
    () => ({ entries, importKey, removeKey }),
    [entries, importKey, removeKey],
  );

  return (
    <AddressBookContext.Provider value={value}>
      {children}
    </AddressBookContext.Provider>
  );
}

export function useAddressBook(): AddressBookContextValue {
  const ctx = useContext(AddressBookContext);
  if (!ctx) {
    throw new Error(
      "useAddressBook must be used within an AddressBookProvider.",
    );
  }
  return ctx;
}
