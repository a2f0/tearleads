import {
  createMemoryBlobStore,
  type LocalKeyring,
} from "@tearleads/client-sdk";
import {
  type CreateSQLiteRuntimeOptions,
  createSQLiteRuntime,
} from "@tearleads/client-sdk/sqlite";
import {
  type AppHostConfig,
  createAppHostConfig,
} from "../../src/host/AppHostConfig";
import { resolveTestHostProfile } from "./manualIdentityProfile";
import { MockMessageChannel, MockWorker } from "./mockWorker";
import { wsUrl } from "./mswServer";
import { createSharedMemoryLocalKeyringFactory } from "./sharedMemoryLocalKeyring";

const testMessageChannelConstructor =
  MockMessageChannel as unknown as NonNullable<
    CreateSQLiteRuntimeOptions["messageChannelConstructor"]
  >;

interface CreateTestHostConfigOptions {
  readonly autoProvisionIdentity?: boolean | undefined;
  readonly createLocalKeyring?: (() => LocalKeyring) | null | undefined;
  readonly localIdentityNamespace?: string | undefined;
  readonly profile?: AppHostConfig["profile"] | undefined;
  readonly reuseDatabaseWorker?: boolean | undefined;
  readonly workerConstructor?: CreateSQLiteRuntimeOptions["workerConstructor"];
}

export function createTestHostConfig(
  options: CreateTestHostConfigOptions = {},
): AppHostConfig {
  const createLocalKeyring =
    options.createLocalKeyring === null
      ? undefined
      : (options.createLocalKeyring ?? createSharedMemoryLocalKeyringFactory());
  return createAppHostConfig({
    apiBaseUrl: "http://localhost:3001",
    createBlobStore: () => createMemoryBlobStore(),
    createLocalKeyring,
    createSQLiteRuntime: () =>
      createSQLiteRuntime({
        ...(options.reuseDatabaseWorker
          ? { messageChannelConstructor: testMessageChannelConstructor }
          : {}),
        workerConstructor: options.workerConstructor ?? MockWorker,
      }),
    disableLocalIdentityPersistence:
      options.localIdentityNamespace === undefined,
    localIdentityNamespace: options.localIdentityNamespace,
    profile: resolveTestHostProfile(options),
    reuseDatabaseWorker: options.reuseDatabaseWorker,
    wsUrl,
  });
}
