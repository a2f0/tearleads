import { createSQLiteRuntime as createDefaultSQLiteRuntime } from "@symcrypt/client-sdk/sqlite";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
} from "react";
import { useAppHostConfig } from "../host/AppHostConfigProvider";
import { useLocalKeyringLock } from "../local-keyring/LocalKeyringLockProvider";
import { useLog } from "../logging/LogProvider";
import { useSymCrypt } from "../sdk/SymCryptProvider";
import { useSymCryptStoreSnapshot } from "../sdk/useSymCryptSubscription";
import { createSqliteCipherKeyResolver } from "./sqliteCipherKey";
import {
  sqliteDbNameForNamespace,
  sqliteDbNameForSigningFingerprint,
} from "./sqliteDbName";
import {
  type DatabaseContextValue,
  useManagedSQLiteRuntime,
} from "./useManagedSQLiteRuntime";
import { usePersistentStoragePolicy } from "./usePersistentStoragePolicy";

const DatabaseContext = createContext<DatabaseContextValue | null>(null);

export function DatabaseProvider({ children }: PropsWithChildren) {
  const {
    createSQLiteRuntime = createDefaultSQLiteRuntime,
    localIdentityNamespace,
    reuseDatabaseWorker = false,
    storagePersistence,
  } = useAppHostConfig();
  const { createLocalKeyring } = useLocalKeyringLock();
  const symcrypt = useSymCrypt();
  const { log } = useLog();
  const identity = useSymCryptStoreSnapshot(symcrypt.identity);
  const persistencePolicy = usePersistentStoragePolicy(storagePersistence, log);
  const resolveCipherKey = useMemo(
    () => createSqliteCipherKeyResolver(createLocalKeyring),
    [createLocalKeyring],
  );
  const dbName = sqliteDbNameForNamespace(
    localIdentityNamespace ?? "symcrypt.app",
  );
  const activeDbName = identity.signingFingerprint
    ? sqliteDbNameForSigningFingerprint(identity.signingFingerprint)
    : dbName;

  const value = useManagedSQLiteRuntime(
    createSQLiteRuntime,
    activeDbName,
    persistencePolicy,
    resolveCipherKey,
    log,
    symcrypt,
    reuseDatabaseWorker,
  );

  return (
    <DatabaseContext.Provider value={value}>
      {children}
    </DatabaseContext.Provider>
  );
}

export function useDatabase(): DatabaseContextValue {
  const context = useContext(DatabaseContext);
  if (!context) {
    throw new Error("useDatabase must be used within a DatabaseProvider.");
  }

  return context;
}
