import { getSqliteWasmAssetUrl } from "@tearleads/sqlite-instance/assets";

export function getDefaultDatabaseWorkerEntrypointUrl(): URL {
  return new URL("./defaultThread.ts", import.meta.url);
}

export { getSqliteWasmAssetUrl };
