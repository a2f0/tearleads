import { createSQLiteRuntime } from "@tearleads/client-sdk/sqlite";

// A dedicated worker keeps unrelated cross-tab coordination channels out of
// the cache eviction test. The runtime opens its normal eviction channel.
const runtime = createSQLiteRuntime({ workerConstructor: Worker });
await runtime.client.init({
  cipher: "sqlcipher",
  dbName: "cache-eviction",
  key: "fixture",
  persistence: "opfs-sahpool",
});
document.querySelector("output")?.replaceChildren("SQLite ready");
