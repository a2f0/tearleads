import { createDatabaseWorkerClient } from "@tearleads/sqlite-worker/client";
import { renderApp } from "app/client";
import { createModuleWorker } from "app/db/createModuleWorker";
import type { AppDatabaseWorker } from "app/db/sqliteWorker";
import { AppHostConfig } from "app/host/AppHostConfig";
import {
  parseTrustedPolicySigners,
  readTrustedPolicySignersPublicEnv,
} from "app/host/trustedPolicySigners";
import { createRoot } from "react-dom/client";

function createElectrobunDatabaseWorker(): AppDatabaseWorker {
  const workerUrl =
    location.protocol === "http:"
      ? "/worker.js"
      : new URL("./sqliteWorker.ts", import.meta.url);
  const worker = createModuleWorker(workerUrl);

  return {
    id: crypto.randomUUID(),
    client: createDatabaseWorkerClient(worker),
    worker,
  };
}

const elem = document.getElementById("root");
if (!elem) {
  throw new Error("Root element not found");
}

renderApp(createRoot(elem), {
  hostConfig: new AppHostConfig(
    "http://localhost:3001",
    "ws://localhost:3001",
    createElectrobunDatabaseWorker,
    parseTrustedPolicySigners(readTrustedPolicySignersPublicEnv(import.meta)),
  ),
});
