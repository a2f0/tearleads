import type { PropsWithChildren } from "react";
import { CryptoSessionProvider } from "../../crypto/CryptoSessionProvider";
import {
  DatabaseProvider,
  type DatabaseContextValue,
} from "../../db/DatabaseProvider";
import type { createAppDatabaseWorker } from "../../db/sqliteWorker";

export type { DatabaseContextValue };

interface PaneProviderProps extends PropsWithChildren {
  createWorker: typeof createAppDatabaseWorker;
}

export function PaneProvider({ children, createWorker }: PaneProviderProps) {
  return (
    <DatabaseProvider createWorker={createWorker}>
      <CryptoSessionProvider>{children}</CryptoSessionProvider>
    </DatabaseProvider>
  );
}
