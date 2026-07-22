import {
  createMemoryBlobStore,
  type LocalKeyring,
} from "@tearleads/client-sdk";
import {
  type CreateSQLiteRuntimeOptions,
  createSQLiteRuntime,
} from "@tearleads/client-sdk/sqlite";
import { AppHostConfig } from "../../src/host/AppHostConfig";
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
  const config = new AppHostConfig(
    "http://localhost:3001",
    wsUrl,
    () =>
      createSQLiteRuntime({
        ...(options.reuseDatabaseWorker
          ? { messageChannelConstructor: testMessageChannelConstructor }
          : {}),
        workerConstructor: options.workerConstructor ?? MockWorker,
      }),
    () => createMemoryBlobStore(),
    options.localIdentityNamespace,
    createLocalKeyring,
    options.localIdentityNamespace === undefined,
    undefined,
    undefined,
    resolveTestHostProfile(options),
  );
  return options.reuseDatabaseWorker
    ? config.withOverrides({ reuseDatabaseWorker: true })
    : config;
}
