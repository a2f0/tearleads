import type { LocalKeyring } from "@symcrypt/client-sdk";
import type { StoragePersistencePolicy } from "@symcrypt/client-sdk/sqlite";
import { render } from "@testing-library/react";
import { useEffect } from "react";
import type { CreateSQLiteRuntimeFn } from "../../src/host/AppHostConfig";
import { createAppHostConfig } from "../../src/host/AppHostConfig";
import {
  DatabaseProvider,
  useDatabase,
} from "../../src/providers/db/DatabaseProvider";
import { AppHostConfigProvider } from "../../src/providers/host/AppHostConfigProvider";
import { LocalKeyringLockProvider } from "../../src/providers/local-keyring/LocalKeyringLockProvider";
import { LogProvider } from "../../src/providers/logging/LogProvider";
import { SymCryptProvider } from "../../src/providers/sdk/SymCryptProvider";
import { SyncModeProvider } from "../../src/providers/sync-mode/SyncModeProvider";
import { createDeferred } from "./databaseRuntimeFactories";
import { createSharedMemoryLocalKeyringFactory } from "./sharedMemoryLocalKeyring";

type DatabaseControls = ReturnType<typeof useDatabase>;

class SilentWebSocket extends EventTarget {
  constructor(_url: string | URL) {
    super();
  }

  close() {}
}

function DatabaseProbe({
  onControls,
}: {
  onControls: (controls: DatabaseControls) => void;
}) {
  const controls = useDatabase();
  useEffect(() => {
    onControls(controls);
  }, [controls, onControls]);

  return <div>sqlite worker: {controls.status}</div>;
}

export function renderDatabaseProvider(props: {
  readonly createLocalKeyring?: () => LocalKeyring;
  readonly createSQLiteRuntime: CreateSQLiteRuntimeFn;
  readonly reuseDatabaseWorker?: boolean;
  readonly storagePersistence?: StoragePersistencePolicy;
}) {
  const createLocalKeyring =
    props.createLocalKeyring ?? createSharedMemoryLocalKeyringFactory();
  const originalWebSocket = globalThis.WebSocket;
  const controlsReady = createDeferred();
  let controls: DatabaseControls | null = null;
  const getControls = () => {
    if (!controls) {
      throw new Error("Database controls were not rendered.");
    }
    return controls;
  };

  Reflect.set(globalThis, "WebSocket", SilentWebSocket);
  const view = render(
    <AppHostConfigProvider
      value={createAppHostConfig({
        apiBaseUrl: "http://localhost:3001",
        createLocalKeyring,
        createSQLiteRuntime: props.createSQLiteRuntime,
        reuseDatabaseWorker: props.reuseDatabaseWorker,
        storagePersistence: props.storagePersistence,
        wsUrl: "ws://localhost:3002",
      })}
    >
      <LocalKeyringLockProvider>
        <LogProvider>
          <SyncModeProvider>
            <SymCryptProvider>
              <DatabaseProvider>
                <DatabaseProbe
                  onControls={(nextControls) => {
                    controls = nextControls;
                    controlsReady.resolve();
                  }}
                />
              </DatabaseProvider>
            </SymCryptProvider>
          </SyncModeProvider>
        </LogProvider>
      </LocalKeyringLockProvider>
    </AppHostConfigProvider>,
  );

  return {
    controlsReady: { promise: controlsReady.promise },
    getControls,
    unmount: () => {
      view.unmount();
      Reflect.set(globalThis, "WebSocket", originalWebSocket);
    },
  };
}
