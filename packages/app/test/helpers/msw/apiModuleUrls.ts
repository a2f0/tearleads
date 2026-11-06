// The app suite boots the API in-process from its source modules.
export const [appTestRuntimeModuleUrl, apiPostgresAdapterModuleUrl] = [
  "../../../../api/src/appTestRuntime.ts",
  "../../../../api-shared/src/adapters/postgres.ts",
].map((path) => new URL(path, import.meta.url).href) as [string, string];
